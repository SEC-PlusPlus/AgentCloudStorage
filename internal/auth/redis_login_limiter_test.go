package auth

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestLoginAttemptKey(t *testing.T) {
	key := loginAttemptKey(" User@Example.test ", "192.0.2.10:1234")
	if key != loginAttemptKey("user@example.test", "192.0.2.10:5678") {
		t.Fatal("email normalization or remote port handling differs")
	}
	if key == loginAttemptKey("user@example.test", "192.0.2.11:1234") {
		t.Fatal("different source addresses share a limit key")
	}
	if strings.Contains(key, "user@example.test") {
		t.Fatal("email must not appear in the Redis key")
	}
}

func TestRedisLoginLimiter(t *testing.T) {
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

	email := "redis-test-" + time.Now().Format("20060102150405.000000000") + "@example.test"
	remoteAddr := "192.0.2.10:1234"
	key := loginAttemptKey(email, remoteAddr)
	t.Cleanup(func() { _ = client.Del(context.Background(), key).Err() })
	limiter := NewRedisLoginLimiter(client)
	for i := 0; i < LoginMaxAttempts; i++ {
		allowed, err := limiter.Allow(ctx, email, remoteAddr)
		if err != nil || !allowed {
			t.Fatalf("attempt %d should be allowed, allowed=%v err=%v", i+1, allowed, err)
		}
	}
	allowed, err := limiter.Allow(ctx, email, remoteAddr)
	if err != nil || allowed {
		t.Fatalf("attempt %d should be blocked, allowed=%v err=%v", LoginMaxAttempts+1, allowed, err)
	}
	ttl, err := client.TTL(ctx, key).Result()
	if err != nil || ttl <= 0 || ttl > LoginWindowSeconds*time.Second {
		t.Fatalf("counter should expire, ttl=%v err=%v", ttl, err)
	}
	if err := limiter.Reset(ctx, email, remoteAddr); err != nil {
		t.Fatal(err)
	}
	allowed, err = limiter.Allow(ctx, email, remoteAddr)
	if err != nil || !allowed {
		t.Fatalf("attempt after reset should be allowed, allowed=%v err=%v", allowed, err)
	}
}
