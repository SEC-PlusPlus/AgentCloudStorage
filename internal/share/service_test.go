package share

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"PersonalCloudStorage/internal/auth"
	"PersonalCloudStorage/internal/file"
)

// fakeRepository is an in-memory Repository. Counters and canned errors let
// each test drive exactly one branch; unused methods fail loudly.
type fakeRepository struct {
	shares        []*Share
	nextID        uint64
	createErrs    []error // consumed one per Create call; nil entry = success
	ownerCount    int
	ownerCountErr error
	fileCount     int
	fileCountErr  error

	createCalls  int
	failedTokens []string // tokens handed to Create calls that were rejected
	revokeCalls  int
	incrementErr error
	purgeErr     error
}

var _ Repository = (*fakeRepository)(nil)

func (r *fakeRepository) Create(_ context.Context, share *Share) error {
	r.createCalls++
	if len(r.createErrs) > 0 {
		err := r.createErrs[0]
		r.createErrs = r.createErrs[1:]
		if err != nil {
			r.failedTokens = append(r.failedTokens, share.Token)
			return err
		}
	}
	r.nextID++
	share.ID = r.nextID
	copied := *share
	r.shares = append(r.shares, &copied)
	return nil
}

func (r *fakeRepository) GetByToken(_ context.Context, token string) (*Share, error) {
	for _, s := range r.shares {
		if s.Token == token {
			copied := *s
			return &copied, nil
		}
	}
	return nil, ErrShareNotFound
}

func (r *fakeRepository) GetByID(_ context.Context, shareID uint64) (*Share, error) {
	for _, s := range r.shares {
		if s.ID == shareID {
			copied := *s
			return &copied, nil
		}
	}
	return nil, ErrShareNotFound
}

func (r *fakeRepository) ListByOwner(_ context.Context, ownerID uint64) ([]Share, error) {
	// Newest first (reverse insertion), mirroring the GORM order clause.
	var out []Share
	for i := len(r.shares) - 1; i >= 0; i-- {
		if r.shares[i].OwnerID == ownerID {
			copied := *r.shares[i]
			out = append(out, copied)
		}
	}
	return out, nil
}

func (r *fakeRepository) CountActiveByOwner(context.Context, uint64) (int, error) {
	return r.ownerCount, r.ownerCountErr
}

func (r *fakeRepository) CountActiveByFile(context.Context, uint64) (int, error) {
	return r.fileCount, r.fileCountErr
}

func (r *fakeRepository) Revoke(_ context.Context, ownerID uint64, shareID uint64) error {
	r.revokeCalls++
	for _, s := range r.shares {
		if s.ID == shareID {
			if s.OwnerID != ownerID {
				return ErrShareNotFound
			}
			now := time.Now()
			s.RevokedAt = &now
			return nil
		}
	}
	return ErrShareNotFound
}

func (r *fakeRepository) IncrementDownload(_ context.Context, shareID uint64) error {
	if r.incrementErr != nil {
		return r.incrementErr
	}
	for _, s := range r.shares {
		if s.ID == shareID {
			s.DownloadCount++
			return nil
		}
	}
	return nil
}

func (r *fakeRepository) PurgeByFileTx(tx *gorm.DB, fileID uint64) error {
	return r.purgeErr
}

// fakeFileLookup backs FileLookup with one seeded row. Per the interface
// contract it answers file.ErrFileNotFound for missing/foreign/trashed files
// (legacyNotFound switches to share.ErrShareNotFound to pin the robustness
// branch) and propagates lookupErr for real failures.
type fakeFileLookup struct {
	seed           *file.File
	seedFound      bool
	lookupErr      error
	legacyNotFound bool

	calls int
}

var _ FileLookup = (*fakeFileLookup)(nil)

func (f *fakeFileLookup) GetActiveFile(_ context.Context, ownerID, fileID uint64) (*file.File, error) {
	f.calls++
	if f.lookupErr != nil {
		return nil, f.lookupErr
	}
	if !f.seedFound || f.seed == nil || f.seed.ID != fileID || f.seed.OwnerID != ownerID || f.seed.Status != file.StatusActive {
		if f.legacyNotFound {
			return nil, ErrShareNotFound
		}
		return nil, file.ErrFileNotFound
	}
	// Mutating seed between calls lets tests flip status after a share exists
	// (e.g. Access re-check after a file moved to trash).
	copied := *f.seed
	return &copied, nil
}

func newTestTokenManager(t *testing.T) *auth.TokenManager {
	t.Helper()
	manager, err := auth.NewTokenManager(auth.TokenConfig{
		Secret:    "unit-test-secret-value-0123456789abcdef",
		Issuer:    "personal-cloud-storage-test",
		AccessTTL: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewTokenManager: %v", err)
	}
	return manager
}

func activeSeedFile() *file.File {
	return &file.File{
		ID:           10,
		OwnerID:      1,
		OriginalName: "annual-report.pdf",
		Size:         4242,
		ContentType:  "application/pdf",
		Status:       file.StatusActive,
	}
}

func TestCreateValidationMatrix(t *testing.T) {
	seed := activeSeedFile()
	cases := []struct {
		name          string
		lookup        *fakeFileLookup
		actor         uint64 // 0 → 1, the seed owner
		ownerCount    int
		fileCount     int
		ownerCountErr error
		fileCountErr  error
		password      string
		expiresIn     time.Duration
		wantErr       error
		wantErrAny    bool
	}{
		{
			name:    "missing file",
			lookup:  &fakeFileLookup{seedFound: false},
			wantErr: ErrShareNotFound,
		},
		{
			name:    "foreign file",
			lookup:  &fakeFileLookup{seed: seed, seedFound: true}, // actor 2 ≠ owner 1
			actor:   2,
			wantErr: ErrShareNotFound,
		},
		{
			// Also pins the robustness branch: the legacy share.ErrShareNotFound
			// from a lookup maps to the same 404 face as file.ErrFileNotFound.
			name: "trashed file via legacy sentinel",
			lookup: &fakeFileLookup{
				seed:           &file.File{ID: 10, OwnerID: 1, Status: file.StatusDeleted},
				seedFound:      true,
				legacyNotFound: true,
			},
			wantErr: ErrShareNotFound,
		},
		{
			name:       "file lookup database error",
			lookup:     &fakeFileLookup{lookupErr: errors.New("db down")},
			wantErrAny: true,
		},
		{
			name:       "owner limit reached",
			lookup:     &fakeFileLookup{seed: seed, seedFound: true},
			ownerCount: 50,
			wantErr:    ErrTooManyShares,
		},
		{
			name:      "file limit reached",
			lookup:    &fakeFileLookup{seed: seed, seedFound: true},
			fileCount: 20,
			wantErr:   ErrTooManyShares,
		},
		{
			name:          "owner count query fails",
			lookup:        &fakeFileLookup{seed: seed, seedFound: true},
			ownerCountErr: errors.New("count boom"),
			wantErrAny:    true,
		},
		{
			name:         "file count query fails",
			lookup:       &fakeFileLookup{seed: seed, seedFound: true},
			fileCountErr: errors.New("count boom"),
			wantErrAny:   true,
		},
		{
			name:     "password over rune cap",
			lookup:   &fakeFileLookup{seed: seed, seedFound: true},
			password: strings.Repeat("a", 65),
			wantErr:  ErrPasswordTooLong,
		},
		{
			// 25 hanzi = 25 runes (legal per spec) but 75 UTF-8 bytes —
			// bcrypt rejects >72, so the byte guard must produce a 400-face
			// sentinel instead of a 500.
			name:     "password over byte cap",
			lookup:   &fakeFileLookup{seed: seed, seedFound: true},
			password: strings.Repeat("汉", 25),
			wantErr:  ErrPasswordTooLong,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepository{ownerCount: tc.ownerCount, fileCount: tc.fileCount, ownerCountErr: tc.ownerCountErr, fileCountErr: tc.fileCountErr}
			svc := NewService(repo, tc.lookup, newTestTokenManager(t))

			actor := tc.actor
			if actor == 0 {
				actor = 1
			}
			_, err := svc.Create(context.Background(), actor, 10, CreateOptions{
				Password:  tc.password,
				ExpiresIn: tc.expiresIn,
			})
			if err == nil {
				t.Fatalf("Create returned nil error, want failure")
			}
			if tc.wantErr != nil && !errors.Is(err, tc.wantErr) {
				t.Fatalf("Create error = %v, want %v", err, tc.wantErr)
			}
			if tc.wantErrAny && (errors.Is(err, ErrShareNotFound) || errors.Is(err, ErrTooManyShares)) {
				t.Fatalf("Create error = %v, want non-sentinel failure", err)
			}
		})
	}

	t.Run("password length validated before any lookup", func(t *testing.T) {
		lookup := &fakeFileLookup{seed: seed, seedFound: true}
		repo := &fakeRepository{}
		svc := NewService(repo, lookup, newTestTokenManager(t))

		_, err := svc.Create(context.Background(), 1, 10, CreateOptions{Password: strings.Repeat("a", 65)})
		if !errors.Is(err, ErrPasswordTooLong) {
			t.Fatalf("Create error = %v, want ErrPasswordTooLong", err)
		}
		if lookup.calls != 0 || repo.createCalls != 0 {
			t.Fatalf("Create hit deps lookup=%d create=%d, want 0 and 0", lookup.calls, repo.createCalls)
		}
	})

	t.Run("password at both caps accepted", func(t *testing.T) {
		repo := &fakeRepository{}
		svc := NewService(repo, &fakeFileLookup{seed: seed, seedFound: true}, newTestTokenManager(t))

		// 64 ASCII chars hit the rune cap and stay under the 72-byte cap.
		if _, err := svc.Create(context.Background(), 1, 10, CreateOptions{Password: strings.Repeat("a", 64)}); err != nil {
			t.Fatalf("Create at caps: %v", err)
		}
	})

	t.Run("happy path freezes snapshot fields", func(t *testing.T) {
		repo := &fakeRepository{}
		svc := NewService(repo, &fakeFileLookup{seed: seed, seedFound: true}, newTestTokenManager(t))

		before := time.Now()
		created, err := svc.Create(context.Background(), 1, 10, CreateOptions{
			Password:  "hunter2",
			ExpiresIn: time.Hour,
		})
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		if created.DisplayName != seed.OriginalName {
			t.Errorf("DisplayName = %q, want %q", created.DisplayName, seed.OriginalName)
		}
		if created.OwnerID != 1 || created.FileID != 10 || created.ID == 0 {
			t.Errorf("identity fields wrong: %+v", created)
		}
		if created.PasswordHash == nil || *created.PasswordHash == "" {
			t.Fatalf("PasswordHash not set although password given")
		}
		if err := bcrypt.CompareHashAndPassword([]byte(*created.PasswordHash), []byte("hunter2")); err != nil {
			t.Errorf("stored hash rejects the given password: %v", err)
		}
		cost, err := bcrypt.Cost([]byte(*created.PasswordHash))
		if err != nil {
			t.Fatalf("bcrypt.Cost: %v", err)
		}
		if cost != 10 {
			t.Errorf("bcrypt cost = %d, want 10", cost)
		}
		if created.ExpiresAt == nil || created.ExpiresAt.Before(before.Add(time.Hour)) || created.ExpiresAt.After(time.Now().Add(time.Hour)) {
			t.Errorf("ExpiresAt = %v, want ≈ now+1h", created.ExpiresAt)
		}
	})

	t.Run("no password and no expiry store nils", func(t *testing.T) {
		repo := &fakeRepository{}
		svc := NewService(repo, &fakeFileLookup{seed: seed, seedFound: true}, newTestTokenManager(t))

		created, err := svc.Create(context.Background(), 1, 10, CreateOptions{})
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		if created.PasswordHash != nil {
			t.Errorf("PasswordHash = %v, want nil", *created.PasswordHash)
		}
		if created.ExpiresAt != nil {
			t.Errorf("ExpiresAt = %v, want nil", *created.ExpiresAt)
		}
	})
}

func TestCreateTokenShape(t *testing.T) {
	seed := activeSeedFile()
	repo := &fakeRepository{}
	svc := NewService(repo, &fakeFileLookup{seed: seed, seedFound: true}, newTestTokenManager(t))

	const draws = 1000
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	seen := make(map[string]bool, draws)
	for i := 0; i < draws; i++ {
		created, err := svc.Create(context.Background(), 1, 10, CreateOptions{})
		if err != nil {
			t.Fatalf("Create #%d: %v", i, err)
		}
		if len(created.Token) != 43 {
			t.Fatalf("token %q length = %d, want 43", created.Token, len(created.Token))
		}
		if strings.ContainsAny(created.Token, "=/+") {
			t.Fatalf("token %q not url-safe base64 without padding", created.Token)
		}
		for _, ch := range created.Token {
			if !strings.ContainsRune(alphabet, ch) {
				t.Fatalf("token %q has out-of-alphabet rune %q", created.Token, ch)
			}
		}
		if seen[created.Token] {
			t.Fatalf("token %q repeated across %d draws", created.Token, draws)
		}
		seen[created.Token] = true
	}

	t.Run("collision retried with fresh token up to 3 times", func(t *testing.T) {
		collision := errors.New("Error 1062: Duplicate entry for key 'uk_token'")
		dbBoom := errors.New("connection reset")

		r := &fakeRepository{createErrs: []error{collision}}
		s := NewService(r, &fakeFileLookup{seed: seed, seedFound: true}, newTestTokenManager(t))
		created, err := s.Create(context.Background(), 1, 10, CreateOptions{})
		if err != nil {
			t.Fatalf("Create after one collision: %v", err)
		}
		if r.createCalls != 2 {
			t.Fatalf("create calls = %d, want 2", r.createCalls)
		}
		if len(r.failedTokens) != 1 || created.Token == r.failedTokens[0] {
			t.Fatalf("retry reused the colliding token %q", created.Token)
		}

		r2 := &fakeRepository{createErrs: []error{dbBoom, dbBoom, dbBoom, dbBoom}}
		s2 := NewService(r2, &fakeFileLookup{seed: seed, seedFound: true}, newTestTokenManager(t))
		_, err = s2.Create(context.Background(), 1, 10, CreateOptions{})
		if err == nil {
			t.Fatalf("Create succeeded despite persistent failures")
		}
		if r2.createCalls != 4 {
			t.Fatalf("create calls = %d, want 4 (initial + 3 retries)", r2.createCalls)
		}
	})
}

func TestMetaStates(t *testing.T) {
	past := time.Now().Add(-time.Minute)
	revokedNow := time.Now()
	revokedAt := &revokedNow

	cases := []struct {
		name       string
		share      *Share
		seedFile   *file.File
		seedFound  bool
		legacy     bool
		lookupErr  error
		wantErr    error
		wantReason string
	}{
		{
			name:      "happy",
			share:     &Share{ID: 1, Token: "tok", OwnerID: 1, FileID: 10},
			seedFile:  activeSeedFile(),
			seedFound: true,
		},
		{
			name:    "unknown token",
			share:   nil,
			wantErr: ErrShareNotFound,
		},
		{
			name:       "revoked",
			share:      &Share{ID: 1, Token: "tok", OwnerID: 1, FileID: 10, RevokedAt: revokedAt},
			seedFile:   activeSeedFile(),
			seedFound:  true,
			wantReason: ReasonRevoked,
		},
		{
			name:       "expired",
			share:      &Share{ID: 1, Token: "tok", OwnerID: 1, FileID: 10, ExpiresAt: &past},
			seedFile:   activeSeedFile(),
			seedFound:  true,
			wantReason: ReasonExpired,
		},
		{
			name:       "revoked beats expired",
			share:      &Share{ID: 1, Token: "tok", OwnerID: 1, FileID: 10, RevokedAt: revokedAt, ExpiresAt: &past},
			seedFile:   activeSeedFile(),
			seedFound:  true,
			wantReason: ReasonRevoked,
		},
		{
			name:       "file trashed",
			share:      &Share{ID: 1, Token: "tok", OwnerID: 1, FileID: 10},
			seedFile:   &file.File{ID: 10, OwnerID: 1, Status: file.StatusDeleted},
			seedFound:  true,
			wantReason: ReasonFileUnavailable,
		},
		{
			name:       "file gone from disk",
			share:      &Share{ID: 1, Token: "tok", OwnerID: 1, FileID: 10},
			seedFound:  false,
			legacy:     true, // share.ErrShareNotFound from lookup maps too
			wantReason: ReasonFileUnavailable,
		},
		{
			name:      "lookup database error propagates",
			share:     &Share{ID: 1, Token: "tok", OwnerID: 1, FileID: 10},
			lookupErr: errors.New("db down"),
			wantErr:   nil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepository{}
			if tc.share != nil {
				if err := repo.Create(context.Background(), tc.share); err != nil {
					t.Fatalf("seed: %v", err)
				}
			}
			lookup := &fakeFileLookup{seed: tc.seedFile, seedFound: tc.seedFound, lookupErr: tc.lookupErr, legacyNotFound: tc.legacy}
			svc := NewService(repo, lookup, newTestTokenManager(t))

			got, gotFile, err := svc.Meta(context.Background(), "tok")

			if tc.name == "lookup database error propagates" {
				if !errors.Is(err, lookup.lookupErr) {
					t.Fatalf("Meta error = %v, want wrapped lookup error", err)
				}
				var gone *ErrShareGone
				if errors.As(err, &gone) {
					t.Fatalf("database error must not masquerade as ErrShareGone: %v", err)
				}
				return
			}
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("Meta error = %v, want %v", err, tc.wantErr)
				}
				return
			}
			if tc.wantReason != "" {
				var gone *ErrShareGone
				if !errors.As(err, &gone) {
					t.Fatalf("Meta error = %v, want *ErrShareGone", err)
				}
				if gone.Reason != tc.wantReason {
					t.Fatalf("gone.Reason = %q, want %q", gone.Reason, tc.wantReason)
				}
				return
			}
			if err != nil {
				t.Fatalf("Meta: %v", err)
			}
			if got.ID != tc.share.ID || got.Token != tc.share.Token {
				t.Errorf("Meta returned wrong share: %+v", got)
			}
			if gotFile == nil || gotFile.ID != tc.share.FileID {
				t.Errorf("Meta returned wrong file: %+v", gotFile)
			}
		})
	}
}

func TestVerifyPasswords(t *testing.T) {
	hashBytes, err := bcrypt.GenerateFromPassword([]byte("hunter2"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("seed hash: %v", err)
	}
	hash := string(hashBytes)
	expired := time.Now().Add(-time.Minute)

	passworded := func() *Share {
		return &Share{ID: 0, Token: "tok-pw", OwnerID: 1, FileID: 10, PasswordHash: &hash}
	}
	open := func() *Share {
		return &Share{ID: 0, Token: "tok-open", OwnerID: 1, FileID: 10}
	}

	cases := []struct {
		name     string
		share    *Share
		token    string
		password string
		wantErr  error
		wantJWT  bool
	}{
		{name: "correct password", share: passworded(), token: "tok-pw", password: "hunter2", wantJWT: true},
		{name: "wrong password", share: passworded(), token: "tok-pw", password: "wrong", wantErr: ErrPassword},
		{name: "empty password against set", share: passworded(), token: "tok-pw", password: "", wantErr: ErrPassword},
		{name: "passwordless share", share: open(), token: "tok-open", password: "anything", wantErr: ErrNoPassword},
		{
			name:  "expired inherits gone",
			share: &Share{Token: "tok-pw", OwnerID: 1, FileID: 10, PasswordHash: &hash, ExpiresAt: &expired},
			token: "tok-pw", password: "hunter2",
		},
		{name: "unknown token", share: nil, token: "nope", password: "x", wantErr: ErrShareNotFound},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepository{}
			var seededID uint64
			if tc.share != nil {
				if err := repo.Create(context.Background(), tc.share); err != nil {
					t.Fatalf("seed: %v", err)
				}
				seededID = repo.nextID
			}
			tokens := newTestTokenManager(t)
			svc := NewService(repo, &fakeFileLookup{seed: activeSeedFile(), seedFound: true}, tokens)

			jwt, err := svc.Verify(context.Background(), tc.token, tc.password)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("Verify error = %v, want %v", err, tc.wantErr)
				}
				return
			}
			if tc.name == "expired inherits gone" {
				var gone *ErrShareGone
				if !errors.As(err, &gone) || gone.Reason != ReasonExpired {
					t.Fatalf("Verify error = %v, want gone/expired", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Verify: %v", err)
			}
			if !tc.wantJWT {
				t.Fatalf("unexpected success")
			}
			shareID, err := tokens.ParseShareToken(jwt)
			if err != nil {
				t.Fatalf("issued JWT rejected by ParseShareToken: %v", err)
			}
			if shareID != seededID {
				t.Fatalf("JWT share id = %d, want %d", shareID, seededID)
			}
		})
	}
}

func TestAccessStateMatrix(t *testing.T) {
	newSvc := func(t *testing.T, repo *fakeRepository, lookup *fakeFileLookup) (*Service, *auth.TokenManager) {
		t.Helper()
		tokens := newTestTokenManager(t)
		return NewService(repo, lookup, tokens), tokens
	}

	t.Run("invalid jwt rejected", func(t *testing.T) {
		svc, _ := newSvc(t, &fakeRepository{}, &fakeFileLookup{seed: activeSeedFile(), seedFound: true})
		_, _, err := svc.Access(context.Background(), "not-a-jwt")
		if !errors.Is(err, auth.ErrInvalidToken) {
			t.Fatalf("Access error = %v, want auth.ErrInvalidToken", err)
		}
	})

	t.Run("jwt for unknown share", func(t *testing.T) {
		svc, tokens := newSvc(t, &fakeRepository{}, &fakeFileLookup{seed: activeSeedFile(), seedFound: true})
		jwt, err := tokens.IssueShareToken(4242)
		if err != nil {
			t.Fatalf("IssueShareToken: %v", err)
		}
		_, _, err = svc.Access(context.Background(), jwt)
		if !errors.Is(err, ErrShareNotFound) {
			t.Fatalf("Access error = %v, want ErrShareNotFound", err)
		}
	})

	t.Run("access token JWT is refused", func(t *testing.T) {
		svc, tokens := newSvc(t, &fakeRepository{}, &fakeFileLookup{seed: activeSeedFile(), seedFound: true})
		userJWT, _, err := tokens.GenerateAccessToken(7)
		if err != nil {
			t.Fatalf("GenerateAccessToken: %v", err)
		}
		_, _, err = svc.Access(context.Background(), userJWT)
		if !errors.Is(err, auth.ErrInvalidToken) {
			t.Fatalf("Access with user-scope JWT = %v, want auth.ErrInvalidToken", err)
		}
	})

	// revokedAfterIssue pins the spec §3 staleness rule: a JWT signed minutes
	// ago must stop working the instant the share is revoked.
	staleCases := []struct {
		name       string
		mutate     func(*Share)
		wantReason string
	}{
		{"revoked after issue", func(s *Share) { now := time.Now(); s.RevokedAt = &now }, ReasonRevoked},
		{"expired after issue", func(s *Share) { past := time.Now().Add(-time.Second); s.ExpiresAt = &past }, ReasonExpired},
	}
	for _, tc := range staleCases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepository{}
			seedShare := &Share{Token: "tok", OwnerID: 1, FileID: 10}
			if err := repo.Create(context.Background(), seedShare); err != nil {
				t.Fatalf("seed: %v", err)
			}
			svc, tokens := newSvc(t, repo, &fakeFileLookup{seed: activeSeedFile(), seedFound: true})
			jwt, err := tokens.IssueShareToken(seedShare.ID)
			if err != nil {
				t.Fatalf("IssueShareToken: %v", err)
			}
			for _, s := range repo.shares {
				if s.ID == seedShare.ID {
					tc.mutate(s)
				}
			}
			_, _, err = svc.Access(context.Background(), jwt)
			var gone *ErrShareGone
			if !errors.As(err, &gone) || gone.Reason != tc.wantReason {
				t.Fatalf("Access error = %v, want gone/%s", err, tc.wantReason)
			}
		})
	}

	t.Run("file trashed after issue", func(t *testing.T) {
		repo := &fakeRepository{}
		seedShare := &Share{Token: "tok", OwnerID: 1, FileID: 10}
		if err := repo.Create(context.Background(), seedShare); err != nil {
			t.Fatalf("seed: %v", err)
		}
		seedFile := activeSeedFile()
		svc, tokens := newSvc(t, repo, &fakeFileLookup{seed: seedFile, seedFound: true})
		jwt, err := tokens.IssueShareToken(seedShare.ID)
		if err != nil {
			t.Fatalf("IssueShareToken: %v", err)
		}
		seedFile.Status = file.StatusDeleted
		_, _, err = svc.Access(context.Background(), jwt)
		var gone *ErrShareGone
		if !errors.As(err, &gone) || gone.Reason != ReasonFileUnavailable {
			t.Fatalf("Access error = %v, want gone/%s", err, ReasonFileUnavailable)
		}
	})

	t.Run("happy path returns share and file", func(t *testing.T) {
		repo := &fakeRepository{}
		seedShare := &Share{Token: "tok", OwnerID: 1, FileID: 10}
		if err := repo.Create(context.Background(), seedShare); err != nil {
			t.Fatalf("seed: %v", err)
		}
		svc, tokens := newSvc(t, repo, &fakeFileLookup{seed: activeSeedFile(), seedFound: true})
		jwt, err := tokens.IssueShareToken(seedShare.ID)
		if err != nil {
			t.Fatalf("IssueShareToken: %v", err)
		}
		got, gotFile, err := svc.Access(context.Background(), jwt)
		if err != nil {
			t.Fatalf("Access: %v", err)
		}
		if got.ID != seedShare.ID || gotFile.ID != 10 {
			t.Fatalf("Access returned %+v/%+v", got, gotFile)
		}
	})

	t.Run("user token cannot verify into share scope", func(t *testing.T) {
		// Cross-scope guard: Verify output must only parse via ParseShareToken.
		repo := &fakeRepository{}
		hashBytes, _ := bcrypt.GenerateFromPassword([]byte("pw"), bcrypt.MinCost)
		hash := string(hashBytes)
		seedShare := &Share{Token: "tok", OwnerID: 1, FileID: 10, PasswordHash: &hash}
		if err := repo.Create(context.Background(), seedShare); err != nil {
			t.Fatalf("seed: %v", err)
		}
		svc, tokens := newSvc(t, repo, &fakeFileLookup{seed: activeSeedFile(), seedFound: true})
		jwt, err := svc.Verify(context.Background(), "tok", "pw")
		if err != nil {
			t.Fatalf("Verify: %v", err)
		}
		if _, err := tokens.ParseAccessToken(jwt); !errors.Is(err, auth.ErrInvalidToken) {
			t.Fatalf("ParseAccessToken(share JWT) = %v, want ErrInvalidToken", err)
		}
	})
}

func TestRevokeAndIncrementPassthrough(t *testing.T) {
	repo := &fakeRepository{}
	seedShare := &Share{Token: "tok", OwnerID: 1, FileID: 10}
	if err := repo.Create(context.Background(), seedShare); err != nil {
		t.Fatalf("seed: %v", err)
	}
	svc := NewService(repo, &fakeFileLookup{seed: activeSeedFile(), seedFound: true}, newTestTokenManager(t))

	if err := svc.Revoke(context.Background(), 1, seedShare.ID); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	if repo.revokeCalls != 1 || repo.shares[0].RevokedAt == nil {
		t.Fatalf("Revoke did not reach repository: %+v", repo.shares[0])
	}
	if err := svc.Revoke(context.Background(), 2, seedShare.ID); !errors.Is(err, ErrShareNotFound) {
		t.Fatalf("foreign Revoke = %v, want ErrShareNotFound", err)
	}

	if err := svc.IncrementDownload(context.Background(), seedShare.ID); err != nil {
		t.Fatalf("IncrementDownload: %v", err)
	}
	if repo.shares[0].DownloadCount != 1 {
		t.Fatalf("DownloadCount = %d, want 1", repo.shares[0].DownloadCount)
	}
	repo.incrementErr = errors.New("db boom")
	if err := svc.IncrementDownload(context.Background(), seedShare.ID); err == nil {
		t.Fatalf("IncrementDownload swallowed repository error")
	}
}

// TestListReturnsOwnerShares newest-first, revoked included (spec §3 GET /shares).
func TestListReturnsOwnerShares(t *testing.T) {
	repo := &fakeRepository{}
	svc := NewService(repo, &fakeFileLookup{seed: activeSeedFile(), seedFound: true}, newTestTokenManager(t))

	first, err := svc.Create(context.Background(), 1, 10, CreateOptions{})
	if err != nil {
		t.Fatalf("seed create: %v", err)
	}
	second, err := svc.Create(context.Background(), 1, 10, CreateOptions{})
	if err != nil {
		t.Fatalf("seed create: %v", err)
	}
	// Foreign owner's row goes in directly (the fake FileLookup is owner-pinned).
	repo.shares = append(repo.shares, &Share{ID: 900, OwnerID: 2, FileID: 10, Token: "foreign-token"})

	shares, err := svc.List(context.Background(), 1)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(shares) != 2 {
		t.Fatalf("List length = %d, want 2 (other owner excluded)", len(shares))
	}
	if shares[0].ID != second.ID || shares[1].ID != first.ID {
		t.Fatalf("List order = [%d,%d], want newest first [%d,%d]",
			shares[0].ID, shares[1].ID, second.ID, first.ID)
	}

	// Revoking stays visible to the owner view.
	if err := svc.RevokeByToken(context.Background(), 1, first.Token); err != nil {
		t.Fatalf("RevokeByToken owner path: %v", err)
	}
	shares, err = svc.List(context.Background(), 1)
	if err != nil {
		t.Fatalf("List after revoke: %v", err)
	}
	if len(shares) != 2 || shares[1].RevokedAt == nil {
		t.Fatalf("revoked share missing from owner list: %+v", shares)
	}
}

// TestRevokeByTokenFaces pins the owner 404 indistinguishability and the
// idempotent 204 path backing DELETE /shares/:token (spec §3).
func TestRevokeByTokenFaces(t *testing.T) {
	repo := &fakeRepository{}
	svc := NewService(repo, &fakeFileLookup{seed: activeSeedFile(), seedFound: true}, newTestTokenManager(t))

	owned, err := svc.Create(context.Background(), 1, 10, CreateOptions{})
	if err != nil {
		t.Fatalf("seed create: %v", err)
	}
	// Foreign owner's row goes in directly (the fake FileLookup is owner-pinned).
	foreign := &Share{ID: 900, OwnerID: 2, FileID: 10, Token: "foreign-token"}
	repo.shares = append(repo.shares, foreign)

	// Foreign token: 404 face and the repository is never asked to revoke.
	revokeCallsBefore := repo.revokeCalls
	if err := svc.RevokeByToken(context.Background(), 1, foreign.Token); !errors.Is(err, ErrShareNotFound) {
		t.Fatalf("foreign RevokeByToken = %v, want ErrShareNotFound", err)
	}
	if repo.revokeCalls != revokeCallsBefore {
		t.Fatalf("foreign revoke reached repository (%d calls)", repo.revokeCalls)
	}

	if err := svc.RevokeByToken(context.Background(), 1, "no-such-token"); !errors.Is(err, ErrShareNotFound) {
		t.Fatalf("unknown RevokeByToken = %v, want ErrShareNotFound", err)
	}

	if err := svc.RevokeByToken(context.Background(), 1, owned.Token); err != nil {
		t.Fatalf("owner RevokeByToken: %v", err)
	}
	if repo.shares[0].RevokedAt == nil {
		t.Fatalf("RevokeByToken did not mark the share revoked")
	}
	// Already revoked stays a no-op → handler answers 204 (idempotent DELETE).
	if err := svc.RevokeByToken(context.Background(), 1, owned.Token); err != nil {
		t.Fatalf("second RevokeByToken = %v, want nil (idempotent)", err)
	}
}
