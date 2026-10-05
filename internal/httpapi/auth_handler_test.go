package httpapi

import (
	"PersonalCloudStorage/internal/auth"
	"PersonalCloudStorage/internal/user"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type loginRepositoryStub struct {
	account *user.User
	calls   int
}

func (*loginRepositoryStub) Create(context.Context, *user.User) error { return nil }

func (r *loginRepositoryStub) GetByEmail(context.Context, string) (*user.User, error) {
	r.calls++
	return r.account, nil
}

type loginLimiterStub struct {
	allowed    bool
	allowErr   error
	resetErr   error
	allowCalls int
	resetCalls int
}

func (l *loginLimiterStub) Allow(context.Context, string, string) (bool, error) {
	l.allowCalls++
	return l.allowed, l.allowErr
}

func (l *loginLimiterStub) Reset(context.Context, string, string) error {
	l.resetCalls++
	return l.resetErr
}

func testLoginRequest(t *testing.T, limiter *loginLimiterStub, password string) (*httptest.ResponseRecorder, *loginRepositoryStub) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	repo := &loginRepositoryStub{account: &user.User{
		ID: 1, Username: "tester", Email: "tester@example.test",
		PasswordHash: string(hash), Status: user.StatusActive,
	}}
	manager, err := auth.NewTokenManager(auth.TokenConfig{
		Secret: strings.Repeat("x", 32), Issuer: "test", AccessTTL: time.Hour,
	})
	if err != nil {
		t.Fatal(err)
	}
	handler := NewAuthHandler(user.NewService(repo), manager, limiter)
	router := gin.New()
	router.POST("/login", handler.Login)
	request := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(
		`{"email":"tester@example.test","password":"`+password+`"}`,
	))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response, repo
}

func TestLoginLimiterBlocksBeforePasswordCheck(t *testing.T) {
	limiter := &loginLimiterStub{allowed: false}
	response, repo := testLoginRequest(t, limiter, "correct-password")
	if response.Code != http.StatusTooManyRequests || repo.calls != 0 {
		t.Fatalf("expected 429 before password check; status=%d repoCalls=%d", response.Code, repo.calls)
	}
}

func TestLoginLimiterUnavailable(t *testing.T) {
	limiter := &loginLimiterStub{allowErr: errors.New("redis unavailable")}
	response, repo := testLoginRequest(t, limiter, "correct-password")
	if response.Code != http.StatusServiceUnavailable || repo.calls != 0 {
		t.Fatalf("expected 503 before password check; status=%d repoCalls=%d", response.Code, repo.calls)
	}
}

func TestLoginFailureDoesNotResetLimiter(t *testing.T) {
	limiter := &loginLimiterStub{allowed: true}
	response, repo := testLoginRequest(t, limiter, "wrong-password")
	if response.Code != http.StatusUnauthorized || repo.calls != 1 || limiter.resetCalls != 0 {
		t.Fatalf("expected 401 without reset; status=%d repoCalls=%d resetCalls=%d", response.Code, repo.calls, limiter.resetCalls)
	}
}

func TestSuccessfulLoginResetsLimiter(t *testing.T) {
	limiter := &loginLimiterStub{allowed: true}
	response, repo := testLoginRequest(t, limiter, "correct-password")
	if response.Code != http.StatusOK || repo.calls != 1 || limiter.resetCalls != 1 {
		t.Fatalf("expected 200 and reset; status=%d repoCalls=%d resetCalls=%d", response.Code, repo.calls, limiter.resetCalls)
	}
}
