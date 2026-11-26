//go:build integration

// Live-MySQL companion to B5 (spec §8 + task contract 1/2). Proves on a real
// InnoDB:
//
//  1. THE RED LINE — two dedup rows share blobs/<sha>; permanently deleting
//     one leaves the other fully downloadable (refcount 2→1, ZERO blob-key
//     deletes, bytes intact).
//
//  2. The last-reference release deletes ONLY the objects row — the physical
//     blob survives for cmd/blob-gc's window (§1.4).
//
//  3. Concurrent PermanentDelete × InstantUpload on one sha: the objects-first
//     lock order (B3-M4) plus the shared bounded retry (contract 1) make every
//     outcome either a clean commit or the legitimate blob-gone miss — never
//     a surfaced 1213/1205, and the refcount invariant holds at the end.
//
//     MYSQL_DSN=... go test -tags integration ./internal/file/
package file

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"

	"gorm.io/gorm"
)

func filesCountForSha(t *testing.T, db *gorm.DB, sha string) int64 {
	t.Helper()
	var n int64
	if err := db.Table("files").Where("sha256 = ?", sha).Count(&n).Error; err != nil {
		t.Fatalf("count files for sha: %v", err)
	}
	return n
}

func TestPermanentDeleteDedupKeepsTwinDownloadable(t *testing.T) {
	db, repo := integrationDB(t)
	ctx := context.Background()
	store := &dedupStorageFake{}

	var userID uint64
	if err := db.Table("users").Select("id").Limit(1).Scan(&userID).Error; err != nil || userID == 0 {
		t.Fatalf("no user row available (id=%d): %v", userID, err)
	}
	var usedBefore int64
	if err := db.Table("users").Where("id = ?", userID).Select("used_bytes").Row().Scan(&usedBefore); err != nil {
		t.Fatalf("read used_bytes: %v", err)
	}

	content := fmt.Sprintf("redline-bytes-%s\n", randomSha(t))
	size := int64(len(content))
	sha := shaHex(content)
	blobKey := BlobObjectKey(sha)
	t.Cleanup(func() {
		if err := db.Exec("DELETE FROM files WHERE sha256 = ?", sha).Error; err != nil {
			t.Errorf("cleanup files: %v", err)
		}
		cleanupBlob(t, db, sha)
		if err := db.Table("users").Where("id = ?", userID).
			UpdateColumn("used_bytes", gorm.Expr("GREATEST(CAST(used_bytes AS SIGNED) - ?, 0)", 2*size)).Error; err != nil {
			t.Errorf("restore quota: %v", err)
		}
	})

	svc := NewService(store, repo, instantRootFolders{owner: userID})

	// Two dedup uploads of identical bytes → two rows, refcount 2, ONE blob.
	first, err := svc.Upload(ctx, uploadInput(userID, "twin-a.txt", "text/plain", content))
	if err != nil {
		t.Fatalf("upload a: %v", err)
	}
	second, err := svc.Upload(ctx, uploadInput(userID, "twin-b.txt", "text/plain", content))
	if err != nil {
		t.Fatalf("upload b: %v", err)
	}
	if obj, err := repo.FindBlob(ctx, sha); err != nil || obj.Refcount != 2 {
		t.Fatalf("seed blob = (%+v, %v), want refcount 2", obj, err)
	}

	// Trash then permanently delete A only.
	if err := svc.Delete(ctx, userID, first.ID); err != nil {
		t.Fatalf("soft delete a: %v", err)
	}
	deletesBefore := len(store.deleteKeys)
	if err := svc.PermanentDelete(ctx, userID, first.ID); err != nil {
		t.Fatalf("permanent delete a: %v", err)
	}

	// RED LINE half one: the delete issued ZERO storage calls for a dedup row
	// (only the upload tmps may have been deleted so far — nothing new here).
	if len(store.deleteKeys) != deletesBefore {
		t.Errorf("permanent delete touched storage: %v", store.deleteKeys[deletesBefore:])
	}
	for _, key := range store.deleteKeys {
		if key == blobKey {
			t.Fatalf("THE blob was physically deleted — twin download would now be data loss")
		}
	}

	// refcount 2→1, row gone, twin row still counted.
	obj, err := repo.FindBlob(ctx, sha)
	if err != nil || obj.Refcount != 1 {
		t.Fatalf("blob after one release = (%+v, %v), want refcount 1", obj, err)
	}
	if n := filesCountForSha(t, db, sha); n != 1 {
		t.Fatalf("files rows for sha = %d, want 1", n)
	}

	// RED LINE half two: B downloads the shared blob, bytes intact.
	result, err := svc.Download(ctx, userID, second.ID)
	if err != nil {
		t.Fatalf("twin download: %v", err)
	}
	defer result.Reader.Close()
	if !strings.HasSuffix(result.OriginalName, ".txt") {
		t.Errorf("download name = %q", result.OriginalName)
	}
	if got := readAll(t, result); got != content {
		t.Fatalf("twin bytes diverged: %q", got)
	}

	// Quota: both uploads charged 2×size; deleting A returns exactly one
	// row's charge, so the net against the snapshot is +size.
	var usedAfter int64
	if err := db.Table("users").Where("id = ?", userID).Select("used_bytes").Row().Scan(&usedAfter); err != nil {
		t.Fatalf("read used_bytes after: %v", err)
	}
	if usedAfter-usedBefore != size {
		t.Errorf("used delta = %d, want %d (2 charged, 1 released)", usedAfter-usedBefore, size)
	}

	// Now delete B too: refcount 1→0 deletes ONLY the objects row; the blob
	// bytes must still be there for the GC window (§1.4).
	if err := svc.Delete(ctx, userID, second.ID); err != nil {
		t.Fatalf("soft delete b: %v", err)
	}
	if err := svc.PermanentDelete(ctx, userID, second.ID); err != nil {
		t.Fatalf("permanent delete b: %v", err)
	}
	if _, err := repo.FindBlob(ctx, sha); !errors.Is(err, ErrBlobNotFound) {
		t.Errorf("objects row after zero release = %v, want ErrBlobNotFound", err)
	}
	if store.objects[blobKey] != content {
		t.Errorf("blob bytes lost before GC — PermanentDelete must never delete physical dedup data")
	}
	for _, key := range store.deleteKeys {
		if key == blobKey {
			t.Fatal("zero-refcount path physically deleted the blob (delayed GC contract broken)")
		}
	}
	if n := filesCountForSha(t, db, sha); n != 0 {
		t.Errorf("files rows after both deletes = %d, want 0", n)
	}
}

func TestPermanentDeleteVersusInstantSameSha(t *testing.T) {
	db, repo := integrationDB(t)
	ctx := context.Background()
	store := &dedupStorageFake{}

	var userID uint64
	if err := db.Table("users").Select("id").Limit(1).Scan(&userID).Error; err != nil || userID == 0 {
		t.Fatalf("no user row available (id=%d): %v", userID, err)
	}
	var usedBefore int64
	if err := db.Table("users").Where("id = ?", userID).Select("used_bytes").Row().Scan(&usedBefore); err != nil {
		t.Fatalf("read used_bytes: %v", err)
	}

	content := fmt.Sprintf("race-bytes-%s\n", randomSha(t))
	size := int64(len(content))
	sha := shaHex(content)
	t.Cleanup(func() {
		if err := db.Exec("DELETE FROM files WHERE sha256 = ?", sha).Error; err != nil {
			t.Errorf("cleanup files: %v", err)
		}
		cleanupBlob(t, db, sha)
		if err := db.Table("users").Where("id = ?", userID).
			UpdateColumn("used_bytes", gorm.Expr("GREATEST(CAST(used_bytes AS SIGNED) - ?, 0)", 2*size)).Error; err != nil {
			t.Errorf("restore quota: %v", err)
		}
	})

	svc := NewService(store, repo, instantRootFolders{owner: userID})
	var trashed []uint64
	for i := 0; i < 2; i++ {
		created, err := svc.Upload(ctx, uploadInput(userID, fmt.Sprintf("race-%d.txt", i), "text/plain", content))
		if err != nil {
			t.Fatalf("seed upload %d: %v", i, err)
		}
		if err := svc.Delete(ctx, userID, created.ID); err != nil {
			t.Fatalf("seed trash %d: %v", i, err)
		}
		trashed = append(trashed, created.ID)
	}

	// Two permanent deletes racing three instant links on ONE sha — the
	// §1.4/contract-1 deadlock shape (release-vs-adopt on the same PK row).
	const deleters, linkers = 2, 3
	start := make(chan struct{})
	var wg sync.WaitGroup
	var mu sync.Mutex
	var failures []string
	var instantRows, instantMisses int

	for i := 0; i < deleters; i++ {
		fileID := trashed[i]
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			// A committed delete must succeed outright: the row provably
			// exists, so anything but nil (including exhaustion → busy) is a
			// failure of the retry contract.
			if err := svc.PermanentDelete(ctx, userID, fileID); err != nil {
				mu.Lock()
				failures = append(failures, fmt.Sprintf("delete %d: %v", fileID, err))
				mu.Unlock()
			}
		}()
	}
	for i := 0; i < linkers; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			<-start
			_, err := svc.InstantUpload(ctx, InstantInput{
				OwnerID:      userID,
				Sha256:       sha,
				OriginalName: fmt.Sprintf("instant-%d.txt", n),
				ContentType:  "text/plain",
			})
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				instantRows++
			case errors.Is(err, ErrBlobNotFound):
				// Legitimate: the blob was retired (and swept past the probe)
				// before this link committed. NOT a contract failure.
				instantMisses++
			default:
				failures = append(failures, fmt.Sprintf("instant %d: %v", n, err))
			}
		}(i)
	}
	close(start)
	wg.Wait()

	if len(failures) != 0 {
		t.Fatalf("interleave failures (deadlocks must self-heal): %v", failures)
	}
	t.Logf("interleave: instantRows=%d instantMisses=%d", instantRows, instantMisses)

	// Final invariant (spec §4): objects row exists ⟺ live files rows > 0,
	// and refcount == rows count (active + trashed; both seed rows were
	// hard-deleted, only instant rows remain).
	live := filesCountForSha(t, db, sha)
	if want := int64(instantRows); live != want {
		t.Fatalf("files rows = %d, want %d", live, want)
	}
	obj, err := repo.FindBlob(ctx, sha)
	if live == 0 {
		if !errors.Is(err, ErrBlobNotFound) {
			t.Fatalf("objects row survived with zero files rows: %+v %v", obj, err)
		}
	} else {
		if err != nil {
			t.Fatalf("FindBlob after race: %v", err)
		}
		if int64(obj.Refcount) != live {
			t.Fatalf("refcount = %d, want %d (lost bookkeeping under interleave)", obj.Refcount, live)
		}
	}
	// Whatever survived is intact: the shared blob was never physically
	// deleted, so a survivor row still streams real bytes.
	for _, key := range store.deleteKeys {
		if key == BlobObjectKey(sha) {
			t.Fatal("blob deleted under the delete-vs-instant race")
		}
	}
	var blobRows int64
	if err := db.Table("objects").Where("sha256 = ?", sha).Count(&blobRows).Error; err != nil {
		t.Fatalf("count objects: %v", err)
	}
	if blobRows > 0 && store.objects[BlobObjectKey(sha)] != content {
		t.Fatal("objects row alive but blob bytes lost")
	}
}

func readAll(t *testing.T, dl *DownloadResult) string {
	t.Helper()
	data, err := io.ReadAll(dl.Reader)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	return string(data)
}
