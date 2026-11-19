package httpapi

import (
	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/knowledge"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type KnowledgeHandler struct {
	files    *file.Service
	answerer knowledge.Answerer
}

func NewKnowledgeHandler(files *file.Service, answerer knowledge.Answerer) *KnowledgeHandler {
	return &KnowledgeHandler{
		files:    files,
		answerer: answerer,
	}
}

type askFileRequest struct {
	FileID   uint64 `json:"file_id" binding:"required"`
	Question string `json:"question" binding:"required"`
}

func (h *KnowledgeHandler) Ask(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	// 问题很短，无需接受任意大小的请求体。
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)

	var req askFileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ask request"})
		return
	}

	start := time.Now()
	answer, err := knowledge.AskFile(
		c.Request.Context(),
		h.files,
		h.answerer,
		ownerID,
		req.FileID,
		req.Question,
	)

	// spec §8 审计：每次 ask 结束记一条结构化日志，成功与失败都记。
	slog.Info("ask file",
		"owner_id", ownerID,
		"file_id", req.FileID,
		"elapsed_ms", time.Since(start).Milliseconds(),
		"ok", err == nil,
	)

	if err != nil {
		if errors.Is(err, knowledge.ErrAgentUnauthorized) {
			// 配置错误必须响亮（Review Focus 4）：slog.Error + 500，不降级为 503/502。
			slog.Error("agent misconfigured",
				"owner_id", ownerID,
				"file_id", req.FileID,
				"error", err,
			)
		}
		status, message := statusForAskError(err)
		_ = c.Error(err)
		c.JSON(status, gin.H{"error": message})
		return
	}

	c.JSON(http.StatusOK, gin.H{"answer": answer})
}

// statusForAskError 把 ask 链路错误映射为公网状态码与文案（spec §5/§7）。
// 纯函数：错误分类不产生副作用，slog.Error 由调用方处理。
func statusForAskError(err error) (int, string) {
	switch {
	case errors.Is(err, file.ErrFileNotFound):
		return http.StatusNotFound, "file not found"
	case errors.Is(err, knowledge.ErrAgentUnauthorized):
		return http.StatusInternalServerError, "agent misconfigured"
	case errors.Is(err, knowledge.ErrAgentUnavailable):
		return http.StatusServiceUnavailable, "AI 服务暂不可用"
	case errors.Is(err, knowledge.ErrUpstreamLLM):
		return http.StatusBadGateway, "AI 服务繁忙，请稍后重试"
	default:
		return http.StatusInternalServerError, "ask file failed"
	}
}
