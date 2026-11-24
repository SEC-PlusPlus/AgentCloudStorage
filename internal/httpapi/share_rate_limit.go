package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"PersonalCloudStorage/internal/share"

	"github.com/gin-gonic/gin"
)

// shareAccessLimiter 是中间件依赖的窄接口（仿 LoginLimiter 模式），
// 让测试可以塞本地 fake 钉死三态；生产实现是 *share.RedisAccessLimiter。
type shareAccessLimiter interface {
	Allow(ctx context.Context, key string, max int, window time.Duration) (bool, error)
}

// RequireShareRateLimit 是公开分享组的独立限流中间件（与 RequireAuth 并列，不混用）。
//
// 键必须取 c.ClientIP()（真实访客 IP，依赖 router.go 的 SetTrustedProxies）——
// 若用 RemoteAddr，生产环境所有访客塌缩进 nginx 回环同一桶，全站分享自我 DoS（spec §6）。
//
// kind 决定配额与 Redis 故障策略（spec §6 裁定，Review Focus 3）：
//   - "verify"：IP+token 桶，5 次/10min；limiter 出错 **fail-closed 503**——密码爆破闸不许失效。
//   - "read"：IP 桶，60 次/10min；limiter 出错 **fail-open 放行 + slog.Warn**——
//     公开只读路径不被 Redis 故障拖死。
//
// 超限一律 429 {"error":"rate_limited"}。
func RequireShareRateLimit(limiter shareAccessLimiter, kind string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var key string
		var max int
		var window time.Duration
		var failClosed bool

		switch kind {
		case "verify":
			key = share.VerifyKey(c.Param("token"), c.ClientIP())
			max = share.VerifyMaxAttempts
			window = share.VerifyWindow
			failClosed = true
		case "read":
			key = share.ReadKey(c.ClientIP())
			max = share.ReadMaxAttempts
			window = share.ReadWindow
			failClosed = false
		default:
			// kind 写错是启动期 programmer error：500 拦下，不许悄悄退化成某种策略。
			slog.Error("share rate limit misconfigured", "kind", kind)
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"error": "share rate limit misconfigured",
			})
			return
		}

		allowed, err := limiter.Allow(c.Request.Context(), key, max, window)
		if err != nil {
			if failClosed {
				_ = c.Error(err)
				c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
					"error": "share service temporarily unavailable",
				})
				return
			}
			slog.Warn("share rate limiter unavailable, failing open",
				"kind", kind, "error", err)
			c.Next()
			return
		}
		if !allowed {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "rate_limited",
			})
			return
		}
		c.Next()
	}
}
