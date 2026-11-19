package knowledge

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeTier 是 composite_test 专用的包内桩 Answerer（与 local_test 的 fakeChatModel 不同层：
// 这里 fake 的是 Answerer 接口本身，按档位记录调用次数）。
type fakeTier struct {
	answer string
	err    error
	calls  int
}

func (f *fakeTier) Answer(ctx context.Context, question, source string) (string, error) {
	f.calls++
	if f.err != nil {
		return "", f.err
	}
	return f.answer, nil
}

// recordCapture 收集 slog 默认 logger 的记录，用于钉死"回落必须 slog.Warn"。
type recordCapture struct {
	records []slog.Record
}

func (c *recordCapture) Enabled(context.Context, slog.Level) bool { return true }

func (c *recordCapture) Handle(_ context.Context, r slog.Record) error {
	c.records = append(c.records, r.Clone())
	return nil
}

func (c *recordCapture) WithAttrs([]slog.Attr) slog.Handler { return c }

func (c *recordCapture) WithGroup(string) slog.Handler { return c }

// swapSlogDefault 临时替换默认 logger，测试结束自动还原。
func swapSlogDefault(t *testing.T) *recordCapture {
	t.Helper()
	capture := &recordCapture{}
	previous := slog.Default()
	slog.SetDefault(slog.New(capture))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return capture
}

func warnRecords(capture *recordCapture) []slog.Record {
	var warns []slog.Record
	for _, r := range capture.records {
		if r.Level == slog.LevelWarn {
			warns = append(warns, r)
		}
	}
	return warns
}

func TestCompositeAnswererFallbackRules(t *testing.T) {
	primaryUnavailable := fmt.Errorf("call agent service: %w (%w)", ErrAgentUnavailable, errors.New("dial tcp: connection refused"))
	primaryUpstream := fmt.Errorf("agent reports upstream llm failure: %w (%w)", ErrUpstreamLLM, errors.New("status 502"))
	primaryUnauthorized := fmt.Errorf("agent rejected credentials: %w (%w)", ErrAgentUnauthorized, errors.New("status 401"))

	unavailableCases := []struct {
		name      string
		primary   *fakeTier
		fallback  *fakeTier
		cancelCtx bool
	}{
		{
			name:     "primary 成功不调 fallback",
			primary:  &fakeTier{answer: "远端答案"},
			fallback: &fakeTier{answer: "本地答案"},
		},
		{
			name:     "primary ErrAgentUnavailable(wrapped) 回落",
			primary:  &fakeTier{err: primaryUnavailable},
			fallback: &fakeTier{answer: "本地答案"},
		},
		{
			name:     "primary ErrUpstreamLLM(wrapped) 回落",
			primary:  &fakeTier{err: primaryUpstream},
			fallback: &fakeTier{answer: "本地答案"},
		},
		{
			name:     "primary ErrAgentUnauthorized 绝不回落",
			primary:  &fakeTier{err: primaryUnauthorized},
			fallback: &fakeTier{answer: "本地答案"},
		},
		{
			name:      "primary 错但 ctx 已取消绝不回落",
			primary:   &fakeTier{err: primaryUnavailable},
			fallback:  &fakeTier{answer: "本地答案"},
			cancelCtx: true,
		},
	}

	for _, tc := range unavailableCases {
		t.Run(tc.name, func(t *testing.T) {
			capture := swapSlogDefault(t)

			ctx := context.Background()
			if tc.cancelCtx {
				canceled, cancel := context.WithCancel(ctx)
				cancel()
				ctx = canceled
			}

			primary, fallback := tc.primary, tc.fallback
			composite := NewCompositeAnswerer(primary, fallback)
			answer, err := composite.Answer(ctx, "问题", "段落")

			if primary.calls != 1 {
				t.Errorf("primary calls = %d, want 1", primary.calls)
			}

			transient := errors.Is(tc.primary.err, ErrAgentUnavailable) || errors.Is(tc.primary.err, ErrUpstreamLLM)
			shouldFallback := transient && !tc.cancelCtx

			switch {
			case tc.primary.err == nil:
				// 成功直通，且绝不触碰 fallback（review round-1 pin）。
				if answer != "远端答案" || err != nil {
					t.Errorf("Answer() = (%q, %v), want (%q, nil)", answer, err, "远端答案")
				}
				if fallback.calls != 0 {
					t.Errorf("fallback calls = %d, want 0 (primary success must never invoke fallback)", fallback.calls)
				}
			case shouldFallback:
				if fallback.calls != 1 {
					t.Errorf("fallback calls = %d, want 1", fallback.calls)
				}
				if answer != "本地答案" || err != nil {
					t.Errorf("Answer() = (%q, %v), want (%q, nil)", answer, err, "本地答案")
				}
				warns := warnRecords(capture)
				if len(warns) != 1 {
					t.Fatalf("warn records = %d, want 1 (%v)", len(warns), capture.records)
				}
				if warns[0].Message != "agent fallback" {
					t.Errorf("warn message = %q, want %q", warns[0].Message, "agent fallback")
				}
				var loggedErr string
				warns[0].Attrs(func(a slog.Attr) bool {
					if a.Key == "error" {
						loggedErr = a.Value.String()
					}
					return true
				})
				if !strings.Contains(loggedErr, tc.primary.err.Error()) {
					t.Errorf("warn error attr = %q, want it to contain primary error %q", loggedErr, tc.primary.err)
				}
			default:
				// 绝不回落：原样返回 primary 错误。
				if fallback.calls != 0 {
					t.Errorf("fallback calls = %d, want 0 (must never be touched)", fallback.calls)
				}
				if !errors.Is(err, tc.primary.err) {
					t.Errorf("err = %v, want primary error chain %v", err, tc.primary.err)
				}
				if answer != "" {
					t.Errorf("answer = %q, want empty", answer)
				}
				if len(warnRecords(capture)) != 0 {
					t.Errorf("unexpected warn records: %v", capture.records)
				}
			}
		})
	}
}

func TestCompositeAnswererFallbackFailureReturnsFallbackError(t *testing.T) {
	capture := swapSlogDefault(t)

	primaryBoom := errors.New("primary boom")
	fallbackBoom := errors.New("fallback boom")
	primary := &fakeTier{err: fmt.Errorf("call agent service: %w (%w)", ErrAgentUnavailable, primaryBoom)}
	fallback := &fakeTier{err: fmt.Errorf("generate answer: %w (%w)", ErrUpstreamLLM, fallbackBoom)}

	composite := NewCompositeAnswerer(primary, fallback)
	answer, err := composite.Answer(context.Background(), "问题", "段落")

	if fallback.calls != 1 {
		t.Fatalf("fallback calls = %d, want 1", fallback.calls)
	}
	if answer != "" {
		t.Errorf("answer = %q, want empty", answer)
	}
	if !errors.Is(err, fallbackBoom) {
		t.Errorf("err = %v, want fallback's error chain", err)
	}
	if errors.Is(err, primaryBoom) {
		t.Errorf("err = %v, must be the FALLBACK's error, not primary's", err)
	}
	if len(warnRecords(capture)) != 1 {
		t.Errorf("warn records = %d, want exactly 1 (%v)", len(warnRecords(capture)), capture.records)
	}
}

func TestCompositeAnswererNilFallbackPassThrough(t *testing.T) {
	primaryBoom := errors.New("primary boom")
	primary := &fakeTier{err: fmt.Errorf("call agent service: %w (%w)", ErrAgentUnavailable, primaryBoom)}

	composite := NewCompositeAnswerer(primary, nil)
	_, err := composite.Answer(context.Background(), "问题", "段落")
	if !errors.Is(err, ErrAgentUnavailable) || !errors.Is(err, primaryBoom) {
		t.Errorf("err = %v, want pass-through of primary error", err)
	}

	ok := &fakeTier{answer: "答案"}
	composite = NewCompositeAnswerer(ok, nil)
	answer, err := composite.Answer(context.Background(), "问题", "段落")
	if answer != "答案" || err != nil {
		t.Errorf("Answer() = (%q, %v), want (%q, nil)", answer, err, "答案")
	}
}

// TestCompositeAnswererRemoteDiesFallsBackToLocal 忠实替代计划步骤 4 的真机 kill 复验：
// 真实 RemoteAnswerer 指向已关闭（=进程被 kill 的端口）的 httptest server →
// transport 错误映射 ErrAgentUnavailable → composite 回落本地档拿到答案。
func TestCompositeAnswererRemoteDiesFallsBackToLocal(t *testing.T) {
	capture := swapSlogDefault(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError) // 若尚未关闭：500 同样映射 ErrAgentUnavailable。
	}))
	server.Close() // 模拟 Task 8 之后 kill agent：端口已死。

	remote := NewRemoteAnswerer(server.URL, "test-internal", 2*time.Second)
	local := &fakeTier{answer: "本地兜底答案"}

	composite := NewCompositeAnswerer(remote, local)
	answer, err := composite.Answer(context.Background(), "问题", "段落")
	if err != nil {
		t.Fatalf("Answer() error = %v, want local fallback success", err)
	}
	if answer != "本地兜底答案" {
		t.Errorf("answer = %q, want %q", answer, "本地兜底答案")
	}
	if local.calls != 1 {
		t.Errorf("fallback calls = %d, want 1", local.calls)
	}
	if len(warnRecords(capture)) != 1 {
		t.Errorf("warn records = %d, want 1 (%v)", len(warnRecords(capture)), capture.records)
	}
}
