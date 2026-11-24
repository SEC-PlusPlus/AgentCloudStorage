package share

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

// 限流配额（spec §6）：verify 防爆破按 IP+token 5 次/10min；
// meta/download 防扫库按 IP 60 次/10min。
const (
	VerifyMaxAttempts = 5
	ReadMaxAttempts   = 60
	VerifyWindow      = 10 * time.Minute
	ReadWindow        = 10 * time.Minute
)

// Key builders — the whole bucketing semantics lives here; middleware must not
// hand-build strings so the format stays pinned by pure tests (spec §6).
func VerifyKey(token, ip string) string {
	return "share-verify:" + token + ":" + ip
}

func ReadKey(ip string) string {
	return "share-read:" + ip
}

var ErrInvalidLimiterArgs = errors.New("share: invalid rate limiter arguments")

// INCR + set TTL on first hit only, all inside one Lua script so two concurrent
// requests can never leave a TTL-less counter behind (same shape as auth/redis_login_limiter.go).
var accessCountScript = redis.NewScript(`
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
end
if count <= tonumber(ARGV[1]) then
    return 1
end
return 0
`)

type RedisAccessLimiter struct {
	client *redis.Client
}

func NewRedisAccessLimiter(rdb *redis.Client) *RedisAccessLimiter {
	return &RedisAccessLimiter{client: rdb}
}

// Allow reports whether one more hit fits in key's window. Errors propagate
// raw — fail-open vs fail-closed is a policy decision owned by the middleware.
func (l *RedisAccessLimiter) Allow(ctx context.Context, key string, max int, window time.Duration) (bool, error) {
	if key == "" || max <= 0 || window <= 0 {
		return false, ErrInvalidLimiterArgs
	}
	countAllowed, err := accessCountScript.Run(
		ctx, l.client, []string{key},
		max, window.Milliseconds(),
	).Int()
	if err != nil {
		return false, err
	}
	return countAllowed == 1, nil
}
