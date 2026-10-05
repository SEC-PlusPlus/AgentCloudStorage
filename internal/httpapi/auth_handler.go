package httpapi

import (
	"PersonalCloudStorage/internal/auth"
	"PersonalCloudStorage/internal/user"
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type registerRequest struct {
	Username string `json:"username" binding:"required"`
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type registerResponse struct {
	ID        uint64    `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
}

type loginRequest struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type loginResponse struct {
	AccessToken string           `json:"access_token"`
	TokenType   string           `json:"token_type"`
	ExpiresAt   time.Time        `json:"expires_at"`
	User        registerResponse `json:"user"`
}

type AuthHandler struct {
	service      *user.Service
	tokenManager *auth.TokenManager
	loginLimiter LoginLimiter
}

type LoginLimiter interface {
	Allow(ctx context.Context, email, remoteAddr string) (bool, error)
	Reset(ctx context.Context, email, remoteAddr string) error
}

func NewAuthHandler(service *user.Service, tokenManager *auth.TokenManager, loginLimiter LoginLimiter) *AuthHandler {
	return &AuthHandler{
		service:      service,
		tokenManager: tokenManager,
		loginLimiter: loginLimiter,
	}
}

func (h *AuthHandler) Register(c *gin.Context) {
	var request registerRequest

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid register request",
		})
		return
	}

	createdUser, err := h.service.Register(c.Request.Context(), user.RegisterInput{
		Username: request.Username,
		Email:    request.Email,
		Password: request.Password,
	})

	if err != nil {
		switch {
		case errors.Is(err, user.ErrInvalidUsername),
			errors.Is(err, user.ErrInvalidEmail),
			errors.Is(err, user.ErrInvalidPassword):
			c.JSON(http.StatusBadRequest, gin.H{
				"error": err.Error(),
			})
		case errors.Is(err, user.ErrUserAlreadyExists):
			c.JSON(http.StatusConflict, gin.H{
				"error": "username or email already exists",
			})
		default:
			_ = c.Error(err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "register user failed",
			})
		}
		return
	}
	c.JSON(http.StatusCreated, registerResponse{
		ID:        createdUser.ID,
		Username:  createdUser.Username,
		Email:     createdUser.Email,
		CreatedAt: createdUser.CreatedAt,
	})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var request loginRequest

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid login request",
		})
		return
	}
	allowed, err := h.loginLimiter.Allow(c.Request.Context(), request.Email, c.Request.RemoteAddr)
	if err != nil {
		_ = c.Error(err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "login temporarily unavailable"})
		return
	}
	if !allowed {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many login attempts; try again later"})
		return
	}

	authenticatedUser, err := h.service.Authenticate(
		c.Request.Context(),
		user.LoginInput{
			Email:    request.Email,
			Password: request.Password,
		},
	)
	if err != nil {
		switch {
		case errors.Is(err, user.ErrInvalidCredentials):
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "invalid email or password",
			})

		case errors.Is(err, user.ErrUserDisabled):
			c.JSON(http.StatusForbidden, gin.H{
				"error": "user is disabled",
			})

		default:
			_ = c.Error(err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "login failed",
			})
		}

		return
	}
	if err := h.loginLimiter.Reset(c.Request.Context(), request.Email, c.Request.RemoteAddr); err != nil {
		_ = c.Error(err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "login temporarily unavailable"})
		return
	}
	accessToken, expiresAt, err :=
		h.tokenManager.GenerateAccessToken(authenticatedUser.ID)
	if err != nil {
		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "generate access token failed",
		})
		return
	}

	c.JSON(http.StatusOK, loginResponse{
		AccessToken: accessToken,
		TokenType:   "Bearer",
		ExpiresAt:   expiresAt,
		User: registerResponse{
			ID:        authenticatedUser.ID,
			Username:  authenticatedUser.Username,
			Email:     authenticatedUser.Email,
			CreatedAt: authenticatedUser.CreatedAt,
		},
	})
}
