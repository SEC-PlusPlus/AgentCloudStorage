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
