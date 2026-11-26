package httpapi

import (
	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/folder"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

const maxUploadSize = 50 << 20

type moveFileRequest struct {
	FolderID *uint64 `json:"folder_id" binding:"required"`
}

type renameFileRequest struct {
	Name string `json:"name" binding:"required"`
}

// instantFileRequest is the POST /files/instant body (spec §2.3).
// folder_id is optional (absent/0 = root, like Upload's default "0");
// sha256/original_name/content_type are required strings — shape errors are
// 400, the sha hex rule itself is validated (ErrInvalidSha256) in the service.
type instantFileRequest struct {
	Sha256       string  `json:"sha256" binding:"required"`
	OriginalName string  `json:"original_name" binding:"required"`
	ContentType  string  `json:"content_type" binding:"required"`
	FolderID     *uint64 `json:"folder_id"`
}

type storageUsageResponse struct {
	UsedBytes  int64 `json:"used_bytes"`
	QuotaBytes int64 `json:"quota_bytes"`
}

type fileListItemResponse struct {
	ID           uint64    `json:"id"`
	FolderID     uint64    `json:"folder_id"`
	OriginalName string    `json:"original_name"`
	Size         int64     `json:"size"`
	ContentType  string    `json:"content_type"`
	CreatedAt    time.Time `json:"created_at"`
}

type trashFileItemResponse struct {
	ID           uint64     `json:"id"`
	FolderID     uint64     `json:"folder_id"`
	OriginalName string     `json:"original_name"`
	Size         int64      `json:"size"`
	ContentType  string     `json:"content_type"`
	CreatedAt    time.Time  `json:"created_at"`
	DeletedAt    *time.Time `json:"deleted_at"`
}

type listTrashResponse struct {
	Items      []trashFileItemResponse `json:"items"`
	Pagination paginationResponse      `json:"pagination"`
}

type paginationResponse struct {
	Page     int   `json:"page"`
	PageSize int   `json:"page_size"`
	Total    int64 `json:"total"`
}

type listFilesResponse struct {
	Items      []fileListItemResponse `json:"items"`
	Pagination paginationResponse     `json:"pagination"`
}

// FileServiceAPI is the handler's view of *file.Service — the same narrow-
// interface seam ShareAPI already uses in this package (share_handler.go).
// Production passes the real *file.Service; tests inject a fake to drive
// every instant-upload status without a database.
type FileServiceAPI interface {
	Upload(ctx context.Context, input file.UploadInput) (*file.File, error)
	List(ctx context.Context, input file.ListInput) (*file.ListResult, error)
	Download(ctx context.Context, ownerID uint64, fileID uint64) (*file.DownloadResult, error)
	Delete(ctx context.Context, ownerID uint64, fileID uint64) error
	ListTrash(ctx context.Context, input file.ListInput) (*file.ListResult, error)
	Restore(ctx context.Context, ownerID uint64, fileID uint64) error
	PermanentDelete(ctx context.Context, ownerID uint64, fileID uint64) error
	Move(ctx context.Context, input file.MoveInput) error
	Rename(ctx context.Context, input file.RenameInput) error
	Search(ctx context.Context, input file.SearchInput) (*file.ListResult, error)
	StorageUsage(ctx context.Context, ownerID uint64) (*file.StorageUsageResult, error)
	InstantUpload(ctx context.Context, input file.InstantInput) (*file.File, error)
}

type FileHandler struct {
	service FileServiceAPI
}

func NewFileHandler(service FileServiceAPI) *FileHandler {
	return &FileHandler{
		service: service,
	}
}

var _ FileServiceAPI = (*file.Service)(nil)

func requireCurrentUserID(c *gin.Context) (uint64, bool) {
	userID, ok := CurrentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "unauthorized",
		})
		return 0, false
	}
	return userID, ok
}

func (h *FileHandler) Upload(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxUploadSize)

	uploadedFile, header, err := c.Request.FormFile("file")
	if err != nil {
		var maxByteErr *http.MaxBytesError
		if errors.As(err, &maxByteErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{
				"error": "file is too large",
			})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "file field is required",
		})
		return
	}
	defer uploadedFile.Close()

	folderIDText := c.DefaultPostForm("folder_id", "0")

	folderID, err := strconv.ParseUint(folderIDText, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid folder id",
		})
		return
	}

	created, err := h.service.Upload(c.Request.Context(), file.UploadInput{
		OwnerID:      ownerID,
		FolderID:     folderID,
		OriginalName: header.Filename,
		ContentType:  header.Header.Get("Content-Type"),
		Size:         header.Size,
		Reader:       uploadedFile,
	})
	if err != nil {
		if errors.Is(err, file.ErrInvalidFileName) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "invalid file name",
			})
			return
		}

		if errors.Is(err, folder.ErrFolderNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "folder not found",
			})
			return
		}

		if errors.Is(err, file.ErrQuotaExceeded) {
			c.JSON(http.StatusInsufficientStorage, gin.H{
				"error": "storage quota exceeded",
			})
			return
		}

		if errors.Is(err, file.ErrBlobBusy) {
			// B4: the dedup transaction lost every InnoDB lock round against
			// same-sha concurrency. No row committed, tmp cleaned, the upload
			// is safely retryable — the same 409 face the instant probe uses.
			c.JSON(http.StatusConflict, gin.H{
				"error": "blob busy, retry",
			})
			return
		}

		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "upload file failed",
		})
		return
	}
	c.JSON(http.StatusCreated, fileSuccessResponse(created))
}

// fileSuccessResponse is THE success shape for a materialized file row —
// shared by POST /files and POST /files/instant so the instant 201 is
// field-for-field identical to the upload 201 by construction (spec §2.3:
// "与 POST /files 逐字段同形").
func fileSuccessResponse(created *file.File) gin.H {
	return gin.H{
		"id":            created.ID,
		"folder_id":     created.FolderID,
		"original_name": created.OriginalName,
		"object_key":    created.ObjectKey,
		"size":          created.Size,
		"content_type":  created.ContentType,
		"created_at":    created.CreatedAt,
	}
}

// InstantUpload answers POST /files/instant (秒传 probe, spec §1.3/§2.3):
// a blob hit links a files row for the caller without byte transfer (201,
// identical shape to POST /files); a cold sha is NOT an error — it answers
// 200 {"exists": false} with a deliberately disjoint shape (the client then
// falls back to the real upload). Error faces: 400 bad shape/sha/name,
// 404 folder (foreign and missing share one face), 507 quota (Upload's
// body), 409 blob busy (bounded InnoDB lock retries exhausted, client may
// re-probe), 500 anything else.
func (h *FileHandler) InstantUpload(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	var request instantFileRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid instant upload request",
		})
		return
	}

	folderID := uint64(0)
	if request.FolderID != nil {
		folderID = *request.FolderID
	}

	created, err := h.service.InstantUpload(c.Request.Context(), file.InstantInput{
		OwnerID:      ownerID,
		Sha256:       request.Sha256,
		OriginalName: request.OriginalName,
		ContentType:  request.ContentType,
		FolderID:     folderID,
	})
	if err != nil {
		switch {
		case errors.Is(err, file.ErrBlobNotFound):
			// The one success-shaped miss: client uploads normally.
			c.JSON(http.StatusOK, gin.H{
				"exists": false,
			})

		case errors.Is(err, file.ErrInvalidSha256):
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "invalid sha256",
			})

		case errors.Is(err, file.ErrInvalidFileName):
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "invalid file name",
			})

		case errors.Is(err, folder.ErrFolderNotFound):
			c.JSON(http.StatusNotFound, gin.H{
				"error": "folder not found",
			})

		case errors.Is(err, file.ErrQuotaExceeded):
			// Same 507 body as the direct Upload.
			c.JSON(http.StatusInsufficientStorage, gin.H{
				"error": "storage quota exceeded",
			})

		case errors.Is(err, file.ErrBlobBusy):
			c.JSON(http.StatusConflict, gin.H{
				"error": "blob busy, retry",
			})

		default:
			_ = c.Error(err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "instant upload failed",
			})
		}
		return
	}

	c.JSON(http.StatusCreated, fileSuccessResponse(created))
}

func (h *FileHandler) List(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	folderID, err := strconv.ParseUint(
		c.DefaultQuery("folder_id", "0"),
		10,
		64,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid folder id",
		})
		return
	}
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 || page > 10000 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "page must be between 1 and 10000",
		})
		return
	}

	pageSize, err := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if err != nil || pageSize < 1 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "page_size must be a positive integer",
		})
		return
	}
	result, err := h.service.List(c.Request.Context(), file.ListInput{
		OwnerID:  ownerID,
		FolderID: folderID,
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		if errors.Is(err, folder.ErrFolderNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "folder not found",
			})
			return
		}

		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "list files failed",
		})
		return
	}

	items := make([]fileListItemResponse, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, fileListItemResponse{
			ID:           item.ID,
			FolderID:     item.FolderID,
			OriginalName: item.OriginalName,
			Size:         item.Size,
			ContentType:  item.ContentType,
			CreatedAt:    item.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, listFilesResponse{
		Items: items,
		Pagination: paginationResponse{
			Page:     result.Page,
			PageSize: result.PageSize,
			Total:    result.Total},
	})
}

func (h *FileHandler) Download(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	fileID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || fileID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid file id",
		})
		return
	}

	result, err := h.service.Download(c.Request.Context(), ownerID, fileID)
	if err != nil {
		if errors.Is(err, file.ErrFileNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "file not found",
			})
			return
		}
		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "download file failed",
		})
		return
	}
	defer result.Reader.Close()

	disposition := mime.FormatMediaType(
		"attachment",
		map[string]string{
			"filename": result.OriginalName,
		})

	c.Header("Content-Disposition", disposition)
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Length", strconv.FormatInt(result.Size, 10))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Status(http.StatusOK)

	if _, err := io.Copy(c.Writer, result.Reader); err != nil {
		_ = c.Error(fmt.Errorf("stream file response: %w", err))
		return
	}
}

func (h *FileHandler) Delete(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	fileID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || fileID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid file id",
		})
		return
	}
	err = h.service.Delete(c.Request.Context(), ownerID, fileID)
	if err != nil {
		if errors.Is(err, file.ErrFileNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "file not found",
			})
			return
		}
		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "delete file failed",
		})
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *FileHandler) ListTrash(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 || page > 10000 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "page must be between 1 and 10000",
		})
		return
	}

	pageSize, err := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if err != nil || pageSize < 1 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "page_size must be a positive integer",
		})
		return
	}

	result, err := h.service.ListTrash(c.Request.Context(), file.ListInput{
		OwnerID:  ownerID,
		Page:     page,
		PageSize: pageSize,
	})

	if err != nil {
		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "list trash files failed",
		})
		return
	}

	items := make([]trashFileItemResponse, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, trashFileItemResponse{
			ID:           item.ID,
			FolderID:     item.FolderID,
			OriginalName: item.OriginalName,
			Size:         item.Size,
			ContentType:  item.ContentType,
			CreatedAt:    item.CreatedAt,
			DeletedAt:    item.DeletedAt,
		})
	}

	c.JSON(http.StatusOK, listTrashResponse{
		Items: items,
		Pagination: paginationResponse{
			Page:     result.Page,
			PageSize: result.PageSize,
			Total:    result.Total,
		},
	})
}

func (h *FileHandler) Restore(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	fileID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || fileID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid file id",
		})
		return
	}

	err = h.service.Restore(c.Request.Context(), ownerID, fileID)
	if err != nil {
		if errors.Is(err, file.ErrFileNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "file not found in trash",
			})
			return
		}
		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "restore file failed",
		})
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *FileHandler) PermanentDelete(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	fileID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || fileID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid file id",
		})
		return
	}

	err = h.service.PermanentDelete(c.Request.Context(), ownerID, fileID)
	if err != nil {
		if errors.Is(err, file.ErrFileNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "file not found in trash",
			})
			return
		}
		if errors.Is(err, file.ErrBlobBusy) {
			// B5: the dedup delete tx (objects-first, then the legacy
			// files→users tail) lost every InnoDB lock round against a
			// concurrent same-sha acquire. Nothing was
			// committed — refcount and rows are untouched — so the client may
			// simply retry. Same 409 face as Upload/InstantUpload.
			c.JSON(http.StatusConflict, gin.H{
				"error": "blob busy, retry",
			})
			return
		}
		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "permanetly delete file failed",
		})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *FileHandler) Move(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	fileID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || fileID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid file id",
		})
		return
	}

	var request moveFileRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid move file request",
		})
		return
	}

	err = h.service.Move(c.Request.Context(), file.MoveInput{
		OwnerID:        ownerID,
		FileID:         fileID,
		TargetFolderID: *request.FolderID,
	})

	if err != nil {
		switch {
		case errors.Is(err, file.ErrFileNotFound):
			c.JSON(http.StatusNotFound, gin.H{
				"error": "file not found",
			})

		case errors.Is(err, folder.ErrFolderNotFound):
			c.JSON(http.StatusNotFound, gin.H{
				"error": "target folder not found",
			})

		default:
			_ = c.Error(err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "move file failed",
			})
		}
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *FileHandler) Rename(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	fileID, err := strconv.ParseUint(
		c.Param("id"),
		10,
		64,
	)
	if err != nil || fileID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid file id",
		})
		return
	}

	var request renameFileRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid rename file request",
		})
		return
	}

	err = h.service.Rename(
		c.Request.Context(),
		file.RenameInput{
			OwnerID: ownerID,
			FileID:  fileID,
			NewName: request.Name,
		},
	)
	if err != nil {
		switch {
		case errors.Is(err, file.ErrInvalidFileName):
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "invalid file name",
			})

		case errors.Is(err, file.ErrFileNotFound):
			c.JSON(http.StatusNotFound, gin.H{
				"error": "file not found",
			})

		default:
			_ = c.Error(err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "rename file failed",
			})
		}

		return
	}

	c.Status(http.StatusNoContent)
}

func (h *FileHandler) Search(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 || page > 10000 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "page must be between 1 and 10000",
		})
		return
	}

	pageSize, err := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if err != nil || pageSize < 1 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "page_size must be a positive integer",
		})
		return
	}

	result, err := h.service.Search(c.Request.Context(), file.SearchInput{
		OwnerID:  ownerID,
		Keyword:  c.Query("q"),
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		if errors.Is(err, file.ErrInvalidSearchKeyword) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "invalid search keyword",
			})
			return
		}

		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "search files failed",
		})
		return
	}

	items := make([]fileListItemResponse, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, fileListItemResponse{
			ID:           item.ID,
			FolderID:     item.FolderID,
			OriginalName: item.OriginalName,
			Size:         item.Size,
			ContentType:  item.ContentType,
			CreatedAt:    item.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, listFilesResponse{
		Items: items,
		Pagination: paginationResponse{
			Page:     result.Page,
			PageSize: result.PageSize,
			Total:    result.Total,
		},
	})
}

func (h *FileHandler) StorageUsage(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	result, err := h.service.StorageUsage(c.Request.Context(), ownerID)
	if err != nil {
		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "get storage usage failed",
		})
		return
	}

	c.JSON(http.StatusOK, storageUsageResponse{
		UsedBytes:  result.UsedBytes,
		QuotaBytes: result.QuotaBytes,
	})
}
