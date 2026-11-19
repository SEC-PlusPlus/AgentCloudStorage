package httpapi

import (
	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/knowledge"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
