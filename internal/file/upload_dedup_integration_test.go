//go:build integration

// Live-MySQL companion to B4 (task gate: "two uploads same bytes → 1 objects
// row refcount 2"): drives the REAL service.Upload path — tee hash, tmp key,
// copy-before-tx, DedupCreate transaction — with the in-memory storage fake
// against the dev database (migrations 000007/000008 applied). The unit fakes
// already pin the call matrix; this proves the SQL side: refcount accounting,
// reservation convert against a live users row, and files rows sharing
// blobs/<sha> (uk_files_object_key is gone — B1 migration).
//
//	MYSQL_DSN=... go test -tags integration ./internal/file/
package file

import (
	"context"
	"fmt"
	"testing"
)

func TestUploadDedupPlacementOnMySQL(t *testing.T) {
	db, repo := integrationDB(t)
	ctx := context.Background()
	store := &dedupStorageFake{}

	var userID uint64
	if err := db.Table("users").Select("id").Limit(1).Scan(&userID).Error; err != nil || userID == 0 {
		t.Fatalf("no user row available for dedup integration test (id=%d): %v", userID, err)
	}
	var usedBefore, reservedBefore int64
	if err := db.Table("users").Where("id = ?", userID).
		Select("used_bytes, reserved_bytes").Row().Scan(&usedBefore, &reservedBefore); err != nil {
		t.Fatalf("read user quota: %v", err)
	}

	// Fresh random content per run: unique sha, never collides with leftovers.
	content := fmt.Sprintf("dedup-live-bytes-%s\n", randomSha(t))
	size := int64(len(content))
	sha := shaHex(content)
	blobKey := BlobObjectKey(sha)
	t.Cleanup(func() {
		if err := db.Exec("DELETE FROM files WHERE owner_id = ? AND sha256 = ?", userID, sha).Error; err != nil {
			t.Errorf("cleanup files: %v", err)
		}
		cleanupBlob(t, db, sha)
		if err := db.Exec("UPDATE users SET used_bytes = ? WHERE id = ?", usedBefore, userID).Error; err != nil {
			t.Errorf("restore used_bytes: %v", err)
		}
	})

	svc := NewService(store, repo, instantRootFolders{owner: userID})
	for i := 0; i < 2; i++ {
		created, err := svc.Upload(ctx, uploadInput(userID, fmt.Sprintf("dup-%d.txt", i), "text/plain", content))
		if err != nil {
			t.Fatalf("upload %d: %v", i, err)
		}
		if created.ObjectKey != blobKey || created.ETag != sha {
			t.Fatalf("upload %d row = %q/%q, want blob placement %q + sha etag", i, created.ObjectKey, created.ETag, blobKey)
		}
	}

	// ONE objects row, refcount 2, first uploader's content_type.
	obj, err := repo.FindBlob(ctx, sha)
	if err != nil {
		t.Fatalf("FindBlob after dedup: %v", err)
	}
	if obj.Refcount != 2 || obj.ObjectKey != blobKey || obj.ContentType != "text/plain" || obj.Size != size {
		t.Fatalf("objects row = %+v, want refcount 2 / key %s / text/plain / size %d", obj, blobKey, size)
	}
	var objectsRows int64
	if err := db.Table("objects").Where("sha256 = ?", sha).Count(&objectsRows).Error; err != nil {
		t.Fatalf("count objects: %v", err)
	}
	if objectsRows != 1 {
		t.Errorf("objects rows = %d, want 1", objectsRows)
	}

	// TWO files rows share the blob key (the UNIQUE(object_key) index is gone).
	var fileRows int64
	if err := db.Table("files").Where("owner_id = ? AND sha256 = ?", userID, sha).Count(&fileRows).Error; err != nil {
		t.Fatalf("count files: %v", err)
	}
	if fileRows != 2 {
		t.Errorf("files rows = %d, want 2", fileRows)
	}

	// Quota: both uploads charged used_bytes, reservations fully converted.
	var usedAfter, reservedAfter int64
	if err := db.Table("users").Where("id = ?", userID).
		Select("used_bytes, reserved_bytes").Row().Scan(&usedAfter, &reservedAfter); err != nil {
		t.Fatalf("read user quota after: %v", err)
	}
	if usedAfter-usedBefore != 2*size {
		t.Errorf("used delta = %d, want %d (dedup saves storage, not quota)", usedAfter-usedBefore, 2*size)
	}
	if reservedAfter != reservedBefore {
		t.Errorf("reserved = %d, want %d (both reservations converted)", reservedAfter, reservedBefore)
	}

	// Storage side effects: exactly two tmp Puts, two copies into the blob
	// key (copy-before-tx, hit included), every tmp deleted, blob bytes true.
	if len(store.putKeys) != 2 || len(store.copies) != 2 || len(store.deleteKeys) != 2 {
		t.Fatalf("IO = puts %d copies %d deletes %d, want 2/2/2", len(store.putKeys), len(store.copies), len(store.deleteKeys))
	}
	if store.objects[blobKey] != content {
		t.Errorf("blob bytes = %q, want the uploaded content", store.objects[blobKey])
	}
	for _, tmp := range store.putKeys {
		if _, leaked := store.objects[tmp]; leaked {
			t.Errorf("tmp %s survived the dedup success path", tmp)
		}
	}
}
