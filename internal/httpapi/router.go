package httpapi

import (
	"PersonalCloudStorage/internal/auth"

	"github.com/gin-gonic/gin"
)

func NewRouter(fileHandler *FileHandler, folderHandler *FolderHandler, authHandler *AuthHandler, tokenManager *auth.TokenManager) *gin.Engine {
	router := gin.New()

	router.Use(gin.Logger())
	router.Use(gin.Recovery())

	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status": "ok",
		})
	})

	api := router.Group("/api/v1")
	{
		api.POST("/auth/register", authHandler.Register)
		api.POST("/auth/login", authHandler.Login)

		protected := api.Group("")
		protected.Use(RequireAuth(tokenManager))
		{
			protected.GET("/files", fileHandler.List)
			protected.POST("/files", fileHandler.Upload)
			protected.GET("/files/:id/content", fileHandler.Download)
			protected.DELETE("/files/:id", fileHandler.Delete)
			protected.PATCH("/files/:id", fileHandler.Rename)
			protected.POST("/files/:id/restore", fileHandler.Restore)
			protected.PATCH("/files/:id/move", fileHandler.Move)
			protected.GET("/files/search", fileHandler.Search)
			protected.GET("/storage/usage", fileHandler.StorageUsage)


			protected.POST("/folders", folderHandler.Create)
			protected.GET("/folders", folderHandler.List)
			protected.PATCH("/folders/:id", folderHandler.Rename)
			protected.DELETE("/folders/:id", folderHandler.Delete)
			protected.PATCH("/folders/:id/move", folderHandler.Move)

			protected.GET("/trash", fileHandler.ListTrash)
			protected.DELETE("/trash/:id", fileHandler.PermanentDelete)
		}
	}

	return router
}
