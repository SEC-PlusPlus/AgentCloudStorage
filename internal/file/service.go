package file

import (
	"PersonalCloudStorage/internal/storage"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
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

type StorageUsageResult struct {
	UsedBytes int64
}

type FolderAuthorizer interface {
	EnsureOwned(ctx context.Context, ownerID uint64, folderID uint64) error
}

type Service struct {
	storage storage.ObjectStorage
	repo    Repository
	folders FolderAuthorizer
}

func NewService(objectStorage storage.ObjectStorage, repo Repository, folders FolderAuthorizer) *Service {
	return &Service{
		storage: objectStorage,
		repo:    repo,
		folders: folders,
	}
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
	if err := s.repo.HardDeleteWithQuota(deleteCtx, ownerID, fileID); err != nil {
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

	return &StorageUsageResult{
		UsedBytes: usedBytes,
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
