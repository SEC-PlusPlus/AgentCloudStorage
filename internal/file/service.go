package file

import (
	"PersonalCloudStorage/internal/storage"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type UploadInput struct {
	OwnerID      uint64
	FolderID     uint64
	OriginalName string
	ContentType  string
	Size         int64
	Reader       io.Reader
}

type ListInput struct {
	OwnerID  uint64
	FolderID uint64
	Page     int
	PageSize int
}

type RenameInput struct {
	OwnerID uint64
	FileID  uint64
	NewName string
}

type SearchInput struct {
	OwnerID  uint64
	Keyword  string
	Page     int
	PageSize int
}

type ListResult struct {
	Items    []File
	Page     int
	PageSize int
	Total    int64
}

type DownloadResult struct {
	OriginalName string
	ContentType  string
	Size         int64
	Reader       io.ReadCloser
}

type MoveInput struct {
	OwnerID        uint64
	FileID         uint64
	TargetFolderID uint64
}

// InstantInput is the POST /files/instant probe payload (spec §2.3): the
// client declares a sha256 it already computed; the server links a NEW files
// row to the existing content-addressed blob without moving any bytes.
type InstantInput struct {
	OwnerID      uint64
	Sha256       string
	OriginalName string
	ContentType  string
	FolderID     uint64
}

// DedupCreateInput is the direct-upload dedup transaction payload (spec §4,
// B4). Every content field is computed server-side — the tee hash of the
// stream and the size storage reports — never from a client header; identity
// fields come from the multipart request. ContentType is already coarse-
// filtered by Upload; AcquireBlob additionally clamps it to the column width.
type DedupCreateInput struct {
	OwnerID      uint64
	FolderID     uint64
	OriginalName string
	Sha256       string
	ContentType  string
	Size         int64
	ReservedSize int64
}

type StorageUsageResult struct {
	UsedBytes  int64
	QuotaBytes int64
}

type FolderAuthorizer interface {
	EnsureOwned(ctx context.Context, ownerID uint64, folderID uint64) error
}

// SharePurger deletes the share rows referencing a file inside the caller's
// transaction (spec §5.4 cascade). The file package keeps no import on
// internal/share — main.go injects *share.GORMRepository via SetSharePurger.
type SharePurger interface {
	PurgeByFileTx(tx *gorm.DB, fileID uint64) error
}

type Service struct {
	storage     storage.ObjectStorage
	repo        Repository
	folders     FolderAuthorizer
	sharePurger SharePurger
}

func NewService(objectStorage storage.ObjectStorage, repo Repository, folders FolderAuthorizer) *Service {
	return &Service{
		storage: objectStorage,
		repo:    repo,
		folders: folders,
	}
}

// WithFolderAuthorizer re-wires folder authorization after construction —
// the same opt-in seam pattern as SetSharePurger. Tests inject a fake here;
// production wiring (main.go) keeps NewService's nil default and the folder
// service wired at boot.
func (s *Service) WithFolderAuthorizer(folders FolderAuthorizer) {
	s.folders = folders
}

// SetSharePurger wires the spec §5.4 cascade; until it is called, permanent
// deletion behaves exactly as before (no extra transaction hooks).
func (s *Service) SetSharePurger(purger SharePurger) {
	s.sharePurger = purger
}

// GetActiveFile answers share.FileLookup (spec §4): the record only when it
// exists, belongs to ownerID and is active. Missing, foreign and trashed all
// return ErrFileNotFound — the 404 face the share layer maps onward.
// repo.GetByID already filters owner_id + status = active.
func (s *Service) GetActiveFile(ctx context.Context, ownerID uint64, fileID uint64) (*File, error) {
	if ownerID == 0 || fileID == 0 {
		return nil, ErrFileNotFound
	}
	return s.repo.GetByID(ctx, ownerID, fileID)
}

// DownloadByKey streams an object straight from storage with NO owner check —
// 仅供分享路径：only share_handler may call it, and only after the share
// token/password/status validation the ownership-heavy Download cannot skip.
func (s *Service) DownloadByKey(ctx context.Context, key string) (*DownloadResult, error) {
	if strings.TrimSpace(key) == "" {
		return nil, errors.New("object key is required")
	}
	reader, info, err := s.storage.Get(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("open shared file content:%w", err)
	}
	return &DownloadResult{
		ContentType: info.ContentType,
		Size:        info.Size,
		Reader:      reader,
	}, nil
}

// Upload streams a direct (≤50MiB) multipart body into a per-upload tmp key
// while hashing it, promotes the bytes to blobs/<sha> server-side, and only
// then runs the dedup transaction (spec §1.3/§4, B4): AcquireBlob + reservation
// convert + files row, all content fields from the committed Object. The 201
// response shape is unchanged; dedup is invisible to the client except that
// repeated content costs no extra storage.
func (s *Service) Upload(ctx context.Context, input UploadInput) (created *File, retErr error) {
	if input.OwnerID == 0 {
		return nil, errors.New("owner id is required")
	}

	name := strings.TrimSpace(input.OriginalName)
	if !validFileName(name) {
		return nil, ErrInvalidFileName
	}
	if input.Reader == nil {
		return nil, errors.New("file reader is required")
	}
	if input.Size < 0 {
		return nil, errors.New("file size must not be negative")
	}
	if err := s.folders.EnsureOwned(ctx, input.OwnerID, input.FolderID); err != nil {
		return nil, fmt.Errorf("validate upload folder: %w", err)
	}

	contentType := strings.TrimSpace(input.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	if err := s.repo.ReserveQuota(ctx, input.OwnerID, input.Size); err != nil {
		return nil, fmt.Errorf("reserve upload quota: %w", err)
	}

	// All tmp-phase semantics are the pre-B4 ones: reservation before any
	// byte moves, input.Size caps what Put consumes, the handler's
	// MaxBytesReader bounds the stream at 50MiB, and every error path below
	// deletes the stored object and releases the reservation (the defer).
	tmpKey := fmt.Sprintf("users/%d/tmp-%s", input.OwnerID, uuid.NewString())
	objectStored := false

	defer func() {
		if retErr == nil {
			return
		}

		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()

		if objectStored {
			if err := s.storage.Delete(cleanupCtx, tmpKey); err != nil {
				retErr = errors.Join(retErr, fmt.Errorf("delete tmp object: %w", err))
			}
		}
		if err := s.repo.ReleaseQuota(cleanupCtx, input.OwnerID, input.Size); err != nil {
			retErr = errors.Join(retErr, fmt.Errorf("release upload quota: %w", err))
		}
	}()

	hasher := sha256.New()
	objectInfo, err := s.storage.Put(ctx, tmpKey, io.TeeReader(input.Reader, hasher), input.Size, contentType)
	if err != nil {
		return nil, fmt.Errorf("upload object to storage: %w", err)
	}
	objectStored = true

	// The tee is the ONLY hash authority (spec v2 dropped the client-declared
	// X-Content-Sha256 header): it saw exactly the bytes Put consumed from
	// the stream — no more, even when the declared size lies.
	sha := hex.EncodeToString(hasher.Sum(nil))
	blobKey := BlobObjectKey(sha)

	// Copy BEFORE the transaction, UNCONDITIONALLY — even on a dedup hit,
	// where this copy is a byte-identical atomic overwrite. The spec §4
	// pseudo-order (tx: AcquireBlob created → Copy) would publish an objects
	// row pointing at blobs/<sha> before the bytes land there, and a
	// concurrent instant probe could 201 a file row against missing content
	// inside that window. Copying first makes every visible objects row
	// complete-by-construction at zero correctness windows; the accepted
	// cost is one MinIO-side copy of ≤50MiB (no client bytes) on the hit
	// path. "Probe the blob, skip the copy on hit" is NOT safe: a
	// PermanentDelete + blob-gc retirement between probe and tx would leave
	// created=true for a sha whose bytes were never copied — a phantom blob.
	if err := s.storage.Copy(ctx, tmpKey, blobKey); err != nil {
		return nil, fmt.Errorf("promote blob to %s: %w", blobKey, err)
	}

	// Dedup transaction under the shared B3 bounded-retry policy (contract
	// 1): every 1213/1205 loss re-runs the WHOLE tx fresh; the MinIO work
	// above never repeats. Exhaustion answers ErrBlobBusy (handler: 409,
	// retry-friendly — the client simply uploads again; no row committed,
	// tmp deleted by the defer, any blobs orphan swept by B5 gc).
	var lastErr error
	for attempt := 1; attempt <= blobTxMaxAttempts; attempt++ {
		if attempt > 1 {
			timer := time.NewTimer(time.Duration(attempt-1) * blobTxRetryPause)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil, ctx.Err()
			case <-timer.C:
			}
		}
		record, err := s.repo.DedupCreate(ctx, DedupCreateInput{
			OwnerID:      input.OwnerID,
			FolderID:     input.FolderID,
			OriginalName: name,
			Sha256:       sha,
			ContentType:  coarseContentType(contentType),
			Size:         objectInfo.Size,
			ReservedSize: input.Size,
		})
		if err == nil {
			// Success: the content lives at blobs/<sha>; tmp is redundant by
			// construction. Best-effort cleanup — a crash past this point
			// leaves users/*/tmp-* for cmd/blob-gc (B5 contract: sweep tmp
			// keys older than the safety window alongside rowless blobs).
			cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			if derr := s.storage.Delete(cleanupCtx, tmpKey); derr != nil {
				slog.Warn("delete tmp object after dedup upload", "key", tmpKey, "error", derr)
			}
			cancel()
			return record, nil
		}
		if !isBlobLockContention(err) {
			// Deterministic outcomes surface verbatim so handler Is-mappings
			// keep working; the defer cleans tmp.
			return nil, fmt.Errorf("save dedup upload: %w", err)
		}
		lastErr = err
	}
	return nil, fmt.Errorf("direct upload: %w (last: %w)", ErrBlobBusy, lastErr)
}

// blobTxMaxAttempts bounds the retry loop over every acquire+create
// transaction (B1 review RF1): both the B3 instant probe and the B4 direct
// upload dedup tx. Concurrent same-sha callers take AcquireBlob's documented
// S→X upgrade deadlock (MySQL 1213) or block into 1205 — the integration
// suite proved it fires. Retry is cheap (no bytes moved inside the loop) but
// must be bounded; exhaustion answers ErrBlobBusy (handler: 409).
const (
	blobTxMaxAttempts = 4
	blobTxRetryPause  = 2 * time.Millisecond
)

// isBlobLockContention classifies the RF1 retryable set by driver errno —
// NEVER by error-string matching (the B3 contract; the integration helper's
// substring hack is test-only and must not leak into production paths).
// errors.As walks our fmt.Errorf("%w") wrapping, so repository context is
// transparent to the classification.
func isBlobLockContention(err error) bool {
	var myErr *mysql.MySQLError
	if !errors.As(err, &myErr) {
		return false
	}
	// 1213 ER_LOCK_DEADLOCK, 1205 ER_LOCK_WAIT_TIMEOUT.
	return myErr.Number == 1213 || myErr.Number == 1205
}

// InstantUpload answers the 秒传 probe (spec §1.3/§2.3): when the sha256
// matches an existing blob, link a files row for the caller WITHOUT any byte
// transfer — refcount+1, quota consumed like a real upload, row fields taken
// from the objects row. A miss is ErrBlobNotFound (handler: 200 exists:false),
// not an error shape of its own.
func (s *Service) InstantUpload(ctx context.Context, input InstantInput) (*File, error) {
	if input.OwnerID == 0 {
		return nil, errors.New("owner id is required")
	}

	// Same name rules as Upload, and the same primitive that guards
	// AcquireBlob — one sha256 validation implementation, no regex duplication.
	name := strings.TrimSpace(input.OriginalName)
	if !validFileName(name) {
		return nil, ErrInvalidFileName
	}
	if err := validateBlobSha256(input.Sha256); err != nil {
		return nil, err
	}
	input.OriginalName = name
	input.ContentType = coarseContentType(input.ContentType)

	// Probe first: a cold sha must not consume folder-auth or quota work,
	// and 未命中 is a normal 200 answer, not an error path. The row values
	// themselves are re-read INSIDE the tx (InstantCreate) under the blob
	// lock — the authoritative copy — so this read gates existence only.
	if _, err := s.repo.FindBlob(ctx, input.Sha256); err != nil {
		return nil, fmt.Errorf("instant probe: %w", err)
	}

	if err := s.folders.EnsureOwned(ctx, input.OwnerID, input.FolderID); err != nil {
		return nil, fmt.Errorf("validate instant upload folder: %w", err)
	}

	// acquire+create as ONE transaction per attempt (spec §5: transaction
	// boundaries live in gorm_repository, HardDeleteWithQuota precedent).
	// Every retry calls InstantCreate fresh — a poisoned tx is never reused.
	var lastErr error
	for attempt := 1; attempt <= blobTxMaxAttempts; attempt++ {
		if attempt > 1 {
			timer := time.NewTimer(time.Duration(attempt-1) * blobTxRetryPause)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil, ctx.Err()
			case <-timer.C:
			}
		}
		created, err := s.repo.InstantCreate(ctx, input.OwnerID, input)
		if err == nil {
			return created, nil
		}
		if !isBlobLockContention(err) {
			// Deterministic outcomes (miss, quota, real db errors) surface
			// verbatim — handler mappings stay Is-able.
			return nil, err
		}
		lastErr = err
	}
	return nil, fmt.Errorf("instant upload: %w (last: %w)", ErrBlobBusy, lastErr)
}

// coarseContentType is the spec §2.3 "MIME 白名单粗筛": a declared type that
// does not parse as a media type with a non-empty subtype degrades to
// application/octet-stream instead of failing the probe. The persisted value
// comes from the objects row regardless (newInstantFile), so this only
// sanitizes what the tx may record when it adopts an existing blob.
func coarseContentType(declared string) string {
	declared = strings.TrimSpace(declared)
	if declared == "" {
		return "application/octet-stream"
	}
	base, _, err := mime.ParseMediaType(declared)
	if err != nil {
		return "application/octet-stream"
	}
	// ParseMediaType accepts single tokens and bare "*"; require type/subtype.
	if slash := strings.IndexByte(base, '/'); slash <= 0 || slash == len(base)-1 || base == "*" {
		return "application/octet-stream"
	}
	return base
}

func (s *Service) List(ctx context.Context, input ListInput) (*ListResult, error) {
	if err := s.folders.EnsureOwned(ctx, input.OwnerID, input.FolderID); err != nil {
		return nil, fmt.Errorf(
			"validate list folder: %w",
			err,
		)
	}

	return s.list(ctx, input, StatusActive, true)
}

func (s *Service) Download(ctx context.Context, ownerID uint64, fileID uint64) (*DownloadResult, error) {
	if ownerID == 0 {
		return nil, errors.New("owner id is required")
	}
	if fileID == 0 {
		return nil, errors.New("file id is required")
	}
	record, err := s.repo.GetByID(ctx, ownerID, fileID)
	if err != nil {
		return nil, fmt.Errorf("get file for download:%w", err)
	}
	reader, info, err := s.storage.Get(ctx, record.ObjectKey)
	if err != nil {
		return nil, fmt.Errorf("open file content:%w", err)
	}
	return &DownloadResult{
		OriginalName: record.OriginalName,
		ContentType:  info.ContentType,
		Size:         info.Size,
		Reader:       reader,
	}, nil
}

func (s *Service) Delete(ctx context.Context, ownerID uint64, fileID uint64) error {
	if ownerID == 0 {
		return errors.New("owner id is required")
	}
	if fileID == 0 {
		return errors.New("file id is required")
	}
	if err := s.repo.SoftDelete(ctx, ownerID, fileID); err != nil {
		return fmt.Errorf("delete file:%w", err)
	}
	return nil
}

func (s *Service) list(ctx context.Context, input ListInput, status Status, filterByFolder bool) (*ListResult, error) {
	if input.OwnerID == 0 {
		return nil, errors.New("owner id is required")
	}
	page := input.Page
	if page < 1 {
		page = 1
	}
	pageSize := input.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	if page > 10000 {
		return nil, errors.New("page must not exceed 10000")
	}
	offset := (page - 1) * pageSize

	var (
		files []File
		total int64
		err   error
	)

	if filterByFolder {
		files, total, err = s.repo.ListByFolderAndStatus(ctx, input.OwnerID, input.FolderID, status, pageSize, offset)
	} else {
		files, total, err = s.repo.ListByStatus(ctx, input.OwnerID, status, pageSize, offset)
	}

	if err != nil {
		return nil, fmt.Errorf("list files: %w", err)
	}

	if files == nil {
		files = []File{}
	}

	return &ListResult{
		Items:    files,
		Page:     page,
		PageSize: pageSize,
		Total:    total,
	}, nil
}

func (s *Service) ListTrash(ctx context.Context, input ListInput) (*ListResult, error) {
	return s.list(ctx, input, StatusDeleted, false)
}

func (s *Service) Restore(ctx context.Context, ownerID uint64, fileID uint64) error {
	if ownerID == 0 {
		return errors.New("owner id is required")
	}
	if fileID == 0 {
		return errors.New("file id is required")
	}
	if err := s.repo.Restore(ctx, ownerID, fileID); err != nil {
		return fmt.Errorf("restore file: %w", err)
	}
	return nil
}

// PermanentDelete forks on files.sha256 (spec §1.3 delete row, §1.4 delayed
// GC). THE RED LINE: a dedup row's object_key may be SHARED — any
// storage.Delete on it destroys other users' data — so the dedup branch is
// pure logic: ONE transaction with the ReleaseBlob acquired FIRST (objects
// row, then the legacy files→users delete tail) inside
// HardDeleteWithBlobRelease, and ZERO MinIO calls in or after the tx. A
// refcount that hits zero only deletes the objects row; the physical blob is
// reclaimed later by cmd/blob-gc under the safety window, which is precisely
// what closes the §1.4 late-Delete-vs-rebuild race a synchronous delete would
// reintroduce. Legacy rows (sha NULL) keep the pre-B5 sequence verbatim:
// object delete first, then the row/quota transaction — no dedup bookkeeping
// exists for them and their object_key is exclusively theirs.
func (s *Service) PermanentDelete(ctx context.Context, ownerID uint64, fileID uint64) error {
	if ownerID == 0 {
		return errors.New("owner id is required")
	}
	if fileID == 0 {
		return errors.New("file id is required")
	}

	record, err := s.repo.GetDeletedByID(ctx, ownerID, fileID)
	if err != nil {
		return fmt.Errorf("get file for permanent deletion: %w", err)
	}
	deleteCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()

	// spec §5.4 cascade: share links die with their object, purged inside the
	// same transaction as the row/quota delete — the extra slice is shared by
	// both branches, hooks running after the row delete in either.
	var extra []func(tx *gorm.DB) error
	if s.sharePurger != nil {
		purger := s.sharePurger
		extra = append(extra, func(tx *gorm.DB) error {
			return purger.PurgeByFileTx(tx, fileID)
		})
	}

	if record.Sha256 != nil {
		// Dedup branch. B3-M4 lock-order alignment: the blob release acquires
		// the objects row BEFORE users/files inside the tx, matching the
		// instant/upload acquire paths. The same bounded retry wraps it
		// (contract 1) so a delete-vs-instant 1213/1205 loss self-heals;
		// exhaustion answers ErrBlobBusy (handler: 409, retry-friendly).
		sha := *record.Sha256
		var lastErr error
		for attempt := 1; attempt <= blobTxMaxAttempts; attempt++ {
			if attempt > 1 {
				timer := time.NewTimer(time.Duration(attempt-1) * blobTxRetryPause)
				select {
				case <-ctx.Done():
					timer.Stop()
					return ctx.Err()
				case <-timer.C:
				}
			}
			err := s.repo.HardDeleteWithBlobRelease(deleteCtx, ownerID, fileID, sha, extra...)
			if err == nil {
				return nil
			}
			if !isBlobLockContention(err) {
				// Deterministic outcomes (row gone, real db errors) surface
				// with their Is-able wrapping, same face as the legacy branch.
				return fmt.Errorf("delete file metadata: %w", err)
			}
			lastErr = err
		}
		return fmt.Errorf("permanent delete: %w (last: %w)", ErrBlobBusy, lastErr)
	}

	// Legacy branch — unchanged behavior (object first, then row tx).
	if err := s.storage.Delete(deleteCtx, record.ObjectKey); err != nil {
		return fmt.Errorf("delete object from storage: %w", err)
	}

	if err := s.repo.HardDeleteWithQuota(deleteCtx, ownerID, fileID, extra...); err != nil {
		return fmt.Errorf("delete file metadata: %w", err)
	}
	return nil
}

func (s *Service) Move(ctx context.Context, input MoveInput) error {
	if input.OwnerID == 0 {
		return errors.New("owner id is required")
	}
	if input.FileID == 0 {
		return errors.New("file id is required")
	}

	record, err := s.repo.GetByID(ctx, input.OwnerID, input.FileID)
	if err != nil {
		return fmt.Errorf("get file for move: %w", err)
	}

	if err := s.folders.EnsureOwned(ctx, input.OwnerID, input.TargetFolderID); err != nil {
		return fmt.Errorf("validate target folder: %w", err)
	}
	if record.FolderID == input.TargetFolderID {
		return nil
	}

	if err := s.repo.Move(ctx, input.OwnerID, input.FileID, input.TargetFolderID); err != nil {
		return fmt.Errorf("move file: %w", err)
	}

	return nil
}

func (s *Service) Rename(ctx context.Context, input RenameInput) error {
	if input.OwnerID == 0 {
		return errors.New("owner id is required")
	}

	if input.FileID == 0 {
		return errors.New("file id is required")
	}

	newName := strings.TrimSpace(input.NewName)
	if !validFileName(newName) {
		return ErrInvalidFileName
	}

	record, err := s.repo.GetByID(ctx, input.OwnerID, input.FileID)

	if err != nil {
		return fmt.Errorf("get file for rename: %w", err)
	}

	if record.OriginalName == newName {
		return nil
	}

	if err := s.repo.Rename(ctx, input.OwnerID, input.FileID, newName); err != nil {
		return fmt.Errorf("rename file: %w", err)
	}

	return nil
}

func (s *Service) Search(ctx context.Context, input SearchInput) (*ListResult, error) {
	if input.OwnerID == 0 {
		return nil, errors.New("owner id is required")
	}

	keyword := strings.TrimSpace(input.Keyword)
	if keyword == "" || utf8.RuneCountInString(keyword) > 100 {
		return nil, ErrInvalidSearchKeyword
	}

	page := input.Page
	if page < 1 {
		page = 1
	}
	if page > 10000 {
		return nil, errors.New("page must not exceed 10000")
	}

	pageSize := input.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	files, total, err := s.repo.SearchByName(ctx, input.OwnerID, keyword, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, fmt.Errorf("search files: %w", err)
	}
	if files == nil {
		files = []File{}
	}

	return &ListResult{
		Items:    files,
		Page:     page,
		PageSize: pageSize,
		Total:    total,
	}, nil
}

func (s *Service) StorageUsage(ctx context.Context, ownerID uint64) (*StorageUsageResult, error) {
	if ownerID == 0 {
		return nil, errors.New("owner id is required")
	}

	usedBytes, err := s.repo.UsedBytes(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("get storage usage: %w", err)
	}

	quotaBytes, err := s.repo.QuotaBytes(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("get storage usage: %w", err)
	}

	return &StorageUsageResult{
		UsedBytes:  usedBytes,
		QuotaBytes: quotaBytes,
	}, nil
}

func validFileName(name string) bool {
	length := utf8.RuneCountInString(name)
	if length < 1 || length > 255 {
		return false
	}

	if name == "." || name == ".." {
		return false
	}

	if strings.ContainsAny(name, `/\`) {
		return false
	}

	for _, character := range name {
		if unicode.IsControl(character) {
			return false
		}
	}

	return true
}
