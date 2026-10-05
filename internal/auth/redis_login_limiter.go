package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net"
	"strings"

	"github.com/redis/go-redis/v9"
)

const LoginMaxAttempts = 5
const LoginWindowSeconds = 600

var loginAttemptScript = redis.NewScript(`
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
if count <= tonumber(ARGV[2]) then
    return 1
end
return 0
`)

type RedisLoginLimiter struct {
	client *redis.Client
}

func NewRedisLoginLimiter(client *redis.Client) *RedisLoginLimiter {
	return &RedisLoginLimiter{client: client}
}

func (l *RedisLoginLimiter) Allow(ctx context.Context, email, remoteAddr string) (bool, error) {
	countAllowed, err := loginAttemptScript.Run(
		ctx, l.client, []string{loginAttemptKey(email, remoteAddr)},
		LoginWindowSeconds, LoginMaxAttempts,
	).Int()
	if err != nil {
		return false, err
	}
	return countAllowed == 1, nil
}

func (l *RedisLoginLimiter) Reset(ctx context.Context, email, remoteAddr string) error {
	return l.client.Del(ctx, loginAttemptKey(email, remoteAddr)).Err()
}

func loginAttemptKey(email, remoteAddr string) string {
	remoteIP, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		remoteIP = remoteAddr
	}
	identity := strings.ToLower(strings.TrimSpace(email)) + "\x00" + remoteIP
	hash := sha256.Sum256([]byte(identity))
	return "govault:login:attempts:" + hex.EncodeToString(hash[:])
}
