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
	// Review round-1 MINOR-1：记录两路 addr，钉死 Allow/Reset 同键且为无端口 ClientIP。
	allowAddr string
	resetAddr string
}

func (l *loginLimiterStub) Allow(_ context.Context, _ string, addr string) (bool, error) {
	l.allowCalls++
	l.allowAddr = addr
	return l.allowed, l.allowErr
}

func (l *loginLimiterStub) Reset(_ context.Context, _ string, addr string) error {
	l.resetCalls++
	l.resetAddr = addr
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
	// ClientIP 同源修正（spec §6）：httptest 请求 RemoteAddr=192.0.2.1:1234 且无 XFF，
	// 两路都必须拿到无端口的 ClientIP，且 Allow/Reset 同键 —— 否则 Reset 删错桶。
	if limiter.allowAddr != "192.0.2.1" {
		t.Errorf("Allow addr = %q, want portless ClientIP 192.0.2.1", limiter.allowAddr)
	}
	if limiter.resetAddr != limiter.allowAddr {
		t.Errorf("Reset addr = %q, must equal Allow addr %q (same bucket)", limiter.resetAddr, limiter.allowAddr)
	}
}
