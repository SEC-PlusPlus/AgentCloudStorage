//go:build integration

// Live-MySQL companion to B3: exercises the FULL InstantUpload service path
// (probe → folder auth → retry loop → InstantCreate tx) against the dev
// database on 127.0.0.1:3307 (migrations 000007/000008 applied). The point:
// concurrent same-sha probes ride AcquireBlob's documented S→X upgrade
// deadlock (B1 review RF1, integration-proven in TestAcquireBlobAdopterContention)
// and the bounded retry loop must turn that contention into unanimous 201s
// with exact refcount accounting.
package file

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
)

// instantRootFolders replicates folder.Service.EnsureOwned verbatim (see
// internal/folder/service.go): owner required, root id=0 passes, non-root
// consults s.repo.GetByID and wraps errors with the same text. Kept here
// because the folder service cannot be booted without a *gorm.DB-backed
// repository — and this test never probes non-root ids anyway.
type instantRootFolders struct{ owner uint64 }

func (f instantRootFolders) EnsureOwned(_ context.Context, ownerID uint64, folderID uint64) error {
	if ownerID == 0 {
		return fmt.Errorf("owner id is required")
	}
	if folderID == 0 {
		return nil
	}
	return fmt.Errorf("validate instant upload folder: ensure folder ownership: folder not found")
}

func TestInstantUploadConcurrentSameSha(t *testing.T) {
	db, repo := integrationDB(t)
	ctx := context.Background()
	sha := randomSha(t)
	size := int64(8192)
	t.Cleanup(func() {
		if err := db.Exec("DELETE FROM files WHERE object_key = ?", BlobObjectKey(sha)).Error; err != nil {
			t.Errorf("cleanup files: %v", err)
		}
		cleanupBlob(t, db, sha)
	})

	// Seed a quota-bearing user (defaults 1 GiB >> 2×8 KiB) and one committed
	// blob reference, so both probes take the ADOPT path (INSERT IGNORE dup →
	// SELECT FOR UPDATE) — the RF1 deadlock window — instead of plain inserts.
	var userID uint64
	if err := db.Table("users").Select("id").Limit(1).Scan(&userID).Error; err != nil || userID == 0 {
		t.Fatalf("no user row available for instant integration test (id=%d): %v", userID, err)
	}
	t.Cleanup(func() {
		if err := db.Exec("UPDATE users SET used_bytes = GREATEST(CAST(used_bytes AS SIGNED) - ?, 0) WHERE id = ?", 2*size, userID).Error; err != nil {
			t.Errorf("restore quota: %v", err)
		}
	})
	if obj, created := acquireInTx(t, db, repo, sha, "text/plain", size); !created || obj.Refcount != 1 {
		t.Fatalf("seed blob = (%+v, %v), want created=true refcount=1", obj, created)
	}

	svc := NewService(nil, repo, instantRootFolders{owner: userID})
	in := InstantInput{
		OwnerID:      userID,
		Sha256:       sha,
		OriginalName: "instant-race.txt",
		ContentType:  "text/plain",
		FolderID:     0,
	}

	const racers = 2
	start := make(chan struct{})
	var wg sync.WaitGroup
	var mu sync.Mutex
	var failures []string
	var rows []string

	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			<-start
			created, err := svc.InstantUpload(ctx, in)
			_ = n
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				// Retryable contention must be invisible after ≤4 attempts;
				// anything surfacing here is a REAL failure (busy exhaustion
				// counts as a failure to report, not a test crash).
				failures = append(failures, fmt.Sprintf("racer %d: %v", n, err))
				return
			}
			if created.ETag != sha || *created.Sha256 != sha || created.Size != size ||
				created.ObjectKey != BlobObjectKey(sha) || !strings.HasPrefix(created.ObjectKey, "blobs/") {
				failures = append(failures, fmt.Sprintf("racer %d row wrong: %+v", n, created))
				return
			}
			rows = append(rows, created.ObjectKey)
		}(i)
	}
	close(start)
	wg.Wait()

	if len(failures) != 0 {
		t.Fatalf("concurrent instant failures: %v", failures)
	}
	if len(rows) != racers {
		t.Fatalf("instant rows = %d, want %d", len(rows), racers)
	}

	// Refcount must equal exactly the committed acquires.
	got, err := repo.FindBlob(ctx, sha)
	if err != nil {
		t.Fatalf("FindBlob after race: %v", err)
	}
	if got.Refcount != 1+racers {
		t.Errorf("refcount = %d, want %d (1 seed + %d instant links)", got.Refcount, 1+racers, racers)
	}
	// Quota charged per instant file (spec §1.3 decision 1: dedup saves disk,
	// not the logical quota).
	var used int64
	if err := db.Table("users").Where("id = ?", userID).Select("used_bytes").Row().Scan(&used); err != nil {
		t.Fatalf("read used_bytes: %v", err)
	}
	if used < 2*size {
		t.Errorf("used_bytes = %d, want at least %d (both instants charged)", used, 2*size)
	}
}
