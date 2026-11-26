package httpapi

import (
	"PersonalCloudStorage/internal/auth"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// fakeShareLimiter 是 shareAccessLimiter 的本地桩：三态开关（allow / deny / error），
// 并记录最后一次入参用于钉死 key/max/window（Review Focus 3）。
type fakeShareLimiter struct {
	allowed    bool
	err        error
	calls      int
	lastKey    string
	lastMax    int
	lastWindow time.Duration
}

func (f *fakeShareLimiter) Allow(_ context.Context, key string, max int, window time.Duration) (bool, error) {
	f.calls++
	f.lastKey = key
	f.lastMax = max
	f.lastWindow = window
	return f.allowed, f.err
}

// recordCapture 收集 slog 默认 logger 的记录（手法同 internal/knowledge/composite_test.go），
// 用于钉死 read 桶 Redis 故障必须 slog.Warn fail-open。
type recordCapture struct {
	records []slog.Record
}

func (c *recordCapture) Enabled(context.Context, slog.Level) bool { return true }

func (c *recordCapture) Handle(_ context.Context, r slog.Record) error {
	c.records = append(c.records, r.Clone())
	return nil
}

func (c *recordCapture) WithAttrs([]slog.Attr) slog.Handler { return c }

func (c *recordCapture) WithGroup(string) slog.Handler { return c }

func swapSlogDefault(t *testing.T) *recordCapture {
	t.Helper()
	capture := &recordCapture{}
	previous := slog.Default()
	slog.SetDefault(slog.New(capture))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return capture
}

func warnRecords(capture *recordCapture) []slog.Record {
	var warns []slog.Record
	for _, r := range capture.records {
		if r.Level == slog.LevelWarn {
			warns = append(warns, r)
		}
	}
	return warns
}

// runShareRateLimit 把中间件挂到与 router.go 相同的两种公开路由形态上，
// 经由 X-Forwarded-For（gin 默认可信）+ RemoteAddr 证明限流键取的是 ClientIP 而非 RemoteAddr。
func runShareRateLimit(t *testing.T, limiter *fakeShareLimiter, kind string) (
	*httptest.ResponseRecorder, *fakeShareLimiter, bool,
) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	reached := false
	next := func(c *gin.Context) {
		reached = true
		c.Status(http.StatusOK)
	}
	router := gin.New()
	router.POST("/shares/:token/verify", RequireShareRateLimit(limiter, kind), next)
	router.GET("/shares/:token", RequireShareRateLimit(limiter, kind), next)

	var request *http.Request
	if kind == "verify" {
		request = httptest.NewRequest(http.MethodPost, "/shares/AbCdEf12/verify", nil)
	} else {
		request = httptest.NewRequest(http.MethodGet, "/shares/AbCdEf12", nil)
	}
	request.RemoteAddr = "192.0.2.1:54321"
	request.Header.Set("X-Forwarded-For", "203.0.113.9")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response, limiter, reached
}

func decodeShareError(t *testing.T, response *httptest.ResponseRecorder) string {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("response body is not JSON: %q", response.Body.String())
	}
	if text, ok := body["error"].(string); ok {
		return text
	}
	return ""
}

func TestRequireShareRateLimitVerifyFailClosed(t *testing.T) {
	// key = "share-verify:"+sha256hex(token)+":"+ClientIP()（token 哈希后入键），5 次/10min。
	capture := swapSlogDefault(t)

	// --- 三态之一：放行 ---
	limiter := &fakeShareLimiter{allowed: true}
	response, limiter, reached := runShareRateLimit(t, limiter, "verify")
	if response.Code != http.StatusOK || !reached {
		t.Fatalf("allow path: code=%d reached=%v, want 200/true", response.Code, reached)
	}
	// token 以 SHA-256 摘要入键（loginAttemptKey 先例）：原始 token 不许出现在 Redis key 里。
	h := sha256.Sum256([]byte("AbCdEf12"))
	wantKey := "share-verify:" + hex.EncodeToString(h[:]) + ":203.0.113.9"
	if limiter.lastKey != wantKey {
		t.Errorf("verify key = %q, want %q (hashed token+ClientIP)", limiter.lastKey, wantKey)
	}
	if strings.Contains(limiter.lastKey, "AbCdEf12") {
		t.Errorf("verify key = %q, raw share token leaked into Redis key", limiter.lastKey)
	}
	if limiter.lastMax != 5 || limiter.lastWindow != 10*time.Minute {
		t.Errorf("verify limits = %d/%v, want 5/10m", limiter.lastMax, limiter.lastWindow)
	}

	// --- 三态之二：超限 → 429 {"error":"rate_limited"}，不进 handler ---
	limiter = &fakeShareLimiter{allowed: false}
	response, _, reached = runShareRateLimit(t, limiter, "verify")
	if response.Code != http.StatusTooManyRequests || reached {
		t.Fatalf("deny path: code=%d reached=%v, want 429/false", response.Code, reached)
	}
	if got := decodeShareError(t, response); got != "rate_limited" {
		t.Errorf("deny body error = %q, want %q", got, "rate_limited")
	}

	// --- 三态之三：limiter 出错 → 503 fail-closed（爆破闸不许失效，spec §6 裁定）---
	limiter = &fakeShareLimiter{err: errors.New("redis down")}
	response, _, reached = runShareRateLimit(t, limiter, "verify")
	if response.Code != http.StatusServiceUnavailable || reached {
		t.Fatalf("error path: code=%d reached=%v, want 503/false (fail-closed)", response.Code, reached)
	}
	if decodeShareError(t, response) == "" {
		t.Error("503 body must carry an error field")
	}
	// fail-closed 绝不允许同时留下 fail-open 的 Warn 痕迹。
	if len(warnRecords(capture)) != 0 {
		t.Errorf("verify error path must not warn-fail-open, got %v", capture.records)
	}
}

func TestRequireShareRateLimitReadFailOpen(t *testing.T) {
	// key = "share-read:"+ClientIP()，60 次/10min。
	capture := swapSlogDefault(t)

	limiter := &fakeShareLimiter{allowed: true}
	response, limiter, reached := runShareRateLimit(t, limiter, "read")
	if response.Code != http.StatusOK || !reached {
		t.Fatalf("allow path: code=%d reached=%v, want 200/true", response.Code, reached)
	}
	if limiter.lastKey != "share-read:203.0.113.9" {
		t.Errorf("read key = %q, want share-read:203.0.113.9 (ClientIP only, token 不进读桶)", limiter.lastKey)
	}
	if limiter.lastMax != 60 || limiter.lastWindow != 10*time.Minute {
		t.Errorf("read limits = %d/%v, want 60/10m", limiter.lastMax, limiter.lastWindow)
	}

	limiter = &fakeShareLimiter{allowed: false}
	response, _, reached = runShareRateLimit(t, limiter, "read")
	if response.Code != http.StatusTooManyRequests || reached {
		t.Fatalf("deny path: code=%d reached=%v, want 429/false", response.Code, reached)
	}
	if got := decodeShareError(t, response); got != "rate_limited" {
		t.Errorf("deny body error = %q, want %q", got, "rate_limited")
	}

	// --- limiter 出错 → 放行 + 恰好一条 slog.Warn（公开只读路径不被 Redis 故障拖死）---
	limiter = &fakeShareLimiter{err: errors.New("redis down")}
	response, _, reached = runShareRateLimit(t, limiter, "read")
	if response.Code != http.StatusOK || !reached {
		t.Fatalf("error path: code=%d reached=%v, want 200/true (fail-open)", response.Code, reached)
	}
	warns := warnRecords(capture)
	if len(warns) != 1 {
		t.Fatalf("warn records = %d, want exactly 1 (%v)", len(warns), capture.records)
	}
	var loggedErr string
	warns[0].Attrs(func(a slog.Attr) bool {
		if a.Key == "error" {
			loggedErr = a.Value.String()
		}
		return true
	})
	if !strings.Contains(loggedErr, "redis down") {
		t.Errorf("warn error attr = %q, want it to contain %q", loggedErr, "redis down")
	}
}

func TestRequireShareRateLimitUnknownKindFailsLoud(t *testing.T) {
	// kind 写错是 programmer error：必须 500 拦住，不许悄悄退化成任何一种限流策略。
	limiter := &fakeShareLimiter{allowed: true}
	response, limiter, reached := runShareRateLimit(t, limiter, "write")
	if response.Code != http.StatusInternalServerError || reached {
		t.Fatalf("unknown kind: code=%d reached=%v, want 500/false", response.Code, reached)
	}
	if limiter.calls != 0 {
		t.Errorf("unknown kind must not consult the limiter, calls=%d", limiter.calls)
	}
}

// TestRequireShareRateLimitVerifyWithoutTokenParam 钉死空 token 守卫（Review round-1 MINOR-3）：
// verify 中间件挂到没有 :token 的路由上属挂载期 programmer error —— 500 且绝不查 limiter。
func TestRequireShareRateLimitVerifyWithoutTokenParam(t *testing.T) {
	gin.SetMode(gin.TestMode)
	limiter := &fakeShareLimiter{allowed: true}
	reached := false
	router := gin.New()
	router.POST("/noparam", RequireShareRateLimit(limiter, "verify"), func(c *gin.Context) {
		reached = true
		c.Status(http.StatusOK)
	})
	request := httptest.NewRequest(http.MethodPost, "/noparam", nil)
	request.RemoteAddr = "192.0.2.1:54321"
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError || reached {
		t.Fatalf("empty token: code=%d reached=%v, want 500/false", response.Code, reached)
	}
	if limiter.calls != 0 {
		t.Errorf("empty token guard must not consult the limiter, calls=%d", limiter.calls)
	}
}

// TestNewRouterTrustsOnlyLoopbackProxy 钉死 deliverable 3：只有同机 nginx 反代（127.0.0.1）
// 递来的 X-Forwarded-For 可信；直连伪造 XFF 必须被忽略，否则限流键仍可被投毒。
func TestNewRouterTrustsOnlyLoopbackProxy(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manager, err := auth.NewTokenManager(auth.TokenConfig{
		Secret: strings.Repeat("x", 32), Issuer: "test", AccessTTL: time.Hour,
	})
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(nil, nil, nil, nil, manager, nil, nil, nil)
	router.GET("/__client-ip", func(c *gin.Context) {
		c.String(http.StatusOK, "%s", c.ClientIP())
	})

	// 经可信回环代理转发 → 取 XFF 真实访客 IP。
	request := httptest.NewRequest(http.MethodGet, "/__client-ip", nil)
	request.RemoteAddr = "127.0.0.1:54321"
	request.Header.Set("X-Forwarded-For", "203.0.113.9")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if got := response.Body.String(); got != "203.0.113.9" {
		t.Errorf("trusted-proxy ClientIP = %q, want 203.0.113.9", got)
	}

	// 非可信直连伪造 XFF → 忽略头，退回真实 RemoteAddr。
	request = httptest.NewRequest(http.MethodGet, "/__client-ip", nil)
	request.RemoteAddr = "198.51.100.7:1234"
	request.Header.Set("X-Forwarded-For", "203.0.113.9")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if got := response.Body.String(); got != "198.51.100.7" {
		t.Errorf("untrusted ClientIP = %q, want 198.51.100.7 (forged XFF must be ignored)", got)
	}
}
