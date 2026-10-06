package httpapi

import (
	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/knowledge"
	"errors"
	"net/http"

	"github.com/cloudwego/eino/components/model"
	"github.com/gin-gonic/gin"
)

type KnowledgeHandler struct {
	files     *file.Service
	chatModel model.BaseChatModel
}

func NewKnowledgeHandler(files *file.Service, chatModel model.BaseChatModel) *KnowledgeHandler {
	return &KnowledgeHandler{
		files:     files,
		chatModel: chatModel,
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

	answer, err := knowledge.AskFile(
		c.Request.Context(),
		h.files,
		h.chatModel,
		ownerID,
		req.FileID,
		req.Question,
	)
	if err != nil {
		if errors.Is(err, file.ErrFileNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ask file failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"answer": answer})
}
