package share

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
//
// VerifyKey SHA-256s the token (house precedent: auth.loginAttemptKey hashes
// email+IP so secrets never sit in Redis keys — MONITOR/KEYS/RDB/AOF would all
// expose a share token verbatim, and the token IS the read credential). A
// fixed-length hex digest also kills the ':' delimiter ambiguity IPv6
// addresses would otherwise introduce. Per-(ip, token) bucketing is unchanged:
// the hash is deterministic, so every hit on the same pair lands in one bucket.
func VerifyKey(token, ip string) string {
	hash := sha256.Sum256([]byte(token))
	return "share-verify:" + hex.EncodeToString(hash[:]) + ":" + ip
}

func ReadKey(ip string) string {
	return "share-read:" + ip
}

var ErrInvalidLimiterArgs = errors.New("share: invalid rate limiter arguments")

// INCR plus a TTL attempt on EVERY hit, all inside one Lua script (same shape
// as auth/redis_login_limiter.go). The 'NX' flag (Redis >= 7.0, pinned at
// redis:7-alpine in deploy/compose.yaml) writes the TTL only when the key has
// none: an unconditional PEXPIRE would keep sliding the window and neuter the
// limit, while the old `if count == 1` guard could leave a permanently
// TTL-less key behind if Redis crashed after INCR but before PEXPIRE — that key
// would then 429 its bucket forever with no expiry to recover it.
var accessCountScript = redis.NewScript(`
local count = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]), 'NX')
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
