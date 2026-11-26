package file

import (
	"PersonalCloudStorage/internal/folder"
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
)

// instantFolderAuthorizer mirrors folder.Service.EnsureOwned for the instant
// tests: root (id=0) always passes; anything else answers with the production
// wrapper around folder.ErrFolderNotFound, so tests pin the exact errors.Is
// chain the httpapi 404 mapping relies on without faking folder internals.
type instantFolderAuthorizer struct {
	owned map[uint64]uint64 // folderID -> ownerID of accessible folders (empty = reject all non-root)
	err   error             // overrides everything when set (non-nil = fail all, root included)
	calls int
	owner uint64
	id    uint64
}

func (f *instantFolderAuthorizer) EnsureOwned(_ context.Context, ownerID uint64, folderID uint64) error {
	f.calls++
	f.owner = ownerID
	f.id = folderID
	if f.err != nil {
		return f.err
	}
	if folderID == 0 {
		return nil
	}
	if owner, ok := f.owned[folderID]; !ok || owner != ownerID {
		return fmt.Errorf("ensure folder ownership: %w", folder.ErrFolderNotFound)
	}
	return nil
}

var _ FolderAuthorizer = (*instantFolderAuthorizer)(nil)

const (
	sha64a  = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	sha64b  = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	sha64OK = sha64a
)

func mysqlErr(number uint16) error {
	return &mysql.MySQLError{Number: number, Message: "synthetic"}
}

func instantObject() *Object {
	return &Object{
		Sha256:      sha64a,
		ObjectKey:   BlobObjectKey(sha64a),
		ContentType: "text/plain",
		Size:        4096,
		Refcount:    1,
	}
}

func validInstantInput() InstantInput {
	return InstantInput{
		OwnerID:      7,
		Sha256:       sha64OK,
		OriginalName: "notes.txt",
		ContentType:  "text/plain",
		FolderID:     3,
	}
}

func instantService(repo *cascadeRepositoryStub, folders FolderAuthorizer) *Service {
	svc := NewService(nil, repo, folders)
	return svc
}

// ---------------------------------------------------------------------------
// hit: File fields come from the Object, never the probe body (B1 contract #2)
// ---------------------------------------------------------------------------

func TestInstantUploadHitBuildsFileFromObject(t *testing.T) {
	obj := instantObject()
	// Probe LIES about content_type; the files row must copy the objects value.
	in := InstantInput{
		OwnerID:      7,
		Sha256:       sha64a,
		OriginalName: "notes.txt",
		ContentType:  "application/zip",
		FolderID:     3,
	}
	repo := &cascadeRepositoryStub{findBlobObj: obj}
	folders := &instantFolderAuthorizer{owned: map[uint64]uint64{3: 7}}
	svc := instantService(repo, folders)

	created, err := svc.InstantUpload(context.Background(), in)
	if err != nil {
		t.Fatalf("InstantUpload: %v", err)
	}
	if created.ContentType != obj.ContentType {
		t.Errorf("content_type = %q, want objects-row %q", created.ContentType, obj.ContentType)
	}
	if created.ObjectKey != obj.ObjectKey {
		t.Errorf("object_key = %q, want %q", created.ObjectKey, obj.ObjectKey)
	}
	if created.Size != obj.Size {
		t.Errorf("size = %d, want %d", created.Size, obj.Size)
	}
	if created.ETag != sha64a {
		t.Errorf("etag = %q, want sha %q (spec §2.1: etag=sha256 for dedup files)", created.ETag, sha64a)
	}
	if created.Sha256 == nil || *created.Sha256 != sha64a {
		t.Errorf("sha256 = %v, want pointer to %q", created.Sha256, sha64a)
	}
	if created.OwnerID != 7 || created.FolderID != 3 || created.OriginalName != "notes.txt" {
		t.Errorf("identity fields wrong: %+v", created)
	}
	if created.Status != StatusActive {
		t.Errorf("status = %d, want active", created.Status)
	}
	if folders.calls != 1 || folders.owner != 7 || folders.id != 3 {
		t.Errorf("EnsureOwned = (%d calls, owner %d, id %d), want (1, 7, 3)", folders.calls, folders.owner, folders.id)
	}
	if repo.instantCreateCalls != 1 {
		t.Errorf("InstantCreate calls = %d, want 1", repo.instantCreateCalls)
	}
}

func TestInstantUploadHitCarriesClampedContentType(t *testing.T) {
	long := strings.Repeat("x", 200)
	obj := instantObject()
	obj.ContentType = ClampContentType(long) // exactly the 127-rune clamp B1 stores
	repo := &cascadeRepositoryStub{findBlobObj: obj}
	svc := instantService(repo, &instantFolderAuthorizer{owned: map[uint64]uint64{3: 7}})

	in := validInstantInput()
	in.ContentType = "bogus client value"
	created, err := svc.InstantUpload(context.Background(), in)
	if err != nil {
		t.Fatalf("InstantUpload: %v", err)
	}
	if created.ContentType != obj.ContentType {
		t.Errorf("content_type = %q, want the clamped objects value verbatim", created.ContentType)
	}
	if n := len([]rune(created.ContentType)); n != maxBlobContentTypeLen {
		t.Errorf("content_type runes = %d, want clamp width %d", n, maxBlobContentTypeLen)
	}
}

// ---------------------------------------------------------------------------
// probe short-circuit: miss is ErrBlobNotFound, before folder auth + tx
// ---------------------------------------------------------------------------

func TestInstantUploadMissShortCircuits(t *testing.T) {
	repo := &cascadeRepositoryStub{} // no findBlobObj → FindBlob answers ErrBlobNotFound
	folders := &instantFolderAuthorizer{owned: map[uint64]uint64{3: 7}}
	svc := instantService(repo, folders)

	_, err := svc.InstantUpload(context.Background(), validInstantInput())
	if !errors.Is(err, ErrBlobNotFound) {
		t.Fatalf("error = %v, want ErrBlobNotFound (handler: 200 exists:false)", err)
	}
	if folders.calls != 0 {
		t.Errorf("probe miss must short-circuit before folder auth, calls = %d", folders.calls)
	}
	if repo.instantCreateCalls != 0 {
		t.Errorf("InstantCreate calls = %d, want 0", repo.instantCreateCalls)
	}
}

func TestInstantUploadQuotaExceededPropagates(t *testing.T) {
	repo := &cascadeRepositoryStub{findBlobObj: instantObject()}
	repo.instantCreateErrs = []error{ErrQuotaExceeded}
	svc := instantService(repo, &instantFolderAuthorizer{owned: map[uint64]uint64{3: 7}})

	_, err := svc.InstantUpload(context.Background(), validInstantInput())
	if !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("error = %v, want ErrQuotaExceeded", err)
	}
	if errors.Is(err, ErrBlobBusy) {
		t.Error("quota rejection must not wear the busy face")
	}
	if repo.instantCreateCalls != 1 {
		t.Errorf("InstantCreate calls = %d, want 1 (deterministic — no retry churn)", repo.instantCreateCalls)
	}
}

// ---------------------------------------------------------------------------
// validation guards run before ANY dependency touch
// ---------------------------------------------------------------------------

func TestInstantUploadValidatesShaBeforeAnyIO(t *testing.T) {
	for _, bad := range []string{"", strings.Repeat("A", 64), strings.Repeat("f", 63), strings.Repeat("g", 64), "not-hex-64-chars-long-enough-actually-nope-x"} {
		repo := &cascadeRepositoryStub{findBlobObj: instantObject()}
		folders := &instantFolderAuthorizer{owned: map[uint64]uint64{3: 7}}
		svc := instantService(repo, folders)

		in := validInstantInput()
		in.Sha256 = bad
		_, err := svc.InstantUpload(context.Background(), in)
		if !errors.Is(err, ErrInvalidSha256) {
			t.Errorf("sha %q: error = %v, want ErrInvalidSha256", bad, err)
		}
		if folders.calls != 0 || repo.instantCreateCalls != 0 {
			t.Errorf("sha %q: deps touched before validation (folders=%d tx=%d)", bad, folders.calls, repo.instantCreateCalls)
		}
	}
}

func TestInstantUploadFolderDeniedMapsToErrFolderNotFound(t *testing.T) {
	repo := &cascadeRepositoryStub{findBlobObj: instantObject()}
	folders := &instantFolderAuthorizer{owned: map[uint64]uint64{4: 7}} // 3 not owned
	svc := instantService(repo, folders)

	_, err := svc.InstantUpload(context.Background(), validInstantInput())
	if !errors.Is(err, folder.ErrFolderNotFound) {
		t.Fatalf("error = %v, want ErrFolderNotFound face (handler: 404)", err)
	}
	if repo.instantCreateCalls != 0 {
		t.Errorf("InstantCreate calls = %d, want 0 after folder rejection", repo.instantCreateCalls)
	}

	// Missing (nobody's) folder and foreign folder share the 404 face (§2.3).
	_, err2 := svc.InstantUpload(context.Background(), InstantInput{
		OwnerID: 7, Sha256: sha64OK, OriginalName: "n.txt", ContentType: "text/plain", FolderID: 999,
	})
	if !errors.Is(err2, folder.ErrFolderNotFound) {
		t.Errorf("missing folder error = %v, want same ErrFolderNotFound face", err2)
	}
}

func TestInstantUploadRootFolderAllowed(t *testing.T) {
	repo := &cascadeRepositoryStub{findBlobObj: instantObject()}
	folders := &instantFolderAuthorizer{} // empty map: only root passes
	svc := instantService(repo, folders)

	in := validInstantInput()
	in.FolderID = 0
	if _, err := svc.InstantUpload(context.Background(), in); err != nil {
		t.Fatalf("root instant: %v", err)
	}
	if folders.calls != 1 || repo.instantCreateCalls != 1 {
		t.Errorf("folders=%d tx=%d, want 1/1", folders.calls, repo.instantCreateCalls)
	}
}

func TestInstantUploadRejectsBadFileNameLikeUpload(t *testing.T) {
	repo := &cascadeRepositoryStub{findBlobObj: instantObject()}
	folders := &instantFolderAuthorizer{owned: map[uint64]uint64{3: 7}}
	svc := instantService(repo, folders)

	in := validInstantInput()
	in.OriginalName = "../escape.txt"
	if _, err := svc.InstantUpload(context.Background(), in); !errors.Is(err, ErrInvalidFileName) {
		t.Fatalf("path name error = %v, want ErrInvalidFileName", err)
	}
	blank := validInstantInput()
	blank.OriginalName = "   "
	if _, err := svc.InstantUpload(context.Background(), blank); !errors.Is(err, ErrInvalidFileName) {
		t.Fatalf("blank name error = %v, want ErrInvalidFileName", err)
	}
	if repo.instantCreateCalls != 0 {
		t.Errorf("InstantCreate calls = %d, want 0 for invalid names", repo.instantCreateCalls)
	}
}

func TestInstantUploadTrimsNameForTx(t *testing.T) {
	repo := &cascadeRepositoryStub{findBlobObj: instantObject()}
	svc := instantService(repo, &instantFolderAuthorizer{owned: map[uint64]uint64{3: 7}})

	in := validInstantInput()
	in.OriginalName = "  notes.txt  "
	if _, err := svc.InstantUpload(context.Background(), in); err != nil {
		t.Fatalf("InstantUpload: %v", err)
	}
	if repo.lastInstantInput.OriginalName != "notes.txt" {
		t.Errorf("tx name = %q, want trimmed notes.txt", repo.lastInstantInput.OriginalName)
	}
}

// ---------------------------------------------------------------------------
// retry policy (B1 review RF1): bounded, errno-classified, never substring
// ---------------------------------------------------------------------------

func TestInstantUploadRetryRecovers(t *testing.T) {
	repo := &cascadeRepositoryStub{findBlobObj: instantObject()}
	repo.instantCreateErrs = []error{mysqlErr(1213), mysqlErr(1205)} // attempts 1-2 fail, 3 succeeds
	svc := instantService(repo, &instantFolderAuthorizer{owned: map[uint64]uint64{3: 7}})

	created, err := svc.InstantUpload(context.Background(), validInstantInput())
	if err != nil {
		t.Fatalf("InstantUpload after retry: %v", err)
	}
	if created.Size != 4096 {
		t.Errorf("created = %+v, want object-backed row", created)
	}
	if repo.instantCreateCalls != 3 {
		t.Errorf("InstantCreate calls = %d, want 3 tx attempts", repo.instantCreateCalls)
	}
}

func TestInstantUploadRetryExhaustionIsBlobBusy(t *testing.T) {
	repo := &cascadeRepositoryStub{findBlobObj: instantObject()}
	busy := make([]error, blobTxMaxAttempts) // every attempt deadlocks
	for i := range busy {
		busy[i] = mysqlErr(1213)
	}
	repo.instantCreateErrs = busy
	svc := instantService(repo, &instantFolderAuthorizer{owned: map[uint64]uint64{3: 7}})

	_, err := svc.InstantUpload(context.Background(), validInstantInput())
	if !errors.Is(err, ErrBlobBusy) {
		t.Fatalf("error = %v, want ErrBlobBusy", err)
	}
	if repo.instantCreateCalls != blobTxMaxAttempts {
		t.Errorf("InstantCreate calls = %d, want exactly %d", repo.instantCreateCalls, blobTxMaxAttempts)
	}
}

func TestInstantUploadRetryWalksWrappedErrors(t *testing.T) {
	// The retry classifier must see through repository context wrapping:
	// fmt.Errorf("acquire blob insert: %w", &mysql.MySQLError{1213}).
	repo := &cascadeRepositoryStub{findBlobObj: instantObject()}
	wrapped := make([]error, blobTxMaxAttempts)
	for i := range wrapped {
		wrapped[i] = fmt.Errorf("acquire blob insert: %w", mysqlErr(1213))
	}
	repo.instantCreateErrs = wrapped
	svc := instantService(repo, &instantFolderAuthorizer{owned: map[uint64]uint64{3: 7}})

	_, err := svc.InstantUpload(context.Background(), validInstantInput())
	if !errors.Is(err, ErrBlobBusy) {
		t.Fatalf("wrapped 1213 must still retry→busy, got %v", err)
	}
	if repo.instantCreateCalls != blobTxMaxAttempts {
		t.Errorf("InstantCreate calls = %d, want %d (wrapping transparent)", repo.instantCreateCalls, blobTxMaxAttempts)
	}
}

func TestInstantUploadNonRetryableSurfacesImmediately(t *testing.T) {
	// 1062 duplicate entry: same driver error type, NOT a lock condition —
	// exactly one attempt, never dressed as busy.
	repo := &cascadeRepositoryStub{findBlobObj: instantObject()}
	repo.instantCreateErrs = []error{fmt.Errorf("save instant file: %w", mysqlErr(1062))}
	svc := instantService(repo, &instantFolderAuthorizer{owned: map[uint64]uint64{3: 7}})

	_, err := svc.InstantUpload(context.Background(), validInstantInput())
	if errors.Is(err, ErrBlobBusy) {
		t.Fatalf("1062 must not wear the busy face: %v", err)
	}
	var myErr *mysql.MySQLError
	if !errors.As(err, &myErr) || myErr.Number != 1062 {
		t.Fatalf("error = %v, want the 1062 chain surfaced verbatim", err)
	}
	if repo.instantCreateCalls != 1 {
		t.Errorf("InstantCreate calls = %d, want 1 (no retry on 1062)", repo.instantCreateCalls)
	}

	// Plain (non-mysql) errors likewise run exactly one attempt.
	repo2 := &cascadeRepositoryStub{findBlobObj: instantObject()}
	repo2.instantCreateErrs = []error{errors.New("connection reset by peer")}
	svc2 := instantService(repo2, &instantFolderAuthorizer{owned: map[uint64]uint64{3: 7}})
	if _, err := svc2.InstantUpload(context.Background(), validInstantInput()); err == nil {
		t.Fatal("plain error must surface")
	}
	if repo2.instantCreateCalls != 1 {
		t.Errorf("InstantCreate calls = %d, want 1", repo2.instantCreateCalls)
	}
}

func TestInstantUploadRetryStopsOnCancelledContext(t *testing.T) {
	repo := &cascadeRepositoryStub{findBlobObj: instantObject()}
	repo.instantCreateErrs = []error{mysqlErr(1213), mysqlErr(1213), mysqlErr(1213), mysqlErr(1213)}
	svc := instantService(repo, &instantFolderAuthorizer{owned: map[uint64]uint64{3: 7}})

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // first tx sees cancelled ctx; backoff wait must abort

	_, err := svc.InstantUpload(ctx, validInstantInput())
	if repo.instantCreateCalls != 1 {
		t.Errorf("InstantCreate calls = %d, want 1 then backoff-abort", repo.instantCreateCalls)
	}
	if !errors.Is(err, context.Canceled) && !errors.Is(err, ErrBlobBusy) {
		// Either surface is acceptable; substring-matching busy is NOT (contract).
		t.Fatalf("error = %v, want ctx error or busy", err)
	}
}

// ---------------------------------------------------------------------------
// mapper unit: newInstantFile (gorm tx and test fake share ONE impl)
// ---------------------------------------------------------------------------

func TestNewInstantFileMapsObjectFields(t *testing.T) {
	obj := instantObject()
	in := InstantInput{OwnerID: 9, Sha256: sha64a, OriginalName: "x.txt", ContentType: "bogus", FolderID: 2}

	file := newInstantFile(in.OwnerID, in, obj)
	if file.ContentType != obj.ContentType || file.Size != obj.Size || file.ObjectKey != obj.ObjectKey {
		t.Errorf("content fields not from Object: %+v", file)
	}
	if file.ETag != sha64a || file.Sha256 == nil || *file.Sha256 != sha64a {
		t.Errorf("etag/sha256 wrong: %+v", file)
	}
	if file.OwnerID != 9 || file.FolderID != 2 || file.OriginalName != "x.txt" || file.Status != StatusActive {
		t.Errorf("identity/status wrong: %+v", file)
	}
	// Sha256 pointer copies the value — two rows never alias one buffer.
	obj2 := instantObject()
	obj2.Sha256 = sha64b
	file2 := newInstantFile(1, InstantInput{OriginalName: "y", ContentType: "text/x", Sha256: sha64b}, obj2)
	if *file2.Sha256 != sha64b || *file.Sha256 != sha64a {
		t.Error("newInstantFile rows must not share sha pointers")
	}
}

// ---------------------------------------------------------------------------
// stub sanity: instantCreateErrs repeat-last-error semantics the tests rely on
// ---------------------------------------------------------------------------

func TestCascadeStubInstantCreateSemantics(t *testing.T) {
	obj := instantObject()
	repo := &cascadeRepositoryStub{findBlobObj: obj}
	repo.instantCreateErrs = []error{mysqlErr(1213), nil}

	first, err := repo.InstantCreate(context.Background(), 7, validInstantInput())
	if !errors.Is(err, mysqlErr(1213)) || first != nil {
		t.Fatalf("attempt 1 = (%v, %v), want wrapped 1213", first, err)
	}
	if _, err := repo.InstantCreate(context.Background(), 7, validInstantInput()); err != nil {
		t.Fatalf("attempt 2 (nil error slot): %v", err)
	}
	// Past the list the LAST entry (nil = success) repeats — success row derived
	// from findBlobObj via the shared mapper, mirroring the real tx.
	created, err := repo.InstantCreate(context.Background(), 7, validInstantInput())
	if err != nil || created.ContentType != obj.ContentType {
		t.Fatalf("attempt 3 = (%+v, %v), want mapper-derived object-backed row", created, err)
	}
	if repo.instantCreateCalls != 3 {
		t.Errorf("calls = %d, want 3", repo.instantCreateCalls)
	}
}
