package httpapi

import (
	"PersonalCloudStorage/internal/auth"
	"fmt"
	"log/slog"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
)

func NewRouter(fileHandler *FileHandler, folderHandler *FolderHandler, uploadHandler *UploadHandler, authHandler *AuthHandler, tokenManager *auth.TokenManager, knowledgeHandler *KnowledgeHandler, shareHandler *ShareHandler, shareLimiter shareAccessLimiter) *gin.Engine {
	router := gin.New()

	// 生产部署是 nginx 同机反代（deploy/nginx*.conf）：只信回环这一跳的 X-Forwarded-For，
	// 让 c.ClientIP() 拿到真实访客 IP（spec §6）。不设置的话 gin 默认信任所有代理，
	// 限流键可被伪造头投毒；直连非可信 IP 则退回 RemoteAddr。::1 一并放行——
	// nginx 监听 [::1] 时 go-net 侧 RemoteAddr 就是它（可选硬化，行为同源）。
	if err := router.SetTrustedProxies([]string{"127.0.0.1", "::1"}); err != nil {
		// 常量回环地址不会解析失败；真失败了也只降级告警，绝不 panic 掉启动。
		slog.Error("set trusted proxies failed; ClientIP falls back to RemoteAddr", "error", err)
	}

	// spec §7：访问日志禁打分享 token 全文。gin 默认 Logger 会把 path?query 原样
	// 落盘（公开 URL 自带 token，?access= 自带 JWT），换成下面的脱敏 Formatter；
	// 非 /api/v1/public/shares/ 前缀的路径逐字不变。
	router.Use(gin.LoggerWithFormatter(accessLogFormatter))
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

			// owner 侧分享路由（spec §3）：挂在 :id 节点下与 /files/instant（B 轨）
			// 的静态兄弟共存由 TestShareRoutesRegistered 钉死，冲突时 gin 在注册期 panic。
			protected.POST("/files/:id/shares", shareHandler.Create)
			protected.GET("/shares", shareHandler.List)
			protected.DELETE("/shares/:token", shareHandler.Revoke)

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

		// 访客公开组：无 RequireAuth；限流中间件按端点分桶（spec §6）——
		// meta/download 走 read（fail-open），verify 走 verify（fail-closed）。
		public := api.Group("/public/shares")
		{
			readLimit := RequireShareRateLimit(shareLimiter, "read")
			verifyLimit := RequireShareRateLimit(shareLimiter, "verify")
			public.GET("/:token", readLimit, shareHandler.Meta)
			public.POST("/:token/verify", verifyLimit, shareHandler.Verify)
			public.GET("/:token/download", readLimit, shareHandler.Download)
		}
	}

	return router
}

// accessLogFormatter 保持 gin 默认行格式，仅把 path（含 query）换成脱敏版。
func accessLogFormatter(params gin.LogFormatterParams) string {
	return fmt.Sprintf("[GIN] %s | %3d | %13v | %15s | %-7s %#v\n%s",
		params.TimeStamp.Format("2006/01/02 - 15:04:05"),
		params.StatusCode,
		params.Latency,
		params.ClientIP,
		params.Method,
		maskShareLogPath(params.Path),
		params.ErrorMessage,
	)
}

// maskShareLogPath takes gin's "path?query" and, for the public share group
// only, masks every share token past its first 8 chars — both the :token path
// segment (spec §7) and the ?access= credential. Other paths return as-is.
func maskShareLogPath(rawPath string) string {
	pathPart, queryPart := rawPath, ""
	if idx := strings.Index(rawPath, "?"); idx >= 0 {
		pathPart, queryPart = rawPath[:idx], rawPath[idx+1:]
	}
	if !strings.HasPrefix(pathPart, sharePublicURLPrefix) {
		return rawPath
	}

	remainder := pathPart[len(sharePublicURLPrefix):]
	token := remainder
	suffix := ""
	if slash := strings.Index(remainder, "/"); slash >= 0 {
		token, suffix = remainder[:slash], remainder[slash:]
	}
	masked := sharePublicURLPrefix + maskShareToken(token) + suffix

	if queryPart == "" {
		return masked
	}
	query, err := url.ParseQuery(queryPart)
	if err != nil {
		// 畸形 query 可能整段就是凭证残片：宁可全遮。
		return masked + "?***"
	}
	if access := query.Get("access"); access != "" {
		query.Set("access", maskShareToken(access))
	}
	return masked + "?" + query.Encode()
}

// maskShareToken keeps the first 8 chars for grep-ability and hides the rest
// (spec §7 "日志禁打 token 全文（前 8 字符）").
func maskShareToken(secret string) string {
	if len(secret) <= 8 {
		return secret
	}
	return secret[:8] + strings.Repeat("*", len(secret)-8)
}
