package file

import (
	"PersonalCloudStorage/internal/storage"
	"context"
	"errors"
	"fmt"
	"io"
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

	objectKey := fmt.Sprintf("users/%d/%s", input.OwnerID, uuid.NewString())
	objectStored := false

	defer func() {
		if retErr == nil {
			return
		}

		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()

		if objectStored {
			if err := s.storage.Delete(cleanupCtx, objectKey); err != nil {
				retErr = errors.Join(retErr, fmt.Errorf("delete orphan object: %w", err))
			}
		}
		if err := s.repo.ReleaseQuota(cleanupCtx, input.OwnerID, input.Size); err != nil {
			retErr = errors.Join(retErr, fmt.Errorf("release upload quota: %w", err))
		}
	}()

	objectInfo, err := s.storage.Put(ctx, objectKey, input.Reader, input.Size, contentType)
	if err != nil {
		return nil, fmt.Errorf("upload object to storage: %w", err)
	}
	objectStored = true

	file := &File{
		OwnerID:      input.OwnerID,
		FolderID:     input.FolderID,
		OriginalName: name,
		ObjectKey:    objectInfo.Key,
		Size:         objectInfo.Size,
		ContentType:  objectInfo.ContentType,
		ETag:         objectInfo.ETag,
		Status:       StatusActive,
	}

	if err := s.repo.CreateWithQuota(ctx, file, input.Size); err != nil {
		return nil, fmt.Errorf("save file and quota: %w", err)
	}
	return file, nil
}

// instantUploadMaxAttempts bounds the retry loop over the acquire+create
// transaction (B1 review RF1). Concurrent same-sha probes take AcquireBlob's
// documented S→X upgrade deadlock (MySQL 1213) or block into 1205 — the
// integration suite proved it fires. Retry is cheap (no bytes moved) but must
// be bounded; exhaustion answers ErrBlobBusy (handler: 409).
const (
	instantUploadMaxAttempts = 4
	instantUploadRetryPause  = 2 * time.Millisecond
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
	for attempt := 1; attempt <= instantUploadMaxAttempts; attempt++ {
		if attempt > 1 {
			timer := time.NewTimer(time.Duration(attempt-1) * instantUploadRetryPause)
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

	if err := s.storage.Delete(deleteCtx, record.ObjectKey); err != nil {
		return fmt.Errorf("delete object from storage: %w", err)
	}

	// spec §5.4 cascade: share links die with their object, purged inside the
	// same transaction as the row/quota delete. extra is a slice so the
	// B-track blob-release hook can join it later without reshaping callers.
	var extra []func(tx *gorm.DB) error
	if s.sharePurger != nil {
		purger := s.sharePurger
		extra = append(extra, func(tx *gorm.DB) error {
			return purger.PurgeByFileTx(tx, fileID)
		})
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
