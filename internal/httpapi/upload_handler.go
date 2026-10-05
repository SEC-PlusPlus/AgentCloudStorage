package httpapi

import (
	"PersonalCloudStorage/internal/folder"
	"PersonalCloudStorage/internal/upload"
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

const maxPartSize = 8 << 20

type UploadHandler struct {
	service *upload.Service
}

func NewUploadHandler(service *upload.Service) *UploadHandler {
	return &UploadHandler{service: service}
}

type startUploadRequest struct {
	FolderID     uint64 `json:"folder_id"`
	OriginalName string `json:"original_name" binding:"required"`
	ContentType  string `json:"content_type"`
	Size         int64  `json:"size" binding:"required,gt=0"`
}

func (h *UploadHandler) Start(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	var req startUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid upload request"})
		return
	}

	session, err := h.service.Start(c.Request.Context(), upload.StartInput{
		OwnerID:      ownerID,
		FolderID:     req.FolderID,
		OriginalName: req.OriginalName,
		ContentType:  req.ContentType,
		Size:         req.Size,
	})
	if err != nil {
		switch {
		case errors.Is(err, folder.ErrFolderNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "folder not found"})
		case errors.Is(err, upload.ErrQuotaExceeded):
			c.JSON(http.StatusInsufficientStorage, gin.H{"error": "storage quota exceeded"})
		default:
			_ = c.Error(err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "start upload failed"})
		}
		return
	}

	// 不直接返回 Session：其中包含内部 MinIO uploadID 和 object key。
	c.JSON(http.StatusCreated, gin.H{
		"id":         session.ID,
		"part_size":  session.PartSize,
		"expires_at": session.ExpiresAt,
	})
}

func (h *UploadHandler) UploadPart(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	number, err := strconv.Atoi(c.Param("number"))
	if err != nil || number < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid part number"})
		return
	}

	// 这里接收的是原始二进制请求体，不是 multipart/form-data。
	size := c.Request.ContentLength
	if size <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "content length is required"})
		return
	}
	if size > maxPartSize {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "part is too large"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxPartSize)

	part, err := h.service.UploadPart(c.Request.Context(), upload.UploadPartInput{
		OwnerID:    ownerID,
		SessionID:  c.Param("id"),
		PartNumber: number,
		Size:       size,
		Reader:     c.Request.Body,
	})
	if err != nil {
		switch {
		case errors.Is(err, upload.ErrSessionNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "upload session not found"})
		case errors.Is(err, upload.ErrSessionNotUploading):
			c.JSON(http.StatusConflict, gin.H{"error": "upload session is not active"})
		case errors.Is(err, upload.ErrInvalidPart):
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid part number or size"})
		default:
			_ = c.Error(err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "upload part failed"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"part_number": part.PartNumber,
		"size":        part.Size,
	})
}

func (h *UploadHandler) Progress(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	result, err := h.service.Progress(
		c.Request.Context(),
		ownerID,
		c.Param("id"),
	)
	if err != nil {
		if errors.Is(err, upload.ErrSessionNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "upload session not found"})
			return
		}
		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "get upload progress failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":             result.SessionID,
		"status":         result.Status,
		"size":           result.Size,
		"part_size":      result.PartSize,
		"total_parts":    result.TotalParts,
		"uploaded_parts": result.UploadedParts,
		"expires_at":     result.ExpiresAt,
	})
}

// Complete 合并所有分片，并在数据库中创建文件记录。
func (h *UploadHandler) Complete(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	savedFile, err := h.service.Complete(
		c.Request.Context(),
		ownerID,
		c.Param("id"),
	)
	if err != nil {
		switch {
		case errors.Is(err, upload.ErrSessionNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "upload session not found"})
		case errors.Is(err, upload.ErrIncompleteUpload):
			c.JSON(http.StatusConflict, gin.H{"error": "upload parts are incomplete"})
		case errors.Is(err, upload.ErrSessionNotUploading),
			errors.Is(err, upload.ErrSessionNotCompleting):
			c.JSON(http.StatusConflict, gin.H{"error": "upload session cannot be completed"})
		case errors.Is(err, upload.ErrCompletionPending):
			c.JSON(http.StatusConflict, gin.H{
				"error": "upload completion is pending; retry complete",
			})
		default:
			_ = c.Error(err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "complete upload failed"})
		}
		return
	}

	// 不向客户端暴露 MinIO 的 object key。
	c.JSON(http.StatusOK, gin.H{
		"id":            savedFile.ID,
		"folder_id":     savedFile.FolderID,
		"original_name": savedFile.OriginalName,
		"size":          savedFile.Size,
		"content_type":  savedFile.ContentType,
		"created_at":    savedFile.CreatedAt,
	})
}

// Cancel 取消尚未完成的上传，释放预留容量并清理 MinIO 分片。
func (h *UploadHandler) Cancel(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	err := h.service.Cancel(
		c.Request.Context(),
		ownerID,
		c.Param("id"),
	)
	if err != nil {
		switch {
		case errors.Is(err, upload.ErrSessionNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "upload session not found"})
		case errors.Is(err, upload.ErrSessionNotUploading):
			c.JSON(http.StatusConflict, gin.H{"error": "upload session cannot be cancelled"})
		default:
			_ = c.Error(err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "cancel upload failed"})
		}
		return
	}

	c.Status(http.StatusNoContent)
}
