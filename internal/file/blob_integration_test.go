//go:build integration

// This file exercises the blob refcount primitives against a real MySQL 8
// (dev container govault-mysql on 127.0.0.1:3307). Run with:
//
//	MYSQL_DSN=... go test -tags integration ./internal/file/
//
// The DSN is read straight from the environment — the same MYSQL_DSN the app
// consumes via internal/config — so no secret ever lands in this file.
package file

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func integrationDB(t *testing.T) (*gorm.DB, *GORMRepository) {
	t.Helper()
	dsn := os.Getenv("MYSQL_DSN")
	if dsn == "" {
		t.Skip("MYSQL_DSN not set; skipping MySQL integration test")
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open mysql: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("underlying sql db: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		t.Fatalf("ping mysql: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db, NewGORMRepository(db)
}

func randomSha(t *testing.T) string {
	t.Helper()
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		t.Fatalf("random sha: %v", err)
	}
	return hex.EncodeToString(raw[:])
}

func acquireInTx(t *testing.T, db *gorm.DB, repo *GORMRepository, sha, contentType string, size int64) (*Object, bool) {
	t.Helper()
	var obj *Object
	var created bool
	err := db.Transaction(func(tx *gorm.DB) error {
		var err error
		obj, created, err = repo.AcquireBlob(tx, sha, contentType, size)
		return err
	})
	if err != nil {
		t.Fatalf("AcquireBlob tx (%s): %v", sha, err)
	}
	return obj, created
}

func releaseInTx(t *testing.T, db *gorm.DB, repo *GORMRepository, sha string) (string, bool) {
	t.Helper()
	var key string
	var gone bool
	err := db.Transaction(func(tx *gorm.DB) error {
		var err error
		key, gone, err = repo.ReleaseBlob(tx, sha)
		return err
	})
	if err != nil {
		t.Fatalf("ReleaseBlob tx (%s): %v", sha, err)
	}
	return key, gone
}

func cleanupBlob(t *testing.T, db *gorm.DB, sha string) {
	t.Helper()
	if err := db.Exec("DELETE FROM objects WHERE sha256 = ?", sha).Error; err != nil {
		t.Errorf("cleanup objects row %s: %v", sha, err)
	}
}

func TestBlobLifecycleOnMySQL(t *testing.T) {
	db, repo := integrationDB(t)
	ctx := context.Background()
	sha := randomSha(t)
	key := BlobObjectKey(sha)
	t.Cleanup(func() { cleanupBlob(t, db, sha) })

	// Cold miss must answer the sentinel, not a wrapped gorm error.
	if _, err := repo.FindBlob(ctx, sha); !errors.Is(err, ErrBlobNotFound) {
		t.Fatalf("FindBlob miss error = %v, want ErrBlobNotFound", err)
	}

	// First acquire inserts the row with refcount 1.
	obj, created := acquireInTx(t, db, repo, sha, "text/plain", 4096)
	if !created {
		t.Fatal("first AcquireBlob created = false, want true")
	}
	if obj.Refcount != 1 || obj.ObjectKey != key || obj.ContentType != "text/plain" || obj.Size != 4096 {
		t.Fatalf("first acquire object = %+v, want refcount 1 / key %s / text/plain / 4096", obj, key)
	}

	// Second acquire adopts the existing row and bumps refcount to 2.
	obj, created = acquireInTx(t, db, repo, sha, "text/markdown", 4096)
	if created {
		t.Fatal("second AcquireBlob created = true, want false")
	}
	if obj.Refcount != 2 {
		t.Fatalf("second acquire refcount = %d, want 2", obj.Refcount)
	}
	if obj.ContentType != "text/plain" {
		t.Errorf("content_type = %q, want first-uploader value text/plain", obj.ContentType)
	}

	got, err := repo.FindBlob(ctx, sha)
	if err != nil {
		t.Fatalf("FindBlob hit: %v", err)
	}
	if got.Refcount != 2 || got.ObjectKey != key {
		t.Fatalf("FindBlob hit = %+v, want refcount 2 / key %s", got, key)
	}

	// Release 2->1 keeps the row.
	gotKey, gone := releaseInTx(t, db, repo, sha)
	if gone || gotKey != key {
		t.Fatalf("first release = (%q, %v), want (%q, false)", gotKey, gone, key)
	}

	// Release 1->0 deletes the row and hands the key to the caller.
	gotKey, gone = releaseInTx(t, db, repo, sha)
	if !gone || gotKey != key {
		t.Fatalf("final release = (%q, %v), want (%q, true)", gotKey, gone, key)
	}
	var count int64
	if err := db.Table("objects").Where("sha256 = ?", sha).Count(&count).Error; err != nil {
		t.Fatalf("count objects: %v", err)
	}
	if count != 0 {
		t.Errorf("objects rows after zero release = %d, want 0", count)
	}
	if _, err := repo.FindBlob(ctx, sha); !errors.Is(err, ErrBlobNotFound) {
		t.Errorf("FindBlob after delete = %v, want ErrBlobNotFound", err)
	}

	// Release once more against the missing row: idempotent no-op.
	gotKey, gone = releaseInTx(t, db, repo, sha)
	if gotKey != "" || gone {
		t.Errorf("release after gone = (%q, %v), want (\"\", false)", gotKey, gone)
	}
}

func TestAcquireBlobConcurrentCreatedExactlyOnce(t *testing.T) {
	db, repo := integrationDB(t)
	sha := randomSha(t)
	t.Cleanup(func() { cleanupBlob(t, db, sha) })

	const writers = 2
	start := make(chan struct{})
	var wg sync.WaitGroup
	var mu sync.Mutex
	createdCount := 0
	var failures []error

	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			var created bool
			err := db.Transaction(func(tx *gorm.DB) error {
				var err error
				_, created, err = repo.AcquireBlob(tx, sha, "application/octet-stream", 7)
				return err
			})
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failures = append(failures, err)
				return
			}
			if created {
				createdCount++
			}
		}()
	}
	close(start)
	wg.Wait()

	if len(failures) != 0 {
		t.Fatalf("concurrent acquire failures: %v", failures)
	}
	if createdCount != 1 {
		t.Fatalf("created count = %d, want exactly 1", createdCount)
	}

	obj, err := repo.FindBlob(context.Background(), sha)
	if err != nil {
		t.Fatalf("FindBlob after concurrent acquire: %v", err)
	}
	if obj.Refcount != writers {
		t.Errorf("refcount = %d, want %d", obj.Refcount, writers)
	}

	// Drain the refs so the row is removed for the next run.
	for i := 0; i < writers; i++ {
		releaseInTx(t, db, repo, sha)
	}
}

// isRetryableLockError classifies the RF1 deadlock contract: InnoDB 1213
// (deadlock victim) and 1205 (lock wait timeout) must be retryable at the
// caller level, never corruption. Substring matching keeps go-sql-driver an
// indirect dependency (no go.mod churn); gorm surfaces the errno text.
func isRetryableLockError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "1213") || strings.Contains(msg, "Deadlock found") ||
		strings.Contains(msg, "1205") || strings.Contains(msg, "Lock wait timeout")
}

// TestBlobAcquireReleaseInterleave covers the spec §5 mandated three-way
// race: releases racing (re)acquires on one sha, including the row reaching
// zero, being deleted, and being re-inserted by a late Acquire. Accounting is
// exact against committed transactions only: deadlock/timeout losers roll
// back cleanly and are not counted.
func TestBlobAcquireReleaseInterleave(t *testing.T) {
	db, repo := integrationDB(t)
	ctx := context.Background()
	sha := randomSha(t)
	key := BlobObjectKey(sha)
	t.Cleanup(func() { cleanupBlob(t, db, sha) })

	// Seed one committed reference (refcount=1).
	if obj, created := acquireInTx(t, db, repo, sha, "text/plain", 8); !created || obj.Refcount != 1 {
		t.Fatalf("seed acquire = (%+v), want created=true refcount=1", obj)
	}

	const acquirers, releasers = 4, 4
	start := make(chan struct{})
	var wg sync.WaitGroup
	var mu sync.Mutex
	var acquired, decrements, noopReleases, retryable int
	var fatal []error

	// run races one transaction; commit (nil on failure) records the
	// committed transaction's effect under the shared mutex.
	run := func(tx func() error, commit func()) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			err := tx()
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				if commit != nil {
					commit()
				}
			case isRetryableLockError(err):
				retryable++
			default:
				fatal = append(fatal, err)
			}
		}()
	}

	for i := 0; i < acquirers; i++ {
		run(func() error {
			return db.Transaction(func(tx *gorm.DB) error {
				_, _, err := repo.AcquireBlob(tx, sha, "text/plain", 8)
				return err
			})
		}, func() { acquired++ })
	}
	for i := 0; i < releasers; i++ {
		noop := false
		run(func() error {
			var gotKey string
			var gone bool
			err := db.Transaction(func(tx *gorm.DB) error {
				var err error
				gotKey, gone, err = repo.ReleaseBlob(tx, sha)
				return err
			})
			// ("", false) on a committed tx = row already gone: idempotent
			// no-op, deliberately NOT counted as a decrement.
			noop = err == nil && gotKey == "" && !gone
			return err
		}, func() {
			if noop {
				noopReleases++
			} else {
				decrements++
			}
		})
	}
	close(start)
	wg.Wait()

	if len(fatal) != 0 {
		t.Fatalf("non-retryable failures under interleave: %v", fatal)
	}
	t.Logf("interleave: acquired=%d decrements=%d noopReleases=%d retryable(1213/1205)=%d",
		acquired, decrements, noopReleases, retryable)

	expected := 1 + acquired - decrements
	if expected < 0 {
		t.Fatalf("accounting says refcount=%d < 0 — lost bookkeeping", expected)
	}
	var rows []Object
	if err := db.WithContext(ctx).Where("sha256 = ?", sha).Find(&rows).Error; err != nil {
		t.Fatalf("read objects: %v", err)
	}
	if expected == 0 {
		if len(rows) != 0 {
			t.Fatalf("expected zero refs but row survived: %+v", rows)
		}
		return
	}
	if len(rows) != 1 {
		t.Fatalf("expected exactly 1 objects row, got %d", len(rows))
	}
	obj := rows[0]
	if obj.Refcount != expected {
		t.Fatalf("refcount = %d, want %d (acquired=%d decrements=%d)", obj.Refcount, expected, acquired, decrements)
	}
	if obj.ObjectKey != key || obj.Refcount <= 0 {
		t.Fatalf("surviving row corrupted: %+v (want key %s, refcount > 0)", obj, key)
	}
}

// TestAcquireBlobAdopterContention strengthens the cold-start pair test:
// the row is PRE-CREATED, so every racing Acquire takes the
// INSERT-IGNORE-duplicate-S-lock → SELECT-FOR-UPDATE-X path (the RF1
// deadlock window). N=6 racing transactions; committed acquirers must show
// up one-by-one in refcount, and every failure must be a retryable
// 1213/1205 — never a wrong-shape result or corruption.
func TestAcquireBlobAdopterContention(t *testing.T) {
	db, repo := integrationDB(t)
	ctx := context.Background()
	sha := randomSha(t)
	t.Cleanup(func() { cleanupBlob(t, db, sha) })

	if obj, created := acquireInTx(t, db, repo, sha, "video/mp4", 16); !created || obj.Refcount != 1 {
		t.Fatalf("pre-create failed: %+v created=%v", obj, created)
	}

	const racers = 6
	start := make(chan struct{})
	var wg sync.WaitGroup
	var mu sync.Mutex
	committed, retryable, createdAgain := 0, 0, 0
	var fatal []error

	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			var created bool
			err := db.Transaction(func(tx *gorm.DB) error {
				var err error
				_, created, err = repo.AcquireBlob(tx, sha, "video/mp4", 16)
				return err
			})
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				committed++
				if created {
					createdAgain++ // pre-existing row must never report created
				}
			case isRetryableLockError(err):
				retryable++
			default:
				fatal = append(fatal, err)
			}
		}()
	}
	close(start)
	wg.Wait()

	if len(fatal) != 0 {
		t.Fatalf("non-retryable adopter failures: %v", fatal)
	}
	if createdAgain != 0 {
		t.Errorf("adopters on existing row reported created=true %d times, want 0", createdAgain)
	}
	t.Logf("adopter contention: committed=%d retryable(1213/1205)=%d of %d racers", committed, retryable, racers)

	var obj Object
	if err := db.WithContext(ctx).Where("sha256 = ?", sha).First(&obj).Error; err != nil {
		t.Fatalf("row vanished under pure acquires: %v", err)
	}
	if obj.Refcount != 1+committed {
		t.Fatalf("refcount = %d, want %d (1 pre-create + %d committed acquires)", obj.Refcount, 1+committed, committed)
	}
	if committed == 0 {
		t.Error("no acquire committed at all — contention setup starved; investigate")
	}
}

// TestBlobInputGuards locks in RF2: malformed sha never reaches the table
// (INSERT IGNORE would coerce it into a phantom row), and an over-long
// content_type is CLAMPED to the objects column width so files/objects stay
// consistent — the returned Object is the authority callers must copy.
func TestBlobInputGuards(t *testing.T) {
	db, repo := integrationDB(t)
	ctx := context.Background()

	badShas := []string{"", "deadbeef", strings.Repeat("A", 64), strings.Repeat("g", 64), strings.Repeat("f", 63)}
	for _, bad := range badShas {
		err := db.Transaction(func(tx *gorm.DB) error {
			_, _, err := repo.AcquireBlob(tx, bad, "text/plain", 1)
			return err
		})
		if !errors.Is(err, ErrInvalidSha256) {
			t.Errorf("AcquireBlob(%q) error = %v, want ErrInvalidSha256", bad, err)
		}
	}
	// Rejected shas must not have created rows.
	var count int64
	if err := db.WithContext(ctx).Table("objects").Where("sha256 IN ?", []string{strings.Repeat("A", 64), strings.Repeat("g", 64)}).Count(&count).Error; err != nil {
		t.Fatalf("count guards: %v", err)
	}
	if count != 0 {
		t.Errorf("phantom rows from rejected shas: %d", count)
	}

	// Over-long content_type (300 runes incl. multibyte) → clamped to 127.
	sha := randomSha(t)
	t.Cleanup(func() { cleanupBlob(t, db, sha) })
	long := strings.Repeat("é", 300)
	obj, created := acquireInTx(t, db, repo, sha, long, 3)
	if !created {
		t.Fatal("clamped acquire: created=false")
	}
	if n := len([]rune(obj.ContentType)); n != maxBlobContentTypeLen {
		t.Errorf("clamped content_type runes = %d, want %d", n, maxBlobContentTypeLen)
	}
	stored, err := repo.FindBlob(ctx, sha)
	if err != nil {
		t.Fatalf("FindBlob after clamped insert: %v", err)
	}
	if stored.ContentType != obj.ContentType {
		t.Error("persisted objects content_type diverges from returned Object — clamp not applied to insert")
	}

	// Exactly-127 value must pass through untouched.
	okSha := randomSha(t)
	t.Cleanup(func() { cleanupBlob(t, db, okSha) })
	exact := strings.Repeat("x", maxBlobContentTypeLen)
	obj, _ = acquireInTx(t, db, repo, okSha, exact, 3)
	if obj.ContentType != exact {
		t.Errorf("127-char content_type mutated: %q", obj.ContentType)
	}
}
