package httpapi

import (
	"PersonalCloudStorage/internal/auth"
	"log/slog"

	"github.com/gin-gonic/gin"
)

func NewRouter(fileHandler *FileHandler, folderHandler *FolderHandler, uploadHandler *UploadHandler, authHandler *AuthHandler, tokenManager *auth.TokenManager, knowledgeHandler *KnowledgeHandler) *gin.Engine {
	router := gin.New()

	// 生产部署是 nginx 同机反代（deploy/nginx*.conf）：只信回环这一跳的 X-Forwarded-For，
	// 让 c.ClientIP() 拿到真实访客 IP（spec §6）。不设置的话 gin 默认信任所有代理，
	// 限流键可被伪造头投毒；直连非可信 IP 则退回 RemoteAddr。
	if err := router.SetTrustedProxies([]string{"127.0.0.1"}); err != nil {
		// 常量回环地址不会解析失败；真失败了也只降级告警，绝不 panic 掉启动。
		slog.Error("set trusted proxies failed; ClientIP falls back to RemoteAddr", "error", err)
	}

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

			protected.POST("/uploads", uploadHandler.Start)
			protected.PUT("/uploads/:id/parts/:number", uploadHandler.UploadPart)
			protected.GET("/uploads/:id", uploadHandler.Progress)
			protected.POST("/uploads/:id/complete", uploadHandler.Complete)
			protected.DELETE("/uploads/:id", uploadHandler.Cancel)

			protected.POST("/knowledge/ask", knowledgeHandler.Ask)
		}
	}

	return router
}
