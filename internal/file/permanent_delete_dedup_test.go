package file

import (
	"context"
	"errors"
	"testing"
)

// ---------------------------------------------------------------------------
// B5 PermanentDelete fork (spec §1.3 delete row / §1.4 delayed GC).
//
// THE RED LINE: for a dedup row (files.sha256 IS NOT NULL) the delete must be
// pure logic — refcount release + quota + row removal in ONE objects-first
// transaction — and must NEVER call storage.Delete, neither inside nor after
// the transaction. The blob's physical fate belongs to cmd/blob-gc. Legacy
// rows (sha NULL) keep the pre-B5 order verbatim: object first, then the
// row/quota transaction.
// ---------------------------------------------------------------------------

func TestPermanentDeleteDedupRowNeverTouchesStorage(t *testing.T) {
	sha := sha64a
	repo := &cascadeRepositoryStub{deleted: &File{
		ID: 42, OwnerID: 7, ObjectKey: BlobObjectKey(sha), Sha256: &sha, Size: 10,
	}}
	store := &dedupStorageFake{objects: map[string]string{BlobObjectKey(sha): "shared-bytes"}}

	svc := NewService(store, repo, nil)
	if err := svc.PermanentDelete(context.Background(), 7, 42); err != nil {
		t.Fatalf("PermanentDelete dedup row: %v", err)
	}

	if repo.dedupHardDeleteCalls != 1 || repo.lastDedupSha != sha {
		t.Errorf("dedup tx calls = %d (sha %q), want 1 (%q)", repo.dedupHardDeleteCalls, repo.lastDedupSha, sha)
	}
	if repo.hardDeleteCalls != 0 {
		t.Errorf("legacy HardDeleteWithQuota called %d times for a dedup row, want 0", repo.hardDeleteCalls)
	}
	// storage.Delete count = 0 — the deliverable-A assertion, ever.
	if len(store.deleteKeys) != 0 {
		t.Errorf("storage deletes = %v, want NONE for a dedup row", store.deleteKeys)
	}
	if _, ok := store.objects[BlobObjectKey(sha)]; !ok {
		t.Error("blob bytes gone — PermanentDelete must leave the physical object to cmd/blob-gc")
	}
}

func TestPermanentDeleteDedupRowRunsSharePurgerHook(t *testing.T) {
	sha := sha64a
	repo := &cascadeRepositoryStub{deleted: &File{
		ID: 42, OwnerID: 7, ObjectKey: BlobObjectKey(sha), Sha256: &sha, Size: 10,
	}}
	purger := &recordingPurger{}
	store := &dedupStorageFake{objects: map[string]string{BlobObjectKey(sha): "shared-bytes"}}

	svc := NewService(store, repo, nil)
	svc.SetSharePurger(purger)
	if err := svc.PermanentDelete(context.Background(), 7, 42); err != nil {
		t.Fatalf("PermanentDelete: %v", err)
	}
	if len(repo.dedupExtraLens) != 1 || repo.dedupExtraLens[0] != 1 {
		t.Errorf("dedup tx extra counts = %v, want [1]", repo.dedupExtraLens)
	}
	if len(purger.calls) != 1 || purger.calls[0] != 42 {
		t.Errorf("purger calls = %v, want [42]", purger.calls)
	}
	if len(store.deleteKeys) != 0 {
		t.Errorf("storage deletes = %v, want NONE", store.deleteKeys)
	}
}

func TestPermanentDeleteDedupPurgerErrorPropagates(t *testing.T) {
	purgerErr := errors.New("purge boom")
	sha := sha64a
	repo := &cascadeRepositoryStub{deleted: &File{
		ID: 42, OwnerID: 7, ObjectKey: BlobObjectKey(sha), Sha256: &sha, Size: 10,
	}}
	svc := NewService(&dedupStorageFake{}, repo, nil)
	svc.SetSharePurger(&recordingPurger{err: purgerErr})

	err := svc.PermanentDelete(context.Background(), 7, 42)
	if !errors.Is(err, purgerErr) {
		t.Fatalf("PermanentDelete error = %v, want wrapping %v", err, purgerErr)
	}
}

func TestPermanentDeleteLegacyPathUnchanged(t *testing.T) {
	repo := &cascadeRepositoryStub{deleted: &File{ID: 43, OwnerID: 7, ObjectKey: "users/7/legacy-43", Size: 10}}
	store := &dedupStorageFake{objects: map[string]string{"users/7/legacy-43": "old-bytes"}}

	// Order probe: today the object goes FIRST, the row transaction after —
	// the legacy branch must still look exactly like that (contract 2: no
	// unrelated diffs on the sha==nil path).
	orderSeen := ""
	repo.onHardDelete = func() {
		if len(store.deleteKeys) == 1 {
			orderSeen = "object-then-row"
		} else {
			orderSeen = "row-before-object"
		}
	}

	svc := NewService(store, repo, nil)
	if err := svc.PermanentDelete(context.Background(), 7, 43); err != nil {
		t.Fatalf("PermanentDelete legacy row: %v", err)
	}
	if orderSeen != "object-then-row" {
		t.Errorf("legacy order = %q, want object-then-row", orderSeen)
	}
	if len(store.deleteKeys) != 1 || store.deleteKeys[0] != "users/7/legacy-43" {
		t.Errorf("storage deletes = %v, want [users/7/legacy-43]", store.deleteKeys)
	}
	if repo.hardDeleteCalls != 1 {
		t.Errorf("HardDeleteWithQuota calls = %d, want 1", repo.hardDeleteCalls)
	}
	if repo.dedupHardDeleteCalls != 0 {
		t.Errorf("dedup tx called %d times for a sha==nil row, want 0", repo.dedupHardDeleteCalls)
	}
}

func TestPermanentDeleteDedupRetriesLockContention(t *testing.T) {
	sha := sha64a
	repo := &cascadeRepositoryStub{
		deleted:             &File{ID: 42, OwnerID: 7, ObjectKey: BlobObjectKey(sha), Sha256: &sha, Size: 10},
		dedupHardDeleteErrs: []error{mysqlErr(1213), mysqlErr(1205), nil},
	}
	store := &dedupStorageFake{objects: map[string]string{BlobObjectKey(sha): "shared-bytes"}}

	svc := NewService(store, repo, nil)
	if err := svc.PermanentDelete(context.Background(), 7, 42); err != nil {
		t.Fatalf("PermanentDelete after 1213+1205 retries: %v", err)
	}
	if repo.dedupHardDeleteCalls != 3 {
		t.Errorf("dedup tx attempts = %d, want 3", repo.dedupHardDeleteCalls)
	}
	if len(store.deleteKeys) != 0 {
		t.Errorf("storage deletes = %v, want NONE even on retry paths", store.deleteKeys)
	}
}

func TestPermanentDeleteDedupContentionExhaustionAnswersBlobBusy(t *testing.T) {
	sha := sha64a
	repo := &cascadeRepositoryStub{
		deleted:             &File{ID: 42, OwnerID: 7, ObjectKey: BlobObjectKey(sha), Sha256: &sha, Size: 10},
		dedupHardDeleteErrs: []error{mysqlErr(1213), mysqlErr(1213), mysqlErr(1205), mysqlErr(1213)},
	}

	svc := NewService(&dedupStorageFake{}, repo, nil)
	err := svc.PermanentDelete(context.Background(), 7, 42)
	if !errors.Is(err, ErrBlobBusy) {
		t.Fatalf("exhaustion error = %v, want wrapping ErrBlobBusy", err)
	}
	if repo.dedupHardDeleteCalls != blobTxMaxAttempts {
		t.Errorf("attempts = %d, want the shared budget %d", repo.dedupHardDeleteCalls, blobTxMaxAttempts)
	}
}

func TestPermanentDeleteDedupDeterministicErrorsSurface(t *testing.T) {
	sha := sha64a
	rowGone := &cascadeRepositoryStub{
		deleted:             &File{ID: 42, OwnerID: 7, ObjectKey: BlobObjectKey(sha), Sha256: &sha, Size: 10},
		dedupHardDeleteErrs: []error{ErrFileNotFound},
	}
	svc := NewService(&dedupStorageFake{}, rowGone, nil)
	if err := svc.PermanentDelete(context.Background(), 7, 42); !errors.Is(err, ErrFileNotFound) {
		t.Errorf("row-gone error = %v, want Is ErrFileNotFound (404 face, no retry)", err)
	}
	if rowGone.dedupHardDeleteCalls != 1 {
		t.Errorf("deterministic error retried %d times, want exactly 1", rowGone.dedupHardDeleteCalls)
	}

	dbBoom := &cascadeRepositoryStub{
		deleted:             &File{ID: 42, OwnerID: 7, ObjectKey: BlobObjectKey(sha), Sha256: &sha, Size: 10},
		dedupHardDeleteErrs: []error{errors.New("db down")},
	}
	svc = NewService(&dedupStorageFake{}, dbBoom, nil)
	if err := svc.PermanentDelete(context.Background(), 7, 42); errors.Is(err, ErrBlobBusy) {
		t.Errorf("database failure wears the retry face: %v", err)
	}
	if dbBoom.dedupHardDeleteCalls != 1 {
		t.Errorf("non-contention error retried %d times, want exactly 1", dbBoom.dedupHardDeleteCalls)
	}
}
