package httpapi

import (
	"PersonalCloudStorage/internal/auth"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const currentUserIDKey = "current_user_id"

func RequireAuth(tokenManager *auth.TokenManager) gin.HandlerFunc {
	if tokenManager == nil {
		panic("token manager is required")
	}

	return func(c *gin.Context) {
		authorization := c.GetHeader("Authorization")
		parts := strings.Fields(authorization)

		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "unauthorized",
			})
			return
		}

		userID, err := tokenManager.ParseAccessToken(parts[1])
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "unauthorized",
			})
			return
		}
		c.Set(currentUserIDKey, userID)
		c.Next()
	}
}

func CurrentUserID(c *gin.Context) (uint64, bool) {
	value, exists := c.Get(currentUserIDKey)
	if !exists {
		return 0, false
	}

	userID, ok := value.(uint64)
	if !ok || userID == 0 {
		return 0, false
	}

	return userID, true
}
