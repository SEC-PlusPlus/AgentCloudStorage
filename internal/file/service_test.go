package file

import (
	"PersonalCloudStorage/internal/storage"
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"gorm.io/gorm"
)

// cascadeRepositoryStub implements Repository for the share-cascade tests.
// HardDeleteWithQuota records the length of `extra` and executes every hook
// (with a nil tx) like the real transactional implementation would.
type cascadeRepositoryStub struct {
	deleted         *File
	deletedErr      error
	active          *File
	activeErr       error
	getByIDCalls    int
	hardDeleteCalls int
	extraLens       []int
	hardDeleteErr   error

	// B5 dedup-delete fork knobs. HardDeleteWithBlobRelease mirrors
	// HardDeleteWithQuota's hook execution (nil tx, extra after the "row
	// delete"), plus strict per-attempt error semantics like instantCreateErrs:
	// errors[i] = attempt i+1's failure; attempt len+1 succeeds. onHardDelete
	// lets the legacy-path test observe whether the object delete already
	// happened when the row transaction runs.
	dedupHardDeleteCalls int
	dedupHardDeleteErrs  []error
	lastDedupSha         string
	dedupExtraLens       []int
	onHardDelete         func()

	// Instant-upload knobs (B3): FindBlob answers findBlobObj when set, else
	// the default miss sentinel stays live so every pre-B3 cascade test keeps
	// compiling and passing unchanged. instantCreateErrs has STRICT length
	// semantics: len == how many attempts fail (errors[i] = attempt i+1's
	// failure, may itself be nil); attempt len+1 succeeds — with
	// instantCreateFile when set, else derived from findBlobObj via the
	// production mapper (newInstantFile), mirroring the real gorm tx.
	findBlobObj        *Object
	findBlobErr        error
	instantCreateCalls int
	instantCreateErrs  []error
	instantCreateFile  *File
	lastInstantInput   InstantInput
}

var _ Repository = (*cascadeRepositoryStub)(nil)

func (r *cascadeRepositoryStub) Create(context.Context, *File) error {
	return errors.New("unexpected Create call")
}

func (r *cascadeRepositoryStub) ListByStatus(context.Context, uint64, Status, int, int) ([]File, int64, error) {
	return nil, 0, errors.New("unexpected ListByStatus call")
}

func (r *cascadeRepositoryStub) GetByID(context.Context, uint64, uint64) (*File, error) {
	r.getByIDCalls++
	if r.activeErr != nil {
		return nil, r.activeErr
	}
	if r.active == nil {
		return nil, ErrFileNotFound
	}
	return r.active, nil
}

func (r *cascadeRepositoryStub) SoftDelete(context.Context, uint64, uint64) error {
	return errors.New("unexpected SoftDelete call")
}

func (r *cascadeRepositoryStub) Restore(context.Context, uint64, uint64) error {
	return errors.New("unexpected Restore call")
}

func (r *cascadeRepositoryStub) GetDeletedByID(context.Context, uint64, uint64) (*File, error) {
	if r.deletedErr != nil {
		return nil, r.deletedErr
	}
	if r.deleted == nil {
		return nil, ErrFileNotFound
	}
	return r.deleted, nil
}

func (r *cascadeRepositoryStub) HardDeleteWithQuota(
	_ context.Context,
	_ uint64,
	_ uint64,
	extra ...func(tx *gorm.DB) error,
) error {
	r.hardDeleteCalls++
	r.extraLens = append(r.extraLens, len(extra))
	if r.onHardDelete != nil {
		r.onHardDelete()
	}
	if r.hardDeleteErr != nil {
		return r.hardDeleteErr
	}
	for _, hook := range extra {
		if err := hook(nil); err != nil {
			return err
		}
	}
	return nil
}

// HardDeleteWithBlobRelease is the B5 dedup-path twin of HardDeleteWithQuota:
// the stub runs it with the blob release already folded into the (imaginary)
// transaction and only executes the extra hooks.
func (r *cascadeRepositoryStub) HardDeleteWithBlobRelease(
	_ context.Context,
	_ uint64,
	_ uint64,
	sha256 string,
	extra ...func(tx *gorm.DB) error,
) error {
	r.dedupHardDeleteCalls++
	r.lastDedupSha = sha256
	r.dedupExtraLens = append(r.dedupExtraLens, len(extra))
	if r.dedupHardDeleteCalls <= len(r.dedupHardDeleteErrs) {
		if err := r.dedupHardDeleteErrs[r.dedupHardDeleteCalls-1]; err != nil {
			return err
		}
	}
	for _, hook := range extra {
		if err := hook(nil); err != nil {
			return err
		}
	}
	return nil
}

func (r *cascadeRepositoryStub) ListByFolderAndStatus(context.Context, uint64, uint64, Status, int, int) ([]File, int64, error) {
	return nil, 0, errors.New("unexpected ListByFolderAndStatus call")
}

func (r *cascadeRepositoryStub) Move(context.Context, uint64, uint64, uint64) error {
	return errors.New("unexpected Move call")
}

func (r *cascadeRepositoryStub) Rename(context.Context, uint64, uint64, string) error {
	return errors.New("unexpected Rename call")
}

func (r *cascadeRepositoryStub) HasFilesInFolder(context.Context, uint64, uint64) (bool, error) {
	return false, errors.New("unexpected HasFilesInFolder call")
}

func (r *cascadeRepositoryStub) SearchByName(context.Context, uint64, string, int, int) ([]File, int64, error) {
	return nil, 0, errors.New("unexpected SearchByName call")
}

func (r *cascadeRepositoryStub) UsedBytes(context.Context, uint64) (int64, error) {
	return 0, errors.New("unexpected UsedBytes call")
}

func (r *cascadeRepositoryStub) QuotaBytes(context.Context, uint64) (int64, error) {
	return 0, errors.New("unexpected QuotaBytes call")
}

func (r *cascadeRepositoryStub) ReserveQuota(context.Context, uint64, int64) error {
	return errors.New("unexpected ReserveQuota call")
}

func (r *cascadeRepositoryStub) ReleaseQuota(context.Context, uint64, int64) error {
	return errors.New("unexpected ReleaseQuota call")
}

func (r *cascadeRepositoryStub) FindBlob(_ context.Context, _ string) (*Object, error) {
	if r.findBlobErr != nil {
		return nil, r.findBlobErr
	}
	if r.findBlobObj == nil {
		return nil, ErrBlobNotFound
	}
	return r.findBlobObj, nil
}

func (r *cascadeRepositoryStub) InstantCreate(_ context.Context, ownerID uint64, in InstantInput) (*File, error) {
	r.instantCreateCalls++
	r.lastInstantInput = in
	if r.instantCreateCalls <= len(r.instantCreateErrs) {
		if err := r.instantCreateErrs[r.instantCreateCalls-1]; err != nil {
			return nil, err
		}
	}
	if r.instantCreateFile != nil {
		return r.instantCreateFile, nil
	}
	if r.findBlobObj == nil {
		return nil, ErrBlobNotFound
	}
	return newInstantFile(ownerID, in, r.findBlobObj), nil
}

func (r *cascadeRepositoryStub) AcquireBlob(*gorm.DB, string, string, int64) (*Object, bool, error) {
	return nil, false, errors.New("unexpected AcquireBlob call")
}

func (r *cascadeRepositoryStub) DedupCreate(context.Context, DedupCreateInput) (*File, error) {
	return nil, errors.New("unexpected DedupCreate call")
}

func (r *cascadeRepositoryStub) ReleaseBlob(*gorm.DB, string) (string, bool, error) {
	return "", false, errors.New("unexpected ReleaseBlob call")
}

// cascadeStorageStub honors Get/Delete/Copy; Put/Stat fail loudly.
type cascadeStorageStub struct {
	content     map[string]string
	deleteKeys  []string
	getKeys     []string
	deleteErr   error
	getErr      error
	contentType string
}

var _ storage.ObjectStorage = (*cascadeStorageStub)(nil)

func (s *cascadeStorageStub) Put(context.Context, string, io.Reader, int64, string) (storage.ObjectInfo, error) {
	return storage.ObjectInfo{}, errors.New("unexpected Put call")
}

func (s *cascadeStorageStub) Get(_ context.Context, key string) (io.ReadCloser, storage.ObjectInfo, error) {
	s.getKeys = append(s.getKeys, key)
	if s.getErr != nil {
		return nil, storage.ObjectInfo{}, s.getErr
	}
	body, ok := s.content[key]
	if !ok {
		return nil, storage.ObjectInfo{}, errors.New("object missing")
	}
	return io.NopCloser(strings.NewReader(body)), storage.ObjectInfo{
		Key: key, Size: int64(len(body)), ContentType: s.contentType,
	}, nil
}

func (s *cascadeStorageStub) Stat(context.Context, string) (storage.ObjectInfo, error) {
	return storage.ObjectInfo{}, errors.New("unexpected Stat call")
}

func (s *cascadeStorageStub) Delete(_ context.Context, key string) error {
	s.deleteKeys = append(s.deleteKeys, key)
	return s.deleteErr
}

// Copy mirrors Get's lookup: missing src returns the same "object missing"
// error, and dst is a value copy of the stored string (Go strings are
// immutable, so dst never shares mutable state with src). Size/ContentType
// need no bookkeeping — Get(dst) derives them from the stored bytes.
func (s *cascadeStorageStub) Copy(_ context.Context, srcKey, dstKey string) error {
	body, ok := s.content[srcKey]
	if !ok {
		return errors.New("object missing")
	}
	s.content[dstKey] = body
	return nil
}

// List completes the ObjectStorage interface (B5, cmd/blob-gc). The cascade
// tests never enumerate, so it fails loudly like Put/Stat.
func (s *cascadeStorageStub) List(context.Context, string) ([]storage.ObjectInfo, error) {
	return nil, errors.New("unexpected List call")
}

// recordingPurger captures the fileIDs handed to the share cascade hook.
type recordingPurger struct {
	calls []uint64
	err   error
}

var _ SharePurger = (*recordingPurger)(nil)

func (p *recordingPurger) PurgeByFileTx(_ *gorm.DB, fileID uint64) error {
	p.calls = append(p.calls, fileID)
	return p.err
}

func TestPermanentDeleteRunsSharePurgerHook(t *testing.T) {
	repo := &cascadeRepositoryStub{deleted: &File{ID: 42, OwnerID: 7, ObjectKey: "users/7/blob-42", Size: 10}}
	store := &cascadeStorageStub{}
	purger := &recordingPurger{}

	svc := NewService(store, repo, nil)
	svc.SetSharePurger(purger)

	if err := svc.PermanentDelete(context.Background(), 7, 42); err != nil {
		t.Fatalf("PermanentDelete: %v", err)
	}
	if len(repo.extraLens) != 1 || repo.extraLens[0] != 1 {
		t.Fatalf("HardDeleteWithQuota extra counts = %v, want [1]", repo.extraLens)
	}
	if len(purger.calls) != 1 || purger.calls[0] != 42 {
		t.Errorf("purger calls = %v, want [42]", purger.calls)
	}
	if len(store.deleteKeys) != 1 || store.deleteKeys[0] != "users/7/blob-42" {
		t.Errorf("storage deletes = %v, want [users/7/blob-42]", store.deleteKeys)
	}
}

func TestPermanentDeleteWithoutPurgerKeepsNoHooks(t *testing.T) {
	repo := &cascadeRepositoryStub{deleted: &File{ID: 42, OwnerID: 7, ObjectKey: "users/7/blob-42", Size: 10}}
	store := &cascadeStorageStub{}

	svc := NewService(store, repo, nil)
	if err := svc.PermanentDelete(context.Background(), 7, 42); err != nil {
		t.Fatalf("PermanentDelete: %v", err)
	}
	if len(repo.extraLens) != 1 || repo.extraLens[0] != 0 {
		t.Errorf("no-purger extra counts = %v, want [0]", repo.extraLens)
	}
}

func TestPermanentDeletePurgerErrorPropagates(t *testing.T) {
	purgerErr := errors.New("purge boom")
	repo := &cascadeRepositoryStub{deleted: &File{ID: 42, OwnerID: 7, ObjectKey: "users/7/blob-42", Size: 10}}
	svc := NewService(&cascadeStorageStub{}, repo, nil)
	svc.SetSharePurger(&recordingPurger{err: purgerErr})

	err := svc.PermanentDelete(context.Background(), 7, 42)
	if !errors.Is(err, purgerErr) {
		t.Fatalf("PermanentDelete error = %v, want wrapping %v", err, purgerErr)
	}
}

func TestGetActiveFileAnswersLookupContract(t *testing.T) {
	active := &File{ID: 42, OwnerID: 7, Status: StatusActive}
	repo := &cascadeRepositoryStub{active: active}
	svc := NewService(nil, repo, nil)

	got, err := svc.GetActiveFile(context.Background(), 7, 42)
	if err != nil {
		t.Fatalf("GetActiveFile: %v", err)
	}
	if got != active {
		t.Errorf("record = %+v, want %+v", got, active)
	}

	// 404 face passes through unwrapped-sentinel-wise (repo already answers ErrFileNotFound).
	missing := &cascadeRepositoryStub{}
	svc = NewService(nil, missing, nil)
	if _, err := svc.GetActiveFile(context.Background(), 7, 99); !errors.Is(err, ErrFileNotFound) {
		t.Errorf("missing file error = %v, want ErrFileNotFound", err)
	}
	if _, err := svc.GetActiveFile(context.Background(), 0, 42); !errors.Is(err, ErrFileNotFound) {
		t.Errorf("zero owner error = %v, want ErrFileNotFound", err)
	}
	if _, err := svc.GetActiveFile(context.Background(), 7, 0); !errors.Is(err, ErrFileNotFound) {
		t.Errorf("zero file error = %v, want ErrFileNotFound", err)
	}
	if missing.getByIDCalls != 1 {
		t.Errorf("zero-id guards must not hit the repo, calls = %d", missing.getByIDCalls)
	}

	boom := &cascadeRepositoryStub{activeErr: errors.New("db down")}
	svc = NewService(nil, boom, nil)
	if _, err := svc.GetActiveFile(context.Background(), 7, 42); errors.Is(err, ErrFileNotFound) {
		t.Errorf("database failure must not wear the 404 face: %v", err)
	}
}

func TestDownloadByKeySkipsOwnerChecks(t *testing.T) {
	repo := &cascadeRepositoryStub{}
	store := &cascadeStorageStub{
		content:     map[string]string{"users/9/foreign": "shared-bytes"},
		contentType: "text/plain",
	}
	svc := NewService(store, repo, nil)

	result, err := svc.DownloadByKey(context.Background(), "users/9/foreign")
	if err != nil {
		t.Fatalf("DownloadByKey: %v", err)
	}
	defer result.Reader.Close()
	body, err := io.ReadAll(result.Reader)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(body) != "shared-bytes" {
		t.Errorf("body = %q, want shared-bytes", body)
	}
	if result.Size != 12 || result.ContentType != "text/plain" {
		t.Errorf("meta = %+v, want size 12 / text/plain", result)
	}
	if repo.getByIDCalls != 0 {
		t.Errorf("DownloadByKey must not consult ownership, repo calls = %d", repo.getByIDCalls)
	}
	if len(store.getKeys) != 1 || store.getKeys[0] != "users/9/foreign" {
		t.Errorf("storage keys = %v", store.getKeys)
	}

	if _, err := svc.DownloadByKey(context.Background(), " "); err == nil {
		t.Error("empty key must fail before touching storage")
	}

	store.getErr = errors.New("minio down")
	if _, err := svc.DownloadByKey(context.Background(), "users/9/foreign"); err == nil {
		t.Error("storage failure must surface")
	}
}

// TestStorageStubCopyContract pins the ObjectStorage.Copy in-memory contract
// every fake must honor: copy existing key serves identical bytes at dst,
// mutating src afterwards does not change dst (deep copy), and copying a
// missing src fails with the fake's not-found error.
func TestStorageStubCopyContract(t *testing.T) {
	store := &cascadeStorageStub{
		content:     map[string]string{"users/1/tmp-abc": "hello-bytes"},
		contentType: "application/octet-stream",
	}

	if err := store.Copy(context.Background(), "users/1/tmp-abc", "blobs/sha256-deadbeef"); err != nil {
		t.Fatalf("Copy: %v", err)
	}

	body, info, err := store.Get(context.Background(), "blobs/sha256-deadbeef")
	if err != nil {
		t.Fatalf("Get(dst): %v", err)
	}
	got, readErr := io.ReadAll(body)
	_ = body.Close()
	if readErr != nil {
		t.Fatalf("ReadAll(dst): %v", readErr)
	}
	if string(got) != "hello-bytes" {
		t.Fatalf("dst bytes = %q, want %q", got, "hello-bytes")
	}
	if info.Size != int64(len("hello-bytes")) || info.ContentType != "application/octet-stream" {
		t.Fatalf("dst info = %+v, want size %d / octet-stream", info, len("hello-bytes"))
	}

	// Deep copy: later mutation of the source must not be visible at dst.
	store.content["users/1/tmp-abc"] = "mutated"
	body2, _, err2 := store.Get(context.Background(), "blobs/sha256-deadbeef")
	if err2 != nil {
		t.Fatalf("Get(dst) after src mutation: %v", err2)
	}
	got2, readErr2 := io.ReadAll(body2)
	_ = body2.Close()
	if readErr2 != nil {
		t.Fatalf("ReadAll(dst) after src mutation: %v", readErr2)
	}
	if string(got2) != "hello-bytes" {
		t.Fatalf("dst bytes after src mutation = %q, want unchanged %q", got2, "hello-bytes")
	}

	// Missing src → error, mirroring Get's not-found style.
	if err := store.Copy(context.Background(), "users/1/missing", "blobs/x"); err == nil {
		t.Fatal("Copy(missing src) = nil, want error")
	}
}
