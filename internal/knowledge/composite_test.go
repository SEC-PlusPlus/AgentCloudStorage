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
// Task 11：补 StreamAnswer——streamDeltas 同步灌入已关闭通道；streamErr 为开流前同步错误。
type fakeTier struct {
	answer       string
	err          error
	calls        int
	streamDeltas []string
	streamErr    error
	streamCalls  int
}

func (f *fakeTier) Answer(ctx context.Context, question, source string) (string, error) {
	f.calls++
	if f.err != nil {
		return "", f.err
	}
	return f.answer, nil
}

func (f *fakeTier) StreamAnswer(ctx context.Context, question, source string) (<-chan string, error) {
	f.streamCalls++
	if f.streamErr != nil {
		return nil, f.streamErr
	}
	out := make(chan string, len(f.streamDeltas)+1)
	for _, d := range f.streamDeltas {
		out <- d
	}
	close(out)
	return out, nil
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

// ---- Task 11：CompositeAnswerer.StreamAnswer（开流前同步错误才回落；回落答案=单个 delta）----

func TestCompositeStreamPrimarySuccessPassesChannelThrough(t *testing.T) {
	capture := swapSlogDefault(t)

	primary := &fakeTier{streamDeltas: []string{"第一段", "第二段"}}
	fallback := &fakeTier{answer: "本地答案"}
	composite := NewCompositeAnswerer(primary, fallback)

	deltas, err := composite.StreamAnswer(context.Background(), "问题", "段落")
	if err != nil {
		t.Fatalf("StreamAnswer() sync error = %v", err)
	}
	got := drainStreamWithTimeout(t, deltas, 2*time.Second)
	if strings.Join(got, "|") != "第一段|第二段" {
		t.Errorf("deltas = %q, want primary passthrough", got)
	}
	if fallback.calls != 0 || fallback.streamCalls != 0 {
		t.Errorf("fallback must stay untouched on primary success: Answer %d, StreamAnswer %d", fallback.calls, fallback.streamCalls)
	}
	if len(warnRecords(capture)) != 0 {
		t.Errorf("unexpected warn records: %v", capture.records)
	}
}

func TestCompositeStreamFallbackAsSingleDelta(t *testing.T) {
	capture := swapSlogDefault(t)

	primaryErr := fmt.Errorf("call agent service: %w (%w)", ErrAgentUnavailable, errors.New("dial refused"))
	primary := &fakeTier{streamErr: primaryErr}
	fallback := &fakeTier{answer: "本地兜底答案"}
	composite := NewCompositeAnswerer(primary, fallback)

	deltas, err := composite.StreamAnswer(context.Background(), "问题", "段落")
	if err != nil {
		t.Fatalf("fallback-eligible sync error must yield a channel, got %v", err)
	}
	got := drainStreamWithTimeout(t, deltas, 2*time.Second)
	if len(got) != 1 || got[0] != "本地兜底答案" {
		t.Errorf("deltas = %q, want exactly one delta %q", got, "本地兜底答案")
	}
	if fallback.calls != 1 {
		t.Errorf("fallback.Answer calls = %d, want 1", fallback.calls)
	}
	if fallback.streamCalls != 0 {
		t.Errorf("fallback.StreamAnswer calls = %d, want 0 (回落走整段 Answer)", fallback.streamCalls)
	}
	warns := warnRecords(capture)
	if len(warns) != 1 || warns[0].Message != "agent fallback" {
		t.Errorf("warn records = %v, want exactly one %q", warns, "agent fallback")
	}
}

func TestCompositeStreamUnauthorizedPassesThroughWithoutFallback(t *testing.T) {
	capture := swapSlogDefault(t)

	primaryErr := fmt.Errorf("agent rejected credentials: status %d (%w)", 401, ErrAgentUnauthorized)
	primary := &fakeTier{streamErr: primaryErr}
	fallback := &fakeTier{answer: "本地答案"}
	composite := NewCompositeAnswerer(primary, fallback)

	deltas, err := composite.StreamAnswer(context.Background(), "问题", "段落")
	if !errors.Is(err, ErrAgentUnauthorized) {
		t.Fatalf("err = %v, want primary unauthorized chain", err)
	}
	if deltas != nil {
		t.Errorf("deltas != nil, want nil channel on non-fallback-eligible error")
	}
	if fallback.calls != 0 || fallback.streamCalls != 0 {
		t.Errorf("unauthorized must never touch fallback")
	}
	if len(warnRecords(capture)) != 0 {
		t.Errorf("unexpected warn records: %v", capture.records)
	}
}

func TestCompositeStreamNoFallbackWhenCtxCanceled(t *testing.T) {
	capture := swapSlogDefault(t)

	primaryErr := fmt.Errorf("call agent service: %w (%w)", ErrAgentUnavailable, errors.New("boom"))
	primary := &fakeTier{streamErr: primaryErr}
	fallback := &fakeTier{answer: "本地答案"}
	composite := NewCompositeAnswerer(primary, fallback)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	deltas, err := composite.StreamAnswer(ctx, "问题", "段落")
	if !errors.Is(err, ErrAgentUnavailable) {
		t.Fatalf("err = %v, want primary error untouched", err)
	}
	if deltas != nil {
		t.Errorf("deltas != nil, want nil channel when ctx already dead")
	}
	if fallback.calls != 0 {
		t.Errorf("canceled ctx must never fall back (same gate as Answer)")
	}
	if len(warnRecords(capture)) != 0 {
		t.Errorf("unexpected warn records: %v", capture.records)
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
