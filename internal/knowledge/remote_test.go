package knowledge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRemoteAnswerSuccess(t *testing.T) {
	var (
		gotMethod     string
		gotPath       string
		gotAuth       string
		gotCT         string
		gotPayload    map[string]any
		handlerFailed bool
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotCT = r.Header.Get("Content-Type")
		body, err := io.ReadAll(r.Body)
		if err != nil {
			handlerFailed = true
			t.Errorf("read request body: %v", err)
			return
		}
		if err := json.Unmarshal(body, &gotPayload); err != nil {
			handlerFailed = true
			t.Errorf("request body is not valid JSON: %v (%q)", err, body)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"answer":" 文本 "}`)
	}))
	defer srv.Close()

	a := NewRemoteAnswerer(srv.URL, "test-key", 5*time.Second)
	answer, err := a.Answer(context.Background(), "问了什么", "[1] 第一段\n\n[2] 第二段")
	if err != nil {
		t.Fatalf("Answer() error = %v", err)
	}
	if handlerFailed {
		t.Fatal("handler assertions failed, see above")
	}
	if answer != "文本" {
		t.Errorf("answer = %q, want %q (trimmed whitespace)", answer, "文本")
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotPath != "/v1/ask" {
		t.Errorf("path = %q, want %q", gotPath, "/v1/ask")
	}
	if gotAuth != "Bearer test-key" {
		t.Errorf("Authorization = %q, want %q", gotAuth, "Bearer test-key")
	}
	if gotCT != "application/json" {
		t.Errorf("Content-Type = %q, want %q", gotCT, "application/json")
	}
	if gotPayload["question"] != "问了什么" {
		t.Errorf(`request JSON["question"] = %v, want %q`, gotPayload["question"], "问了什么")
	}
	if gotPayload["source"] != "[1] 第一段\n\n[2] 第二段" {
		t.Errorf(`request JSON["source"] = %v, want the source string`, gotPayload["source"])
	}
	if len(gotPayload) != 2 {
		t.Errorf("request JSON keys = %d, want exactly 2 (question, source): %v", len(gotPayload), gotPayload)
	}
}

func TestRemoteAnswerErrorMapping(t *testing.T) {
	cases := []struct {
		status int
		want   error
	}{
		{http.StatusUnauthorized, ErrAgentUnauthorized},
		{http.StatusBadGateway, ErrUpstreamLLM},
		{http.StatusGatewayTimeout, ErrUpstreamLLM},
		{http.StatusInternalServerError, ErrAgentUnavailable},
		{http.StatusUnprocessableEntity, ErrAgentUnavailable},
	}
	for _, tc := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(tc.status)
			io.WriteString(w, `{"detail":"nope"}`)
		}))
		a := NewRemoteAnswerer(srv.URL, "k", 5*time.Second)
		_, err := a.Answer(context.Background(), "q", "s")
		srv.Close()

		if !errors.Is(err, tc.want) {
			t.Errorf("status %d: errors.Is(err, %v) = false, err = %v", tc.status, tc.want, err)
		}
	}
}

func TestRemoteAnswerWhitespaceOnly200MapsToUpstreamLLM(t *testing.T) {
	// 映射表缺腿（promoted Minor）：HTTP 200 但 {"answer":"   "}（纯空白）
	// → remote.go 的 TrimSpace 空答案判定必须映射到 ErrUpstreamLLM，
	// 绝不把空白串当成功答案交给调用方。
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"answer":"   "}`)
	}))
	defer srv.Close()

	a := NewRemoteAnswerer(srv.URL, "k", 5*time.Second)
	_, err := a.Answer(context.Background(), "q", "s")
	if !errors.Is(err, ErrUpstreamLLM) {
		t.Fatalf("200 whitespace-only answer: errors.Is(err, ErrUpstreamLLM) = false, err = %v", err)
	}
}

func TestRemoteAnswerRespectsContextCancel(t *testing.T) {
	// 服务端挂起直到请求上下文结束；客户端 ctx 取消后 Answer 必须立即返回裸 ctx 错误（Task 9 依赖）。
	// release 兜底：Windows 上服务端可能观察不到客户端断开，用它保证 handler 退出、srv.Close 不悬挂、无 goroutine 泄漏。
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer func() { close(release); srv.Close() }()

	a := NewRemoteAnswerer(srv.URL, "k", 30*time.Second)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	_, err := a.Answer(ctx, "q", "s")
	elapsed := time.Since(start)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("errors.Is(err, context.Canceled) = false, err = %v", err)
	}
	if errors.Is(err, ErrAgentUnavailable) {
		t.Errorf("canceled ctx must be returned bare, not wrapped in ErrAgentUnavailable: %v", err)
	}
	if elapsed > 5*time.Second {
		t.Errorf("Answer returned after %v, want promptly after cancel", elapsed)
	}
}

func TestRemoteAnswerLimitsBody(t *testing.T) {
	// ~1.8MB 响应 > 1MiB 上限：必须报错（解码被截断的 JSON 失败→ErrUpstreamLLM），进程无恙。
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"answer":"`+strings.Repeat("あ", 600_000)+`"}`)
	}))
	defer srv.Close()

	a := NewRemoteAnswerer(srv.URL, "k", 5*time.Second)
	_, err := a.Answer(context.Background(), "q", "s")
	if err == nil {
		t.Fatal("Answer() error = nil, want error for oversized response body")
	}
	if !errors.Is(err, ErrUpstreamLLM) {
		t.Errorf("errors.Is(err, ErrUpstreamLLM) = false, err = %v", err)
	}
}

func TestRemoteAnswerTransportError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := srv.URL
	srv.Close() // 提前关闭 → connection refused

	a := NewRemoteAnswerer(url, "k", 5*time.Second)
	_, err := a.Answer(context.Background(), "q", "s")
	if !errors.Is(err, ErrAgentUnavailable) {
		t.Fatalf("errors.Is(err, ErrAgentUnavailable) = false, err = %v", err)
	}
}

// sseDeltaFrame 按 Task 10 冻结的线上格式拼一帧：data: {"delta": "..."}\n\n。
func sseDeltaFrame(delta string) string {
	payload, err := json.Marshal(map[string]string{"delta": delta})
	if err != nil {
		panic(err) // 测试构造器：字符串不可能编码失败
	}
	return "data: " + string(payload) + "\n\n"
}

// drainStreamWithTimeout 收尽通道直到 close；超时视为"通道未关闭"失败（Task 11 契约：一切终结皆 close）。
func drainStreamWithTimeout(t *testing.T, deltas <-chan string, timeout time.Duration) []string {
	t.Helper()
	var got []string
	deadline := time.After(timeout)
	for {
		select {
		case d, ok := <-deltas:
			if !ok {
				return got
			}
			got = append(got, d)
		case <-deadline:
			t.Fatalf("stream did not close within %v (received %d delta(s) so far)", timeout, len(got))
		}
	}
}

func TestRemoteStreamAnswerReplaysDeltasUntilDone(t *testing.T) {
	capture := swapSlogDefault(t)

	var (
		gotPath    string
		gotAuth    string
		gotCT      string
		gotPayload map[string]any
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotCT = r.Header.Get("Content-Type")
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &gotPayload); err != nil {
			t.Errorf("stream request body not JSON: %v (%q)", err, body)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		// 冻结格式：三帧 delta + [DONE]（Task 10 wire facts）。
		w.Write([]byte(sseDeltaFrame("第一段")))
		w.Write([]byte(sseDeltaFrame("第二段")))
		w.Write([]byte(sseDeltaFrame("第三段")))
		w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	a := NewRemoteAnswerer(srv.URL, "test-key", 5*time.Second)
	deltas, err := a.StreamAnswer(context.Background(), "问了什么", "[1] 段落")
	if err != nil {
		t.Fatalf("StreamAnswer() sync error = %v", err)
	}

	got := drainStreamWithTimeout(t, deltas, 5*time.Second)
	if want := []string{"第一段", "第二段", "第三段"}; strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("deltas = %q, want %q", got, want)
	}
	if gotPath != "/v1/ask/stream" {
		t.Errorf("path = %q, want %q", gotPath, "/v1/ask/stream")
	}
	if gotAuth != "Bearer test-key" {
		t.Errorf("Authorization = %q, want %q", gotAuth, "Bearer test-key")
	}
	if gotCT != "application/json" {
		t.Errorf("Content-Type = %q, want %q", gotCT, "application/json")
	}
	if gotPayload["question"] != "问了什么" || gotPayload["source"] != "[1] 段落" {
		t.Errorf("stream payload = %v, want {question, source}", gotPayload)
	}
	if len(warnRecords(capture)) != 0 {
		t.Errorf("[DONE] 正常收尾不该记任何 Warn，got %v", capture.records)
	}
}

func TestRemoteStreamAnswerPreStartUnauthorizedIsSyncError(t *testing.T) {
	// 开流前 401 → 同步返回 Task 3 同一张表的哨兵（Answer 与 StreamAnswer 共用 agentStatusError），
	// 且不得留下通道/goroutine。
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		io.WriteString(w, `{"detail":"bad key"}`)
	}))
	defer srv.Close()

	a := NewRemoteAnswerer(srv.URL, "k", 5*time.Second)
	deltas, err := a.StreamAnswer(context.Background(), "q", "s")
	if !errors.Is(err, ErrAgentUnauthorized) {
		t.Fatalf("errors.Is(err, ErrAgentUnauthorized) = false, err = %v", err)
	}
	if deltas != nil {
		t.Errorf("deltas != nil, want nil channel on pre-stream failure")
	}

	for _, tc := range []struct {
		status int
		want   error
	}{
		{http.StatusServiceUnavailable, ErrAgentUnavailable}, // default 行：非约定状态 → Unavailable
		{http.StatusGatewayTimeout, ErrUpstreamLLM},          // 与 Answer 表逐字一致
	} {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(tc.status)
		}))
		an := NewRemoteAnswerer(s.URL, "k", 5*time.Second)
		_, err := an.StreamAnswer(context.Background(), "q", "s")
		s.Close()
		if !errors.Is(err, tc.want) {
			t.Errorf("status %d: errors.Is(err, %v) = false, err = %v", tc.status, tc.want, err)
		}
	}
}

func TestRemoteStreamAnswerCtxCancelMidStreamClosesChannel(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(sseDeltaFrame("第一段")))
		w.(http.Flusher).Flush()
		// 之后挂起：模拟 Python 侧慢流。第二条 delta 永远不来，靠 ctx 取消收尾。
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer func() { close(release); srv.Close() }()

	a := NewRemoteAnswerer(srv.URL, "k", 30*time.Second)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	deltas, err := a.StreamAnswer(ctx, "q", "s")
	if err != nil {
		t.Fatalf("StreamAnswer() sync error = %v", err)
	}

	select {
	case d, ok := <-deltas:
		if !ok || d != "第一段" {
			t.Fatalf("first delta = (%q, ok=%v), want 第一段", d, ok)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no first delta within 5s")
	}

	cancel()
	// 契约：ctx 取消 → 生产者关 resp.Body 并 close 通道，绝无 goroutine 泄漏。
	drainStreamWithTimeout(t, deltas, 5*time.Second)
}

func TestRemoteStreamAnswerOversizedFrameClosesNoPanic(t *testing.T) {
	// 2MB 单帧 > 64KB/行 Scanner 上限：记 Warn 关流，进程无恙（brief Step 1 / Review Focus 5）。
	capture := swapSlogDefault(t)

	bigFrame := `data: {"delta":"` + strings.Repeat("x", 2<<20) + `"}` + "\n\n"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(sseDeltaFrame("第一段")))
		w.(http.Flusher).Flush()
		w.Write([]byte(bigFrame))
		w.(http.Flusher).Flush()
		w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	a := NewRemoteAnswerer(srv.URL, "k", 10*time.Second)
	deltas, err := a.StreamAnswer(context.Background(), "q", "s")
	if err != nil {
		t.Fatalf("StreamAnswer() sync error = %v", err)
	}
	got := drainStreamWithTimeout(t, deltas, 10*time.Second)
	if len(got) > 1 || (len(got) == 1 && got[0] != "第一段") {
		t.Errorf("deltas = %q, want at most the small frame preceding the oversized one", got)
	}
	if len(warnRecords(capture)) == 0 {
		t.Errorf("超限帧必须至少记一条 Warn，got %v", capture.records)
	}
}

func TestRemoteStreamAnswerTotalByteCapStopsStream(t *testing.T) {
	// 累计字节 >4MB（Review Focus 5）：超限记 Warn、关通道，后续帧不再送出。
	capture := swapSlogDefault(t)

	line := sseDeltaFrame(strings.Repeat("a", 60_000)) // ~60KB < 64KB 行上限，走累计计数分支
	frames := 128                                      // ~7.8MB 总量 > 4MiB cap
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		for range frames {
			w.Write([]byte(line))
		}
		w.(http.Flusher).Flush()
		w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	a := NewRemoteAnswerer(srv.URL, "k", 10*time.Second)
	deltas, err := a.StreamAnswer(context.Background(), "q", "s")
	if err != nil {
		t.Fatalf("StreamAnswer() sync error = %v", err)
	}
	got := drainStreamWithTimeout(t, deltas, 10*time.Second)
	if len(got) == 0 {
		t.Fatal("cap 之前应有 delta 送达")
	}
	if len(got) >= frames {
		t.Errorf("received all %d frames, want cap to stop stream earlier", frames)
	}
	if received := len(got) * 60_000; received > (4<<20)+(64<<10) {
		t.Errorf("received ~%d bytes of deltas, want bounded near the 4MiB cap", received)
	}
	if len(warnRecords(capture)) == 0 {
		t.Errorf("超总字节上限必须记 Warn，got %v", capture.records)
	}
}

func TestRemoteStreamAnswerErrorFrameWarnsAndClosesWithoutDelta(t *testing.T) {
	// 冻结格式：{"error"} 帧后 Python 直接关闭、不发 [DONE]。Go 侧：Warn + 关通道，
	// 错误帧绝不变成 delta 下发（Task 11 契约：不发明错误帧）。
	capture := swapSlogDefault(t)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(sseDeltaFrame("第一段")))
		w.Write([]byte(sseDeltaFrame("第二段")))
		w.Write([]byte("data: " + `{"error": "upstream llm failure"}` + "\n\n"))
		w.(http.Flusher).Flush()
	}))
	defer srv.Close()

	a := NewRemoteAnswerer(srv.URL, "k", 10*time.Second)
	deltas, err := a.StreamAnswer(context.Background(), "q", "s")
	if err != nil {
		t.Fatalf("StreamAnswer() sync error = %v", err)
	}
	got := drainStreamWithTimeout(t, deltas, 5*time.Second)
	if want := []string{"第一段", "第二段"}; strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("deltas = %q, want %q (error frame must not be forwarded as delta)", got, want)
	}
	warns := warnRecords(capture)
	if len(warns) != 1 {
		t.Fatalf("warn records = %d, want exactly 1 (%v)", len(warns), capture.records)
	}
}

// TestRemoteStreamAnswerTrickleSurvivesShortUnaryTimeout 钉死 controller 裁定：
// 流式路径走独立 streamClient（Timeout=0），NewRemoteAnswerer 的一元档超时
// 绝不得掐死合法长流。修复前（StreamAnswer 共用 a.client）本测试必挂：30ms
// client.Timeout 覆盖整个交换含 body 读 → ~1-2 帧后被掐、通道提前 close。
func TestRemoteStreamAnswerTrickleSurvivesShortUnaryTimeout(t *testing.T) {
	const trickle = 20 * time.Millisecond
	want := make([]string, 10)
	for i := range want {
		want[i] = fmt.Sprintf("断%d", i)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		for i := range 10 {
			w.Write([]byte(sseDeltaFrame(fmt.Sprintf("断%d", i))))
			w.(http.Flusher).Flush()
			time.Sleep(trickle)
		}
		w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	// 一元档超时 30ms：整个慢流（~200ms）早于此预算，唯有 streamClient 免疫。
	a := NewRemoteAnswerer(srv.URL, "k", 30*time.Millisecond)
	deltas, err := a.StreamAnswer(context.Background(), "q", "s")
	if err != nil {
		t.Fatalf("StreamAnswer() sync error = %v", err)
	}
	got := drainStreamWithTimeout(t, deltas, 5*time.Second)
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("deltas = %q, want all 10 trickle frames + clean [DONE]-terminated close (client.Timeout 掐流=裁定违规)", got)
	}
}

func TestRemoteStreamAnswerSkipsMalformedFrames(t *testing.T) {
	// 宽容解析：坏 JSON / 无 data: 前缀的行记 Warn 跳过，绝不拖垮整个流。
	capture := swapSlogDefault(t)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("this line has no data prefix\n\n"))
		w.Write([]byte("data: {not valid json\n\n"))
		w.Write([]byte(sseDeltaFrame("好帧")))
		w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	a := NewRemoteAnswerer(srv.URL, "k", 5*time.Second)
	deltas, err := a.StreamAnswer(context.Background(), "q", "s")
	if err != nil {
		t.Fatalf("StreamAnswer() sync error = %v", err)
	}
	got := drainStreamWithTimeout(t, deltas, 5*time.Second)
	if len(got) != 1 || got[0] != "好帧" {
		t.Errorf("deltas = %q, want [好帧]", got)
	}
	if len(warnRecords(capture)) < 2 {
		t.Errorf("两条畸形帧应各记 Warn，got %v", capture.records)
	}
}
