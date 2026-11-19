package httpapi

import (
	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/knowledge"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestStatusForAskError(t *testing.T) {
	tests := []struct {
		name    string
		err     error
		status  int
		message string
	}{
		{
			name:    "file not found",
			err:     file.ErrFileNotFound,
			status:  http.StatusNotFound,
			message: "file not found",
		},
		{
			name:    "file not found wrapped one layer",
			err:     fmt.Errorf("prepare file: %w", file.ErrFileNotFound),
			status:  http.StatusNotFound,
			message: "file not found",
		},
		{
			name:    "agent unauthorized maps to 500, not degraded",
			err:     knowledge.ErrAgentUnauthorized,
			status:  http.StatusInternalServerError,
			message: "agent misconfigured",
		},
		{
			// 与 remote.go 的实际包装形态一致（多 %w，Go 1.20+）。
			name:    "agent unauthorized wrapped",
			err:     fmt.Errorf("agent rejected credentials: status %d (%w)", http.StatusUnauthorized, knowledge.ErrAgentUnauthorized),
			status:  http.StatusInternalServerError,
			message: "agent misconfigured",
		},
		{
			name:    "agent unavailable",
			err:     knowledge.ErrAgentUnavailable,
			status:  http.StatusServiceUnavailable,
			message: "AI 服务暂不可用",
		},
		{
			name:    "agent unavailable wrapped",
			err:     fmt.Errorf("call agent service: %w (%w)", knowledge.ErrAgentUnavailable, errors.New("dial tcp: connection refused")),
			status:  http.StatusServiceUnavailable,
			message: "AI 服务暂不可用",
		},
		{
			name:    "upstream llm",
			err:     knowledge.ErrUpstreamLLM,
			status:  http.StatusBadGateway,
			message: "AI 服务繁忙，请稍后重试",
		},
		{
			name:    "upstream llm wrapped",
			err:     fmt.Errorf("decode agent answer: %w (%w)", knowledge.ErrUpstreamLLM, errors.New("invalid character")),
			status:  http.StatusBadGateway,
			message: "AI 服务繁忙，请稍后重试",
		},
		{
			name:    "plain error falls through to default",
			err:     errors.New("question is too long"),
			status:  http.StatusInternalServerError,
			message: "ask file failed",
		},
		{
			name:    "nil-safe default for unknown wrapped error",
			err:     fmt.Errorf("some layer: %w", errors.New("boom")),
			status:  http.StatusInternalServerError,
			message: "ask file failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, message := statusForAskError(tt.err)
			if status != tt.status {
				t.Errorf("status = %d, want %d", status, tt.status)
			}
			if message != tt.message {
				t.Errorf("message = %q, want %q", message, tt.message)
			}
		})
	}
}

// 非法 JSON body 仍走 400 分支，行为不变（spec §7：公网入参校验先于 ask）。
func TestAskRejectsInvalidJSONBody(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// 400 路径在 AskFile 之前返回，files/answerer 不会被触碰。
	handler := NewKnowledgeHandler(nil, nil)

	router := gin.New()
	router.POST("/api/knowledge/ask", func(c *gin.Context) {
		c.Set(currentUserIDKey, uint64(42))
	}, handler.Ask)

	req := httptest.NewRequest(http.MethodPost, "/api/knowledge/ask", strings.NewReader(`{"file_id":`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}

	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response body %q: %v", rec.Body.String(), err)
	}
	if body["error"] != "invalid ask request" {
		t.Errorf("error = %q, want %q", body["error"], "invalid ask request")
	}
}

// ---- Task 11：SSE 流式透传（头三件套 / 帧字节 / 开流前错误仍是普通 JSON）----

func TestSetSSEHeadersExactTrio(t *testing.T) {
	// Review Focus 2：三个头逐字精确，多一个少一个都不行。
	h := http.Header{}
	setSSEHeaders(h)

	want := map[string]string{
		"Content-Type":      "text/event-stream",
		"Cache-Control":     "no-cache",
		"X-Accel-Buffering": "no",
	}
	for k, v := range want {
		if got := h.Get(k); got != v {
			t.Errorf("header %q = %q, want %q", k, got, v)
		}
	}
	if len(h) != len(want) {
		t.Errorf("header count = %d (%v), want exactly %d", len(h), h, len(want))
	}
}

type flushCounter struct{ n int }

func (f *flushCounter) Flush() { f.n++ }

func TestStreamSSEFrameBytesAndDoneTerminator(t *testing.T) {
	// 冻结下行契约：每 delta 一帧（encoding/json 转义），通道 close 后补 [DONE]。
	deltas := make(chan string, 3)
	deltas <- "第一段"
	deltas <- "带\"引号\"\n换行与\\反斜杠"
	close(deltas)

	buf := &bytes.Buffer{}
	counter := &flushCounter{}
	if err := streamSSE(buf, counter, deltas); err != nil {
		t.Fatalf("streamSSE() error = %v", err)
	}

	want := "data: " + `{"delta":"第一段"}` + "\n\n" +
		"data: " + `{"delta":"带\"引号\"\n换行与\\反斜杠"}` + "\n\n" +
		"data: [DONE]\n\n"
	if buf.String() != want {
		t.Errorf("SSE bytes =\n%q\nwant\n%q", buf.String(), want)
	}
	if counter.n != 3 { // 两帧各一次 + [DONE] 收尾一次
		t.Errorf("flushes = %d, want 3", counter.n)
	}

	// 无 Flusher 的实现不得 panic（防御分支）。
	buf2 := &bytes.Buffer{}
	empty := make(chan string)
	close(empty)
	if err := streamSSE(buf2, nil, empty); err != nil {
		t.Fatalf("streamSSE(nil flusher) error = %v", err)
	}
	if buf2.String() != "data: [DONE]\n\n" {
		t.Errorf("zero-delta stream bytes = %q, want bare [DONE] frame (Python 空答案契约直通)", buf2.String())
	}
}

// 开流前（PrepareAsk）错误在 stream=true 时也必须保持普通 JSON，绝不开 SSE 流（spec §5/§7）。
func TestAskStreamPreStreamErrorStaysPlainJSON(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// files/answerer 传 nil：question 超长在 PrepareAsk 第一步就败，两依赖都不会被触碰。
	handler := NewKnowledgeHandler(nil, nil)
	router := gin.New()
	router.POST("/api/knowledge/ask", func(c *gin.Context) {
		c.Set(currentUserIDKey, uint64(42))
	}, handler.Ask)

	longQuestion := strings.Repeat("问", 501) // > maxQuestionRunes=500，先于文件读取失败
	body := `{"file_id":1,"question":"` + longQuestion + `","stream":true}`
	req := httptest.NewRequest(http.MethodPost, "/api/knowledge/ask", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type = %q, want plain JSON before stream opens", ct)
	}
	if rec.Header().Get("X-Accel-Buffering") != "" {
		t.Error("X-Accel-Buffering must not be set on pre-stream JSON error")
	}
	if strings.Contains(rec.Body.String(), "data:") {
		t.Errorf("body = %q, must not contain SSE frames", rec.Body.String())
	}
	var m map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("error body not JSON: %v (%q)", err, rec.Body.String())
	}
	if m["error"] != "ask file failed" {
		t.Errorf("error = %q, want %q", m["error"], "ask file failed")
	}
}

// StreamAnswer 同步哨兵错误 → 与 statusForAskError 同表映射为普通 JSON（helper 级单测；
// 端到端真流归 Task 12 smoke）。
func TestRespondAskPreStreamErrorSentinels(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewKnowledgeHandler(nil, nil)

	cases := []struct {
		err    error
		status int
		msg    string
	}{
		{fmt.Errorf("agent rejected credentials: status 401 (%w)", knowledge.ErrAgentUnauthorized), 500, "agent misconfigured"},
		{fmt.Errorf("call agent service: %w", knowledge.ErrAgentUnavailable), 503, "AI 服务暂不可用"},
		{fmt.Errorf("agent reports upstream llm failure: %w", knowledge.ErrUpstreamLLM), 502, "AI 服务繁忙，请稍后重试"},
	}
	for _, tc := range cases {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		handler.respondAskPreStreamError(c, 42, 7, tc.err, time.Now())

		if rec.Code != tc.status {
			t.Errorf("err %v: status = %d, want %d", tc.err, rec.Code, tc.status)
		}
		var m map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
			t.Fatalf("err %v: body not JSON: %v (%q)", tc.err, err, rec.Body.String())
		}
		if m["error"] != tc.msg {
			t.Errorf("err %v: error = %q, want %q", tc.err, m["error"], tc.msg)
		}
		if strings.Contains(rec.Body.String(), "data: ") {
			t.Errorf("err %v: body must be plain JSON, got %q", tc.err, rec.Body.String())
		}
	}
}
