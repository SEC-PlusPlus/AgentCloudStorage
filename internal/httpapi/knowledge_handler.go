package httpapi

import (
	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/knowledge"
	"encoding/json"
	"errors"
	"io"
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
	// Stream=true 走 SSE 透传（Task 11）；缺省 false，行为与旧版逐字一致。
	Stream bool `json:"stream"`
}

// SSE 下行冻结契约（Task 11）：data: {"delta": "..."}\n\n … data: [DONE]\n\n。
const sseDoneFrame = "data: [DONE]\n\n"

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
	if req.Stream {
		h.askFileStream(c, ownerID, req, start)
		return
	}
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

// askFileStream 处理 stream=true：PrepareAsk 与 StreamAnswer 的同步错误都发生在开流前，
// 走与流式无关的普通 JSON（statusForAskError 同表）；开流成功后只剩 SSE。
// spec §8 审计仍严格一次：开流前由 respondAskPreStreamError 记 ok=false，
// 流循环收尾后记 ok=(ctx 未死且写出无错)。
func (h *KnowledgeHandler) askFileStream(c *gin.Context, ownerID uint64, req askFileRequest, start time.Time) {
	ctx := c.Request.Context()

	q, source, err := knowledge.PrepareAsk(ctx, h.files, ownerID, req.FileID, req.Question)
	if err == nil {
		var deltas <-chan string
		deltas, err = h.answerer.StreamAnswer(ctx, q, source)
		if err == nil {
			setSSEHeaders(c.Writer.Header())
			flusher, _ := c.Writer.(http.Flusher)
			streamErr := streamSSE(c.Writer, flusher, deltas)

			slog.Info("ask file",
				"owner_id", ownerID,
				"file_id", req.FileID,
				"elapsed_ms", time.Since(start).Milliseconds(),
				"ok", streamErr == nil && ctx.Err() == nil,
			)
			return
		}
	}

	h.respondAskPreStreamError(c, ownerID, req.FileID, err, start)
}

// respondAskPreStreamError：开流前失败的公网出口——保持普通 JSON，与 statusForAskError
// 同表映射（401→500+misconfigured slog.Error；503/502/500 照旧）。
func (h *KnowledgeHandler) respondAskPreStreamError(c *gin.Context, ownerID, fileID uint64, err error, start time.Time) {
	if errors.Is(err, knowledge.ErrAgentUnauthorized) {
		// 配置错误必须响亮（Review Focus 4），与非流式路径逐字一致。
		slog.Error("agent misconfigured",
			"owner_id", ownerID,
			"file_id", fileID,
			"error", err,
		)
	}
	slog.Info("ask file",
		"owner_id", ownerID,
		"file_id", fileID,
		"elapsed_ms", time.Since(start).Milliseconds(),
		"ok", false,
	)
	status, message := statusForAskError(err)
	_ = c.Error(err)
	c.JSON(status, gin.H{"error": message})
}

// setSSEHeaders 是流式响应的三件套头（Review Focus 2）——纯函数，独立断言：
// text/event-stream 定协议；no-cache 防中间缓存重排；X-Accel-Buffering:no 关 nginx 缓冲，
// 帧才能逐 delta 抵达浏览器。
func setSSEHeaders(h http.Header) {
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")
}

// sseDeltaFrame 用 encoding/json 重编码 delta：引号/换行等被正确转义，
// 帧永远保持"一行 data:+空行"的 SSE 形态（浏览器 EventSource 可解析）。
func sseDeltaFrame(delta string) (string, error) {
	payload, err := json.Marshal(map[string]string{"delta": delta})
	if err != nil {
		return "", err
	}
	return "data: " + string(payload) + "\n\n", nil
}

// streamSSE 逐 delta 写帧并 Flush（Flusher 缺失时容忍降级），通道 close 后写 [DONE] 收尾。
// 上游流内错误/截断在 knowledge 层已被 close 表达，这里不发明错误帧——close 即收尾。
// 写失败（浏览器断连等）直接上抛给审计判定，不再补 [DONE]。
func streamSSE(w io.Writer, flusher http.Flusher, deltas <-chan string) error {
	for delta := range deltas {
		frame, err := sseDeltaFrame(delta)
		if err != nil {
			// map[string]string 不可能编码失败；防御性跳过而非中断整条流。
			slog.Warn("sse delta encode failed", "error", err)
			continue
		}
		if _, err := io.WriteString(w, frame); err != nil {
			return err
		}
		if flusher != nil {
			flusher.Flush()
		}
	}
	if _, err := io.WriteString(w, sseDoneFrame); err != nil {
		return err
	}
	if flusher != nil {
		flusher.Flush()
	}
	return nil
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
