package auth

import (
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	testJWTSecret = "unit-test-secret-value-0123456789abcdef"
	testJWTIssuer = "personal-cloud-storage-test"
)

func newTestTokenManager(t *testing.T) *TokenManager {
	t.Helper()
	manager, err := NewTokenManager(TokenConfig{
		Secret:    testJWTSecret,
		Issuer:    testJWTIssuer,
		AccessTTL: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewTokenManager: %v", err)
	}
	return manager
}

func rawClaims(t *testing.T, tokenString string) jwt.MapClaims {
	t.Helper()
	claims := jwt.MapClaims{}
	_, _, err := jwt.NewParser().ParseUnverified(tokenString, claims)
	if err != nil {
		t.Fatalf("ParseUnverified: %v", err)
	}
	return claims
}

func TestShareTokenRoundTrip(t *testing.T) {
	manager := newTestTokenManager(t)

	tokenString, err := manager.IssueShareToken(42)
	if err != nil {
		t.Fatalf("IssueShareToken: %v", err)
	}

	shareID, err := manager.ParseShareToken(tokenString)
	if err != nil {
		t.Fatalf("ParseShareToken: %v", err)
	}
	if shareID != 42 {
		t.Fatalf("share id mismatch: got %d want 42", shareID)
	}

	claims := rawClaims(t, tokenString)
	if scope, _ := claims["scope"].(string); scope != "share" {
		t.Fatalf("scope mismatch: got %q want share", scope)
	}
	if sub, _ := claims["sub"].(string); sub != strconv.FormatUint(42, 10) {
		t.Fatalf("subject mismatch: got %q want 42", sub)
	}
	exp, err := claims.GetExpirationTime()
	if err != nil || exp == nil {
		t.Fatalf("share token must carry exp: err=%v", err)
	}
	if ttl := time.Until(exp.Time); ttl <= 0 || ttl > ShareTokenTTL {
		t.Fatalf("ttl out of range: %v (max %v)", ttl, ShareTokenTTL)
	}

	if _, err := manager.IssueShareToken(0); err == nil {
		t.Fatal("IssueShareToken(0) should fail")
	}
}

func TestParseAccessTokenRejectsShareScope(t *testing.T) {
	manager := newTestTokenManager(t)

	shareToken, err := manager.IssueShareToken(9)
	if err != nil {
		t.Fatalf("IssueShareToken: %v", err)
	}
	if _, err := manager.ParseAccessToken(shareToken); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("ParseAccessToken on share token: got %v want ErrInvalidToken", err)
	}

	// Reverse direction: user-scoped tokens must not unlock share parsing.
	userToken, _, err := manager.GenerateAccessToken(7)
	if err != nil {
		t.Fatalf("GenerateAccessToken: %v", err)
	}
	if _, err := manager.ParseShareToken(userToken); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("ParseShareToken on user token: got %v want ErrInvalidToken", err)
	}

	if scope, _ := rawClaims(t, userToken)["scope"].(string); scope != "user" {
		t.Fatalf("access token scope mismatch: got %q want user", scope)
	}
	userID, err := manager.ParseAccessToken(userToken)
	if err != nil || userID != 7 {
		t.Fatalf("ParseAccessToken on user token: got %d, %v want 7", userID, err)
	}
}

func TestLegacyTokenWithoutScopeStillValid(t *testing.T) {
	manager := newTestTokenManager(t)

	now := time.Now().UTC()
	legacy := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"iss": testJWTIssuer,
		"sub": strconv.FormatUint(1234, 10),
		"iat": jwt.NewNumericDate(now),
		"nbf": jwt.NewNumericDate(now),
		"exp": jwt.NewNumericDate(now.Add(time.Hour)),
	})
	tokenString, err := legacy.SignedString([]byte(testJWTSecret))
	if err != nil {
		t.Fatalf("sign legacy token: %v", err)
	}
	if _, ok := rawClaims(t, tokenString)["scope"]; ok {
		t.Fatal("legacy fixture must not carry a scope claim")
	}

	userID, err := manager.ParseAccessToken(tokenString)
	if err != nil {
		t.Fatalf("ParseAccessToken on scopeless legacy token: %v", err)
	}
	if userID != 1234 {
		t.Fatalf("user id mismatch: got %d want 1234", userID)
	}
}
