package httpapi

import (
	"PersonalCloudStorage/internal/folder"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

type createFolderRequest struct {
	ParentID uint64 `json:"parent_id"`
	Name     string `json:"name" binding:"required"`
}

type renameFolderRequest struct {
	Name string `json:"name" binding:"required"`
}

type moveFolderRequest struct {
	ParentID *uint64 `json:"parent_id" binding:"required"`
}

type folderResponse struct {
	ID        uint64    `json:"id"`
	ParentID  uint64    `json:"parent_id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type listFoldersResponse struct {
	Items []folderResponse `json:"items"`
}

type FolderHandler struct {
	service *folder.Service
}

func NewFolderHandler(service *folder.Service) *FolderHandler {
	return &FolderHandler{
		service: service,
	}
}

func (h *FolderHandler) Create(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	var request createFolderRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid create folder request",
		})
		return
	}

	created, err := h.service.Create(
		c.Request.Context(),
		folder.CreateInput{
			OwnerID:  ownerID,
			ParentID: request.ParentID,
			Name:     request.Name,
		},
	)

	if err != nil {
		switch {
		case errors.Is(err, folder.ErrInvalidFolderName):
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "invalid folder name",
			})

		case errors.Is(err, folder.ErrFolderNotFound):
			c.JSON(http.StatusNotFound, gin.H{
				"error": "parent folder not found",
			})

		case errors.Is(err, folder.ErrFolderAlreadyExists):
			c.JSON(http.StatusConflict, gin.H{
				"error": "folder already exists",
			})

		default:
			_ = c.Error(err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "create folder failed",
			})
		}

		return
	}

	c.JSON(http.StatusCreated, toFolderResponse(created))
}

func (h *FolderHandler) List(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	parentID, err := strconv.ParseUint(c.DefaultQuery("parent_id", "0"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid parent id",
		})
		return
	}

	folders, err := h.service.List(c.Request.Context(), folder.ListInput{OwnerID: ownerID, ParentID: parentID})
	if err != nil {
		if errors.Is(err, folder.ErrFolderNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "parent folder not found",
			})
			return
		}
		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "list folders failed",
		})
		return
	}

	items := make([]folderResponse, 0, len(folders))

	for i := range folders {
		items = append(items, toFolderResponse(&folders[i]))
	}

	c.JSON(http.StatusOK, listFoldersResponse{
		Items: items,
	})
}

func (h *FolderHandler) Rename(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	folderID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || folderID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid folder id",
		})
		return
	}

	var request renameFolderRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid rename folder request",
		})
		return
	}

	err = h.service.Rename(
		c.Request.Context(),
		folder.RenameInput{
			OwnerID:  ownerID,
			FolderID: folderID,
			NewName:  request.Name,
		},
	)
	if err != nil {
		switch {
		case errors.Is(err, folder.ErrInvalidFolderName):
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "invalid folder name",
			})

		case errors.Is(err, folder.ErrFolderNotFound):
			c.JSON(http.StatusNotFound, gin.H{
				"error": "folder not found",
			})

		case errors.Is(err, folder.ErrFolderAlreadyExists):
			c.JSON(http.StatusConflict, gin.H{
				"error": "folder already exists",
			})

		default:
			_ = c.Error(err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "rename folder failed",
			})
		}

		return
	}

	c.Status(http.StatusNoContent)
}

func (h *FolderHandler) Delete(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	folderID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || folderID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid folder id",
		})
		return
	}

	if err := h.service.Delete(
		c.Request.Context(),
		ownerID,
		folderID,
	); err != nil {
		switch {
		case errors.Is(err, folder.ErrFolderNotFound):
			c.JSON(http.StatusNotFound, gin.H{
				"error": "folder not found",
			})

		case errors.Is(err, folder.ErrFolderNotEmpty):
			c.JSON(http.StatusConflict, gin.H{
				"error": "folder is not empty",
			})

		default:
			_ = c.Error(err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "delete folder failed",
			})
		}

		return
	}

	c.Status(http.StatusNoContent)
}

func (h *FolderHandler) Move(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	folderID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || folderID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid folder id",
		})
		return
	}

	var request moveFolderRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid move folder request",
		})
		return
	}

	err = h.service.Move(
		c.Request.Context(), folder.MoveInput{
			OwnerID:        ownerID,
			FolderID:       folderID,
			TargetParentID: *request.ParentID,
		})
	if err != nil {
		switch {
		case errors.Is(err, folder.ErrInvalidFolderMove):
			c.JSON(http.StatusConflict, gin.H{
				"error": "invalid folder move",
			})

		case errors.Is(err, folder.ErrFolderAlreadyExists):
			c.JSON(http.StatusConflict, gin.H{
				"error": "folder already exists in target",
			})

		case errors.Is(err, folder.ErrFolderNotFound):
			c.JSON(http.StatusNotFound, gin.H{
				"error": "folder or target parent not found",
			})

		default:
			_ = c.Error(err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "move folder failed",
			})
		}

		return
	}

	c.Status(http.StatusNoContent)
}

func toFolderResponse(record *folder.Folder) folderResponse {
	return folderResponse{
		ID:        record.ID,
		ParentID:  record.ParentID,
		Name:      record.Name,
		CreatedAt: record.CreatedAt,
		UpdatedAt: record.UpdatedAt,
	}
}
