package share

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestShareAccessKeys(t *testing.T) {
	// key 形态是限流桶的全部语义，纯函数钉死（spec §6）。
	if got := VerifyKey("t0k1", "203.0.113.9"); got != "share-verify:t0k1:203.0.113.9" {
		t.Errorf("VerifyKey = %q, want share-verify:t0k1:203.0.113.9", got)
	}
	if got := ReadKey("203.0.113.9"); got != "share-read:203.0.113.9" {
		t.Errorf("ReadKey = %q, want share-read:203.0.113.9", got)
	}
	// 爆破防爆：不同 token 必须分桶（一个链接被爆破不能连坐其他链接）。
	if VerifyKey("tokenA", "1.2.3.4") == VerifyKey("tokenB", "1.2.3.4") {
		t.Error("different tokens share a verify bucket")
	}
	// 不同访客必须分桶（否则全站访客互相 DoS）。
	if ReadKey("1.2.3.4") == ReadKey("5.6.7.8") {
		t.Error("different IPs share a read bucket")
	}
	if VerifyKey("x", "1.2.3.4") == ReadKey("1.2.3.4") {
		t.Error("verify and read must not collide in one bucket")
	}
}

func TestRedisAccessLimiterInputGuards(t *testing.T) {
	// 非法入参必须在触网前被拒（client 指向无人监听的端口，靠“错误而非超时/panic”证明）。
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	defer client.Close()
	limiter := NewRedisAccessLimiter(client)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	for _, tc := range []struct {
		name   string
		key    string
		max    int
		window time.Duration
	}{
		{"empty key", "", 5, time.Minute},
		{"non-positive max", "share-read:1.2.3.4", 0, time.Minute},
		{"non-positive window", "share-read:1.2.3.4", 5, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			allowed, err := limiter.Allow(ctx, tc.key, tc.max, tc.window)
			if err == nil || allowed {
				t.Fatalf("Allow(%q,%d,%v) = (%v,%v), want (false, error)", tc.key, tc.max, tc.window, allowed, err)
			}
		})
	}
}

func TestRedisAccessLimiter(t *testing.T) {
	addr := os.Getenv("TEST_REDIS_ADDR")
	if addr == "" {
		t.Skip("set TEST_REDIS_ADDR to run the Redis integration test")
	}
	client := redis.NewClient(&redis.Options{Addr: addr})
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Fatal(err)
	}

	stamp := time.Now().Format("20060102150405.000000000")
	keyA := "govault-share-test:" + stamp + ":a"
	keyB := "govault-share-test:" + stamp + ":b"
	t.Cleanup(func() {
		_ = client.Del(context.Background(), keyA, keyB).Err()
	})

	limiter := NewRedisAccessLimiter(client)

	// INCR 到上限：前 max 次放行，第 max+1 次拒绝。
	max := VerifyMaxAttempts
	for i := 0; i < max; i++ {
		allowed, err := limiter.Allow(ctx, keyA, max, VerifyWindow)
		if err != nil || !allowed {
			t.Fatalf("attempt %d should be allowed, allowed=%v err=%v", i+1, allowed, err)
		}
	}
	allowed, err := limiter.Allow(ctx, keyA, max, VerifyWindow)
	if err != nil || allowed {
		t.Fatalf("attempt %d should be blocked, allowed=%v err=%v", max+1, allowed, err)
	}

	// 首次计数即挂上 TTL，且不超过窗口。
	ttl, err := client.TTL(ctx, keyA).Result()
	if err != nil || ttl <= 0 || ttl > VerifyWindow {
		t.Fatalf("counter should expire, ttl=%v err=%v", ttl, err)
	}

	// 不同 key 互不影响。
	allowed, err = limiter.Allow(ctx, keyB, max, VerifyWindow)
	if err != nil || !allowed {
		t.Fatalf("distinct key must have its own bucket, allowed=%v err=%v", allowed, err)
	}

	// 窗口语义：短窗口过期后重新放行。
	keyC := "govault-share-test:" + stamp + ":c"
	t.Cleanup(func() { _ = client.Del(context.Background(), keyC).Err() })
	allowed, err = limiter.Allow(ctx, keyC, 1, 300*time.Millisecond)
	if err != nil || !allowed {
		t.Fatalf("first short-window attempt should be allowed, allowed=%v err=%v", allowed, err)
	}
	allowed, err = limiter.Allow(ctx, keyC, 1, 300*time.Millisecond)
	if err != nil || allowed {
		t.Fatalf("second short-window attempt should be blocked, allowed=%v err=%v", allowed, err)
	}
	time.Sleep(500 * time.Millisecond)
	allowed, err = limiter.Allow(ctx, keyC, 1, 300*time.Millisecond)
	if err != nil || !allowed {
		t.Fatalf("after window expiry should be allowed again, allowed=%v err=%v", allowed, err)
	}
}
