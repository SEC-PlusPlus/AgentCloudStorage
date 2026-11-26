package file

import (
	"PersonalCloudStorage/internal/folder"
	"PersonalCloudStorage/internal/storage"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// fakes (B4): a recording ObjectStorage + a stateful dedup tx fake that
// mirrors the GORM DedupCreate semantics (blob map = objects table, files
// slice = committed rows, quota counters = guarded users-row update).
// ---------------------------------------------------------------------------

type dedupStorageFake struct {
	objects         map[string]string
	putKeys         []string
	putContentTypes []string
	copies          [][2]string // {src, dst} — recorded even when the copy fails
	deleteKeys      []string
	putErr          error
	copyErr         error
}

var _ storage.ObjectStorage = (*dedupStorageFake)(nil)

func (f *dedupStorageFake) Put(_ context.Context, key string, src io.Reader, size int64, contentType string) (storage.ObjectInfo, error) {
	f.putKeys = append(f.putKeys, key)
	f.putContentTypes = append(f.putContentTypes, contentType)
	if f.putErr != nil {
		return storage.ObjectInfo{}, f.putErr
	}
	// MinIO with a fixed size hint reads EXACTLY that many stream bytes — the
	// tee hasher must see the same slice the object stores, so limit here too.
	var body []byte
	var err error
	if size >= 0 {
		body, err = io.ReadAll(io.LimitReader(src, size))
	} else {
		body, err = io.ReadAll(src)
	}
	if err != nil {
		return storage.ObjectInfo{}, err
	}
	if f.objects == nil {
		f.objects = map[string]string{}
	}
	f.objects[key] = string(body)
	return storage.ObjectInfo{Key: key, Size: int64(len(body)), ContentType: contentType, ETag: "fake-etag"}, nil
}

func (f *dedupStorageFake) Get(_ context.Context, key string) (io.ReadCloser, storage.ObjectInfo, error) {
	body, ok := f.objects[key]
	if !ok {
		return nil, storage.ObjectInfo{}, errors.New("object missing")
	}
	return io.NopCloser(strings.NewReader(body)), storage.ObjectInfo{Key: key, Size: int64(len(body))}, nil
}

func (f *dedupStorageFake) Stat(_ context.Context, key string) (storage.ObjectInfo, error) {
	body, ok := f.objects[key]
	if !ok {
		return storage.ObjectInfo{}, errors.New("object missing")
	}
	return storage.ObjectInfo{Key: key, Size: int64(len(body))}, nil
}

func (f *dedupStorageFake) Delete(_ context.Context, key string) error {
	f.deleteKeys = append(f.deleteKeys, key)
	delete(f.objects, key)
	return nil
}

func (f *dedupStorageFake) Copy(_ context.Context, srcKey, dstKey string) error {
	f.copies = append(f.copies, [2]string{srcKey, dstKey})
	if f.copyErr != nil {
		return f.copyErr
	}
	body, ok := f.objects[srcKey]
	if !ok {
		return errors.New("object missing")
	}
	if f.objects == nil {
		f.objects = map[string]string{}
	}
	f.objects[dstKey] = body
	return nil
}

// List serves the map sorted by key (B5: ObjectStorage grew List for
// cmd/blob-gc; LastModified is zero — the fake never needed ages, and the
// pure gcDecision is tested separately in cmd/blob-gc).
func (f *dedupStorageFake) List(_ context.Context, prefix string) ([]storage.ObjectInfo, error) {
	keys := make([]string, 0, len(f.objects))
	for key := range f.objects {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var out []storage.ObjectInfo
	for _, key := range keys {
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		out = append(out, storage.ObjectInfo{Key: key, Size: int64(len(f.objects[key]))})
	}
	return out, nil
}

type dedupRepoFake struct {
	*cascadeRepositoryStub

	blobs map[string]*Object // objects "table": sha -> committed row
	files []*File            // committed files rows

	dedupCalls    int
	dedupErrs     []error // strict per-attempt semantics, see cascadeRepositoryStub.instantCreateErrs
	lastDedup     DedupCreateInput
	lastWasCreate bool

	reserveCalls []int64 // declared sizes
	releaseCalls []int64
	reserveErr   error

	reserved int64
	used     int64
}

func newDedupRepoFake() *dedupRepoFake {
	return &dedupRepoFake{
		cascadeRepositoryStub: &cascadeRepositoryStub{},
		blobs:                 map[string]*Object{},
	}
}

var _ Repository = (*dedupRepoFake)(nil)

func (r *dedupRepoFake) ReserveQuota(_ context.Context, _ uint64, size int64) error {
	if r.reserveErr != nil {
		return r.reserveErr
	}
	r.reserveCalls = append(r.reserveCalls, size)
	r.reserved += size
	return nil
}

func (r *dedupRepoFake) ReleaseQuota(_ context.Context, _ uint64, size int64) error {
	r.releaseCalls = append(r.releaseCalls, size)
	r.reserved -= size
	return nil
}

// DedupCreate mirrors GORMRepository.DedupCreate: AcquireBlob semantics
// (created → insert with clamped content_type, hit → refcount+1 and the
// STORED row wins), guarded reservation→usage conversion, files row through
// the shared newInstantFile provenance mapper.
func (r *dedupRepoFake) DedupCreate(_ context.Context, in DedupCreateInput) (*File, error) {
	r.dedupCalls++
	r.lastDedup = in
	if r.dedupCalls <= len(r.dedupErrs) {
		if err := r.dedupErrs[r.dedupCalls-1]; err != nil {
			return nil, err
		}
	}
	if err := validateBlobSha256(in.Sha256); err != nil {
		return nil, err
	}
	if in.Size < 0 || in.ReservedSize < 0 || in.Size > in.ReservedSize {
		return nil, errors.New("invalid file size or reservation")
	}

	obj, exists := r.blobs[in.Sha256]
	r.lastWasCreate = !exists
	if exists {
		obj.Refcount++
	} else {
		obj = &Object{
			Sha256:      in.Sha256,
			ObjectKey:   BlobObjectKey(in.Sha256),
			ContentType: ClampContentType(in.ContentType),
			Size:        in.Size,
			Refcount:    1,
		}
		r.blobs[in.Sha256] = obj
	}

	if in.ReservedSize > 0 {
		r.reserved -= in.ReservedSize
		r.used += obj.Size
	}

	record := newInstantFile(in.OwnerID, InstantInput{
		Sha256:       in.Sha256,
		OriginalName: in.OriginalName,
		ContentType:  in.ContentType,
		FolderID:     in.FolderID,
	}, obj)
	record.ID = uint64(100 + len(r.files))
	r.files = append(r.files, record)
	return record, nil
}

type uploadFolders struct{ err error }

func (u uploadFolders) EnsureOwned(_ context.Context, ownerID uint64, folderID uint64) error {
	if ownerID == 0 {
		return errors.New("owner id is required")
	}
	if u.err != nil && folderID != 0 {
		return fmt.Errorf("ensure folder ownership: %w", u.err)
	}
	return nil
}

func shaHex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func uploadInput(owner uint64, name, ctype, content string) UploadInput {
	return UploadInput{
		OwnerID:      owner,
		FolderID:     0,
		OriginalName: name,
		ContentType:  ctype,
		Size:         int64(len(content)),
		Reader:       strings.NewReader(content),
	}
}

// ---------------------------------------------------------------------------
// happy path: tmp → copy-before-tx → blobs placement, one row per sha
// ---------------------------------------------------------------------------

func TestUploadDedupSecondUploadNoPutToBlob(t *testing.T) {
	store := &dedupStorageFake{}
	repo := newDedupRepoFake()
	svc := NewService(store, repo, uploadFolders{})

	content := "identical bytes, dedup me\n"
	first, err := svc.Upload(context.Background(), uploadInput(7, "a.txt", "text/plain", content))
	if err != nil {
		t.Fatalf("first upload: %v", err)
	}
	second, err := svc.Upload(context.Background(), uploadInput(7, "b.txt", "text/plain", content))
	if err != nil {
		t.Fatalf("second upload: %v", err)
	}

	// Bytes NEVER hit the blobs prefix through Put — only tmp keys, twice,
	// each a fresh users/<uid>/tmp-<uuid>.
	if len(store.putKeys) != 2 {
		t.Fatalf("Put calls = %d, want 2", len(store.putKeys))
	}
	for _, key := range store.putKeys {
		if !strings.HasPrefix(key, "users/7/tmp-") {
			t.Errorf("Put key = %q, want users/7/tmp-<uuid>", key)
		}
		if strings.HasPrefix(key, "blobs/") {
			t.Errorf("Put hit blobs prefix directly: %q", key)
		}
	}
	if store.putKeys[0] == store.putKeys[1] {
		t.Error("tmp keys must be unique per upload")
	}

	sha := shaHex(content)
	blobKey := BlobObjectKey(sha)
	// Copy-before-tx: every upload promotes via ONE server-side copy to the
	// same final key; the redundant hit-path copy is the accepted cost (report).
	if len(store.copies) != 2 || store.copies[0][1] != blobKey || store.copies[1][1] != blobKey {
		t.Fatalf("copies = %v, want two copies into %s", store.copies, blobKey)
	}
	if got := store.objects[blobKey]; got != content {
		t.Errorf("blob bytes = %q, want the uploaded content", got)
	}

	// Dedup accounting: ONE objects row at refcount 2, TWO files rows sharing
	// the blob key, both tmp keys cleaned up post-commit.
	if len(repo.blobs) != 1 {
		t.Fatalf("objects rows = %d, want 1", len(repo.blobs))
	}
	if obj := repo.blobs[sha]; obj == nil || obj.Refcount != 2 {
		t.Fatalf("blob = %+v, want refcount 2", obj)
	}
	if len(repo.files) != 2 {
		t.Fatalf("files rows = %d, want 2", len(repo.files))
	}
	if first.ObjectKey != blobKey || second.ObjectKey != blobKey {
		t.Errorf("file rows not blob-keyed: %q / %q", first.ObjectKey, second.ObjectKey)
	}
	if second.OriginalName != "b.txt" || first.OriginalName != "a.txt" {
		t.Errorf("identity fields lost: %q / %q", first.OriginalName, second.OriginalName)
	}
	if len(store.deleteKeys) != 2 || store.deleteKeys[0] != store.putKeys[0] || store.deleteKeys[1] != store.putKeys[1] {
		t.Errorf("tmp deletes = %v, want both tmp keys in upload order", store.deleteKeys)
	}
	if _, leaked := store.objects[store.putKeys[0]]; leaked {
		t.Error("first tmp object survived success cleanup")
	}
	if repo.reserved != 0 || repo.used != 2*int64(len(content)) {
		t.Errorf("quota = reserved %d used %d, want 0 / %d", repo.reserved, repo.used, 2*len(content))
	}
	if len(repo.releaseCalls) != 0 {
		t.Errorf("ReleaseQuota calls = %v, want none on success", repo.releaseCalls)
	}
}

func TestUploadHashCorrect(t *testing.T) {
	store := &dedupStorageFake{}
	repo := newDedupRepoFake()
	svc := NewService(store, repo, uploadFolders{})

	content := "hash the stream, not the header — 你好 bytes"
	want := shaHex(content)
	created, err := svc.Upload(context.Background(), uploadInput(3, "h.txt", "text/plain", content))
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	if repo.lastDedup.Sha256 != want {
		t.Errorf("tx sha = %q, want tee sha256 %q", repo.lastDedup.Sha256, want)
	}
	if created.Sha256 == nil || *created.Sha256 != want {
		t.Errorf("file row sha = %v, want %q", created.Sha256, want)
	}
	if created.ObjectKey != BlobObjectKey(want) || created.ETag != want {
		t.Errorf("placement/etag = %q / %q, want %q / sha", created.ObjectKey, created.ETag, BlobObjectKey(want))
	}
	if got := store.copies[0]; got[0] != store.putKeys[0] || got[1] != BlobObjectKey(want) {
		t.Errorf("copy = %v, want tmp %s → %s", got, store.putKeys[0], BlobObjectKey(want))
	}
}

// A declared size smaller than the stream caps BOTH the stored object and the
// hashed prefix identically (tee sees exactly what Put reads) — the sha must
// match the bytes that actually landed, never more.
func TestUploadTeeMatchesStoredBytesOnLyingSize(t *testing.T) {
	store := &dedupStorageFake{}
	repo := newDedupRepoFake()
	svc := NewService(store, repo, uploadFolders{})

	content := "hello world"
	in := uploadInput(7, "lie.txt", "text/plain", content)
	in.Size = 5
	if _, err := svc.Upload(context.Background(), in); err != nil {
		t.Fatalf("upload: %v", err)
	}
	want := shaHex("hello")
	if repo.lastDedup.Sha256 != want {
		t.Errorf("sha = %q, want hash of the stored prefix %q", repo.lastDedup.Sha256, want)
	}
	if repo.lastDedup.Size != 5 || repo.lastDedup.ReservedSize != 5 {
		t.Errorf("size/reserved = %d/%d, want 5/5", repo.lastDedup.Size, repo.lastDedup.ReservedSize)
	}
}

// ---------------------------------------------------------------------------
// provenance + MIME (forward contracts 2 + 3)
// ---------------------------------------------------------------------------

func TestUploadDedupContentTypeSanitized(t *testing.T) {
	longValid := "text/" + strings.Repeat("y", 200) // parses fine, exceeds the column
	cases := []struct {
		declared string
		wantTx   string // coarse-filtered value handed to DedupCreate
		wantRow  string // ClampContentType of it — what the objects row (and
		// the files row via the mapper) carries
	}{
		{"text/plain; charset=utf-8", "text/plain", "text/plain"}, // coarse strips parameters
		{"not a mime type!", "application/octet-stream", "application/octet-stream"},
		{"", "application/octet-stream", "application/octet-stream"},
		{longValid, longValid, ClampContentType(longValid)}, // clamp happens at the acquire
	}
	for _, tc := range cases {
		store := &dedupStorageFake{}
		repo := newDedupRepoFake()
		svc := NewService(store, repo, uploadFolders{})

		created, err := svc.Upload(context.Background(), uploadInput(7, "ct.txt", tc.declared, "body"))
		if err != nil {
			t.Fatalf("declared %q: %v", tc.declared, err)
		}
		if repo.lastDedup.ContentType != tc.wantTx {
			t.Errorf("declared %q: tx content_type = %q, want %q", tc.declared, repo.lastDedup.ContentType, tc.wantTx)
		}
		// The files row copies the acquired (clamped) Object's value — never
		// the header.
		if created.ContentType != tc.wantRow {
			t.Errorf("declared %q: row content_type = %q, want %q", tc.declared, created.ContentType, tc.wantRow)
		}
		if n := len([]rune(created.ContentType)); n > maxBlobContentTypeLen {
			t.Errorf("declared %q: row content_type exceeds column width %d", tc.declared, maxBlobContentTypeLen)
		}
		// tmp Put keeps the raw trimmed type (object metadata of a doomed key;
		// documented deliberate split in the report).
		wantPut := strings.TrimSpace(tc.declared)
		if wantPut == "" {
			wantPut = "application/octet-stream"
		}
		if store.putContentTypes[0] != wantPut {
			t.Errorf("declared %q: tmp Put type = %q, want raw trimmed %q", tc.declared, store.putContentTypes[0], wantPut)
		}
	}
}

func TestUploadHitTakesBlobProvenance(t *testing.T) {
	store := &dedupStorageFake{}
	repo := newDedupRepoFake()
	svc := NewService(store, repo, uploadFolders{})
	content := "same content, different lies"

	if _, err := svc.Upload(context.Background(), uploadInput(7, "first.txt", "text/plain", content)); err != nil {
		t.Fatalf("first upload: %v", err)
	}
	// Second uploader lies about the MIME; the first uploader's committed
	// objects value wins for the row (and the blob bytes are untouched).
	second, err := svc.Upload(context.Background(), uploadInput(7, "second.zip", "application/zip", content))
	if err != nil {
		t.Fatalf("second upload: %v", err)
	}
	if repo.lastWasCreate {
		t.Error("second DedupCreate must take the adopt path (created=false)")
	}
	if second.ContentType != "text/plain" {
		t.Errorf("hit row content_type = %q, want first uploader's text/plain", second.ContentType)
	}
	if repo.blobs[shaHex(content)].ContentType != "text/plain" {
		t.Error("hit path must not mutate the committed objects content_type")
	}
}

func TestUploadEmptyContentDedupsToEmptyBlob(t *testing.T) {
	store := &dedupStorageFake{}
	repo := newDedupRepoFake()
	svc := NewService(store, repo, uploadFolders{})
	emptySHA := shaHex("") // e3b0c442... — the canonical empty-content sha

	for i := 0; i < 2; i++ {
		if _, err := svc.Upload(context.Background(), uploadInput(7, "empty", "text/plain", "")); err != nil {
			t.Fatalf("upload %d: %v", i, err)
		}
	}
	if repo.blobs[emptySHA].Refcount != 2 {
		t.Fatalf("empty blob refcount = %+v, want 2", repo.blobs[emptySHA])
	}
	if repo.used != 0 {
		t.Errorf("used = %d, want 0 (zero-size conversion skipped, mirrors convertReservationTx)", repo.used)
	}
	if len(store.deleteKeys) != 2 {
		t.Errorf("tmp deletes = %v, want both", store.deleteKeys)
	}
}

// ---------------------------------------------------------------------------
// compensation matrix
// ---------------------------------------------------------------------------

func TestUploadFailureCleansTmp(t *testing.T) {
	store := &dedupStorageFake{}
	repo := newDedupRepoFake()
	boom := errors.New("deadlock on something else")
	repo.dedupErrs = []error{boom}
	svc := NewService(store, repo, uploadFolders{})

	content := "tx fails after copy"
	_, err := svc.Upload(context.Background(), uploadInput(7, "x.txt", "text/plain", content))
	if err == nil || !errors.Is(err, boom) {
		t.Fatalf("error = %v, want the deterministic failure surfaced", err)
	}
	if errors.Is(err, ErrBlobBusy) {
		t.Error("non-contention failure must not wear the busy face")
	}
	if repo.dedupCalls != 1 {
		t.Errorf("DedupCreate calls = %d, want 1 (deterministic — no retry churn)", repo.dedupCalls)
	}
	// tmp cleaned, quota released, NO file row; the blob orphan is accepted
	// (cmd/blob-gc sweeps blobs without rows, spec §1.4).
	if len(store.deleteKeys) != 1 || store.deleteKeys[0] != store.putKeys[0] {
		t.Errorf("tmp deletes = %v, want the tmp key", store.deleteKeys)
	}
	if len(repo.files) != 0 {
		t.Errorf("files rows = %d, want 0", len(repo.files))
	}
	if _, ok := store.objects[BlobObjectKey(shaHex(content))]; !ok {
		t.Error("blob should remain as a gc-collectable orphan after copy success")
	}
	if len(repo.releaseCalls) != 1 || repo.releaseCalls[0] != int64(len(content)) || repo.reserved != 0 {
		t.Errorf("quota release = %v reserved %d, want [%d] 0", repo.releaseCalls, repo.reserved, len(content))
	}
}

func TestUploadCopyFailureCleansTmp(t *testing.T) {
	store := &dedupStorageFake{copyErr: errors.New("minio copy down")}
	repo := newDedupRepoFake()
	svc := NewService(store, repo, uploadFolders{})

	_, err := svc.Upload(context.Background(), uploadInput(7, "x.txt", "text/plain", "copy fails"))
	if err == nil || !strings.Contains(err.Error(), "copy") {
		t.Fatalf("error = %v, want copy failure surfaced (500 face)", err)
	}
	if repo.dedupCalls != 0 {
		t.Errorf("DedupCreate calls = %d, want 0 — no tx without bytes at final key", repo.dedupCalls)
	}
	if len(store.deleteKeys) != 1 {
		t.Errorf("tmp deletes = %v, want cleanup attempted (tmp never orphaned on error path)", store.deleteKeys)
	}
	if len(repo.files) != 0 {
		t.Errorf("files rows = %d, want 0", len(repo.files))
	}
	if repo.reserved != 0 || len(repo.releaseCalls) != 1 {
		t.Errorf("quota = reserved %d releases %v, want 0 / 1 release", repo.reserved, repo.releaseCalls)
	}
}

func TestUploadPutFailureCleansUp(t *testing.T) {
	store := &dedupStorageFake{putErr: errors.New("minio down")}
	repo := newDedupRepoFake()
	svc := NewService(store, repo, uploadFolders{})

	_, err := svc.Upload(context.Background(), uploadInput(7, "x.txt", "text/plain", "never lands"))
	if err == nil {
		t.Fatal("Put failure must surface")
	}
	if len(store.copies) != 0 || repo.dedupCalls != 0 {
		t.Error("no copy/tx after a failed Put")
	}
	// No tmp delete — nothing was stored (preserves the pre-B4 defer guard).
	if len(store.deleteKeys) != 0 {
		t.Errorf("deletes = %v, want none for an unstored object", store.deleteKeys)
	}
	if len(repo.releaseCalls) != 1 || repo.reserved != 0 {
		t.Errorf("quota = releases %v reserved %d, want 1 / 0", repo.releaseCalls, repo.reserved)
	}
}

func TestUploadReserveFailureTouchesNothing(t *testing.T) {
	store := &dedupStorageFake{}
	repo := newDedupRepoFake()
	repo.reserveErr = ErrQuotaExceeded
	svc := NewService(store, repo, uploadFolders{})

	_, err := svc.Upload(context.Background(), uploadInput(7, "x.txt", "text/plain", "body"))
	if !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("error = %v, want 507-chain ErrQuotaExceeded", err)
	}
	if len(store.putKeys) != 0 || len(repo.releaseCalls) != 0 {
		t.Errorf("storage puts = %d releases = %d, want 0/0 (defer not armed before a successful reserve)", len(store.putKeys), len(repo.releaseCalls))
	}
}

func TestUploadFolderDeniedShortCircuitsBeforeStorage(t *testing.T) {
	store := &dedupStorageFake{}
	repo := newDedupRepoFake()
	svc := NewService(store, repo, uploadFolders{err: folder.ErrFolderNotFound})

	in := uploadInput(7, "x.txt", "text/plain", "body")
	in.FolderID = 9
	_, err := svc.Upload(context.Background(), in)
	if !errors.Is(err, folder.ErrFolderNotFound) {
		t.Fatalf("error = %v, want folder 404 face", err)
	}
	if len(store.putKeys) != 0 || len(repo.reserveCalls) != 0 {
		t.Error("folder rejection must precede quota/storage work")
	}
}

// ---------------------------------------------------------------------------
// retry policy (forward contract 1): shared bounded loop, IO stays outside
// ---------------------------------------------------------------------------

func TestUploadBusyRetryExhaustion(t *testing.T) {
	store := &dedupStorageFake{}
	repo := newDedupRepoFake()
	busy := make([]error, blobTxMaxAttempts)
	for i := range busy {
		busy[i] = mysqlErr(1213)
	}
	repo.dedupErrs = busy
	svc := NewService(store, repo, uploadFolders{})

	content := "every attempt deadlocks"
	_, err := svc.Upload(context.Background(), uploadInput(7, "x.txt", "text/plain", content))
	if !errors.Is(err, ErrBlobBusy) {
		t.Fatalf("error = %v, want ErrBlobBusy (handler: 409)", err)
	}
	if repo.dedupCalls != blobTxMaxAttempts {
		t.Errorf("DedupCreate calls = %d, want exactly %d", repo.dedupCalls, blobTxMaxAttempts)
	}
	// MinIO work ran ONCE — the retry loop wraps the tx only, never the copy.
	if len(store.copies) != 1 || len(store.putKeys) != 1 {
		t.Errorf("IO repeated under retry: puts %d copies %d, want 1/1", len(store.putKeys), len(store.copies))
	}
	if len(store.deleteKeys) != 1 {
		t.Errorf("tmp deletes = %v, want cleanup on exhaustion (blob orphan to gc)", store.deleteKeys)
	}
	if len(repo.files) != 0 || repo.reserved != 0 {
		t.Errorf("state = files %d reserved %d, want 0/0", len(repo.files), repo.reserved)
	}
}

func TestUploadBusyThenSuccessKeepsSingleCopy(t *testing.T) {
	store := &dedupStorageFake{}
	repo := newDedupRepoFake()
	repo.dedupErrs = []error{mysqlErr(1205)}
	svc := NewService(store, repo, uploadFolders{})

	content := "deadlock once then land"
	created, err := svc.Upload(context.Background(), uploadInput(7, "x.txt", "text/plain", content))
	if err != nil {
		t.Fatalf("upload after retry: %v", err)
	}
	if repo.dedupCalls != 2 || len(store.copies) != 1 || len(store.putKeys) != 1 {
		t.Errorf("calls=%d puts=%d copies=%d, want 2/1/1", repo.dedupCalls, len(store.putKeys), len(store.copies))
	}
	if created.ObjectKey != BlobObjectKey(shaHex(content)) {
		t.Errorf("row key = %q, want blob placement", created.ObjectKey)
	}
	if len(store.deleteKeys) != 1 {
		t.Errorf("tmp deletes = %v, want exactly 1", store.deleteKeys)
	}
}

func TestUploadValidationGuardsBeforeReserve(t *testing.T) {
	store := &dedupStorageFake{}
	repo := newDedupRepoFake()
	svc := NewService(store, repo, uploadFolders{})

	// Zero-byte upload of a REAL body through a nil reader guard etc. must all
	// short-circuit before ReserveQuota — pre-existing Upload contract, pinned
	// now that the happy path moved (report: deliberate, not accidental).
	if _, err := svc.Upload(context.Background(), UploadInput{OwnerID: 0}); err == nil {
		t.Error("zero owner must fail")
	}
	if _, err := svc.Upload(context.Background(), uploadInput(7, "../bad", "text/plain", "x")); !errors.Is(err, ErrInvalidFileName) {
		t.Errorf("bad name error = %v, want ErrInvalidFileName", err)
	}
	if _, err := svc.Upload(context.Background(), UploadInput{OwnerID: 7, OriginalName: "n", Size: -1, Reader: bytes.NewReader(nil)}); err == nil {
		t.Error("negative size must fail")
	}
	if len(store.putKeys) != 0 || len(repo.reserveCalls) != 0 {
		t.Errorf("guards leaked IO: puts %d reserves %d, want 0/0", len(store.putKeys), len(repo.reserveCalls))
	}
}
