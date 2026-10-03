package auth

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var ErrInvalidToken = errors.New("invalid access token")

type TokenConfig struct {
	Secret    string
	Issuer    string
	AccessTTL time.Duration
}

type AccessTokenClaims struct {
	jwt.RegisteredClaims
}

type TokenManager struct {
	secret    []byte
	issuer    string
	accessTTL time.Duration
}

func NewTokenManager(cfg TokenConfig) (*TokenManager, error) {
	if strings.TrimSpace(cfg.Secret) == "" {
		return nil, errors.New("jwt secret is required")
	}
	if len([]byte(cfg.Secret)) < 32 {
		return nil, errors.New("jwt secret must contain at least 32 bytes")
	}
	issuer := strings.TrimSpace(cfg.Issuer)
	if issuer == "" {
		return nil, errors.New("jwt issuer is required")
	}

	if cfg.AccessTTL <= 0 {
		return nil, errors.New("jwt access ttl must be positive")
	}

	return &TokenManager{
		secret:    []byte(cfg.Secret),
		issuer:    issuer,
		accessTTL: cfg.AccessTTL,
	}, nil
}

func (m *TokenManager) GenerateAccessToken(userID uint64) (string, time.Time, error) {
	if userID == 0 {
		return "", time.Time{}, errors.New(
			"user id is required",
		)
	}

	now := time.Now().UTC()
	expiresAt := now.Add(m.accessTTL)

	claims := AccessTokenClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    m.issuer,
			Subject:   strconv.FormatUint(userID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}

	token := jwt.NewWithClaims(
		jwt.SigningMethodHS256,
		claims,
	)

	tokenString, err := token.SignedString(m.secret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf(
			"sign access token: %w",
			err,
		)
	}

	return tokenString, expiresAt, nil
}

func (m *TokenManager) ParseAccessToken(
	tokenString string,
) (uint64, error) {
	tokenString = strings.TrimSpace(tokenString)
	if tokenString == "" {
		return 0, ErrInvalidToken
	}

	claims := &AccessTokenClaims{}

	token, err := jwt.ParseWithClaims(
		tokenString,
		claims,
		func(token *jwt.Token) (any, error) {
			return m.secret, nil
		},
		jwt.WithValidMethods([]string{
			jwt.SigningMethodHS256.Alg(),
		}),
		jwt.WithIssuer(m.issuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return 0, fmt.Errorf(
			"%w: %v",
			ErrInvalidToken,
			err,
		)
	}

	if token == nil || !token.Valid {
		return 0, ErrInvalidToken
	}

	userID, err := strconv.ParseUint(
		claims.Subject,
		10,
		64,
	)
	if err != nil || userID == 0 {
		return 0, ErrInvalidToken
	}

	return userID, nil
}
