package share

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"

	"PersonalCloudStorage/internal/auth"
	"PersonalCloudStorage/internal/file"
)

// Limits and shapes pinned by spec §4 / §5.2.
const (
	maxActiveSharesPerOwner = 50
	maxActiveSharesPerFile  = 20
	maxPasswordRunes        = 64
	sharePasswordBcryptCost = 10

	// tokenCreateAttempts = 1 initial try + up to 3 collision retries.
	// The repository surfaces driver duplicates only as generic errors, so
	// every Create failure is retried with a freshly generated token: a real
	// uk_token collision succeeds on the next draw, and a genuine database
	// outage simply exhausts the attempts and surfaces wrapped. Retries are
	// cheap because the bcrypt hash is computed once before the loop.
	tokenCreateAttempts = 4
	tokenRandomBytes    = 32 // base64.RawURLEncoding → 43 characters, no padding
)

// FileLookup is the share package's view of the file domain. Implementations
// (file.Service gets the method in its own task) must answer the 404-face
// outcome — file missing, foreign-owned, or not active (in trash) — with
// ErrShareNotFound so owners and visitors never learn which of the three it
// was (spec §3). Any other error means a real lookup failure.
type FileLookup interface {
	GetActiveFile(ctx context.Context, ownerID uint64, fileID uint64) (*file.File, error)
}

// CreateOptions carries the optional knobs of POST /files/:id/shares.
// ExpiresIn ≤ 0 means "never expires"; Password "" means "open link".
type CreateOptions struct {
	Password  string
	ExpiresIn time.Duration
}

type Service struct {
	shares Repository
	files  FileLookup
	tokens *auth.TokenManager
}

func NewService(shares Repository, files FileLookup, tokens *auth.TokenManager) *Service {
	return &Service{
		shares: shares,
		files:  files,
		tokens: tokens,
	}
}

// Create validates ownership and activity, enforces the per-owner and
// per-file active-share caps, then persists a snapshot row (display name
// frozen from the file's current name, password hashed at bcrypt cost 10).
func (s *Service) Create(
	ctx context.Context,
	ownerID uint64,
	fileID uint64,
	opts CreateOptions,
) (*Share, error) {
	if opts.Password != "" && utf8.RuneCountInString(opts.Password) > maxPasswordRunes {
		return nil, fmt.Errorf("share password must be at most %d characters", maxPasswordRunes)
	}

	active, err := s.files.GetActiveFile(ctx, ownerID, fileID)
	if err != nil {
		if errors.Is(err, ErrShareNotFound) {
			// Missing / foreign / trashed all wear the shared 404 face.
			return nil, ErrShareNotFound
		}
		return nil, fmt.Errorf("check shared file: %w", err)
	}

	ownerCount, err := s.shares.CountActiveByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("count owner shares: %w", err)
	}
	if ownerCount >= maxActiveSharesPerOwner {
		return nil, ErrTooManyShares
	}
	fileCount, err := s.shares.CountActiveByFile(ctx, fileID)
	if err != nil {
		return nil, fmt.Errorf("count file shares: %w", err)
	}
	if fileCount >= maxActiveSharesPerFile {
		return nil, ErrTooManyShares
	}

	var passwordHash *string
	if opts.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(opts.Password), sharePasswordBcryptCost)
		if err != nil {
			return nil, fmt.Errorf("hash share password: %w", err)
		}
		encoded := string(hash)
		passwordHash = &encoded
	}

	var lastErr error
	for attempt := 0; attempt < tokenCreateAttempts; attempt++ {
		token, err := newShareToken()
		if err != nil {
			return nil, err
		}
		share := &Share{
			Token:        token,
			OwnerID:      ownerID,
			FileID:       fileID,
			DisplayName:  active.OriginalName,
			PasswordHash: passwordHash,
		}
		if opts.ExpiresIn > 0 {
			expiresAt := time.Now().Add(opts.ExpiresIn)
			share.ExpiresAt = &expiresAt
		}
		if err := s.shares.Create(ctx, share); err != nil {
			lastErr = err
			continue
		}
		return share, nil
	}
	return nil, fmt.Errorf("create share after %d attempts: %w", tokenCreateAttempts, lastErr)
}

// Meta resolves a visitor-facing share by token and reports its state:
// revoked/expired/trashed all degrade to *ErrShareGone with a visitor-safe
// Reason (spec §3); unknown tokens keep the indistinguishable 404 face.
func (s *Service) Meta(ctx context.Context, token string) (*Share, *file.File, error) {
	share, err := s.shares.GetByToken(ctx, token)
	if err != nil {
		return nil, nil, err
	}
	if err := s.usableNow(share); err != nil {
		return nil, nil, err
	}
	active, err := s.activeFile(ctx, share)
	if err != nil {
		return nil, nil, err
	}
	return share, active, nil
}

// Verify checks the link password and, on success, signs a short-lived
// share-access JWT. Passwordless links are not verifiable (the caller
// should already have downloads open; ErrNoPassword keeps that a 400-face
// mistake rather than a fake 401).
func (s *Service) Verify(ctx context.Context, token string, password string) (string, error) {
	share, _, err := s.Meta(ctx, token)
	if err != nil {
		return "", err
	}
	if share.PasswordHash == nil {
		return "", ErrNoPassword
	}
	if err := bcrypt.CompareHashAndPassword([]byte(*share.PasswordHash), []byte(password)); err != nil {
		return "", ErrPassword
	}
	return s.tokens.IssueShareToken(share.ID)
}

// Access re-validates a share-access JWT on every download. The JWT stays
// cryptographically valid for auth.ShareTokenTTL (15 min), so revocation,
// expiry and file removal happening after issuance must be re-checked here —
// that is spec §3's bounded staleness window.
func (s *Service) Access(ctx context.Context, shareJWT string) (*Share, *file.File, error) {
	shareID, err := s.tokens.ParseShareToken(shareJWT)
	if err != nil {
		return nil, nil, err
	}
	share, err := s.shares.GetByID(ctx, shareID)
	if err != nil {
		return nil, nil, err
	}
	if err := s.usableNow(share); err != nil {
		return nil, nil, err
	}
	active, err := s.activeFile(ctx, share)
	if err != nil {
		return nil, nil, err
	}
	return share, active, nil
}

// IssueAccess and ParseAccess expose the TokenManager share scope so the
// HTTP layer never holds the manager directly (spec §4).
func (s *Service) IssueAccess(shareID uint64) (string, error) {
	return s.tokens.IssueShareToken(shareID)
}

func (s *Service) ParseAccess(shareJWT string) (uint64, error) {
	return s.tokens.ParseShareToken(shareJWT)
}

// Revoke passes ownership-checked soft revocation to the repository; the
// repository keeps DELETE idempotent (spec §3).
func (s *Service) Revoke(ctx context.Context, ownerID uint64, shareID uint64) error {
	return s.shares.Revoke(ctx, ownerID, shareID)
}

// IncrementDownload is pure statistics (v2: no limit gate). A nil error
// means the database applied the increment; the caller logs any failure and
// never blocks the download on it. Note: no existence semantics — unknown
// share IDs increment zero rows and still return nil (A1 passthrough).
func (s *Service) IncrementDownload(ctx context.Context, shareID uint64) error {
	return s.shares.IncrementDownload(ctx, shareID)
}

// usableNow judges share-level state against the application clock.
// Revoked outranks expired so the visitor sees the deliberate action.
func (s *Service) usableNow(share *Share) error {
	now := time.Now()
	if share.RevokedAt != nil {
		return &ErrShareGone{Reason: ReasonRevoked}
	}
	if share.ExpiresAt != nil && !now.Before(*share.ExpiresAt) {
		return &ErrShareGone{Reason: ReasonExpired}
	}
	return nil
}

func (s *Service) activeFile(ctx context.Context, share *Share) (*file.File, error) {
	active, err := s.files.GetActiveFile(ctx, share.OwnerID, share.FileID)
	if err != nil {
		if errors.Is(err, ErrShareNotFound) {
			return nil, &ErrShareGone{Reason: ReasonFileUnavailable}
		}
		return nil, fmt.Errorf("check shared file: %w", err)
	}
	return active, nil
}

func newShareToken() (string, error) {
	buf := make([]byte, tokenRandomBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate share token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
