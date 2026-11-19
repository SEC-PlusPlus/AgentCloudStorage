package knowledge

import (
	"context"
	"encoding/json"
	"errors"
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
