package upload

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/storage"

	"github.com/google/uuid"
)

const partSize int64 = 8 << 20 // 8 MiB
const maxParts int64 = 10000

type FolderAuthorizer interface {
	EnsureOwned(ctx context.Context, ownerID uint64, folderID uint64) error
}

type MultipartObjectStorage interface {
	storage.MultipartStorage
	Stat(ctx context.Context, key string) (storage.ObjectInfo, error)
}

type StartInput struct {
	OwnerID      uint64
	FolderID     uint64
	OriginalName string
	ContentType  string
	Size         int64
}

type UploadPartInput struct {
	OwnerID    uint64
	SessionID  string
	PartNumber int
	Size       int64
	Reader     io.Reader
}

type ProgressResult struct {
	SessionID     string
	Status        Status
	Size          int64
	PartSize      int64
	TotalParts    int64
	UploadedParts []int
	ExpiresAt     time.Time
}

type Service struct {
	storage MultipartObjectStorage
	repo    Repository
	folders FolderAuthorizer
}

func NewService(objectStorage MultipartObjectStorage, repo Repository, folders FolderAuthorizer) *Service {
	return &Service{
		storage: objectStorage,
		repo:    repo,
		folders: folders,
	}
}

func (s *Service) Start(ctx context.Context, input StartInput) (*Session, error) {
	name := strings.TrimSpace(input.OriginalName)
	nameLength := utf8.RuneCountInString(name)
	if input.OwnerID == 0 || nameLength < 1 || nameLength > 255 || name == "." || name == ".." || strings.ContainsAny(name, `/\`) || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return nil, errors.New("invalid upload input")
	}
	if input.Size <= 0 || (input.Size-1)/partSize+1 > maxParts {
		return nil, errors.New("invalid file size")
	}
	if err := s.folders.EnsureOwned(ctx, input.OwnerID, input.FolderID); err != nil {
		return nil, fmt.Errorf("validate upload folder: %w", err)
	}
	contentType := strings.TrimSpace(input.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	if len(contentType) > 255 || strings.ContainsAny(contentType, "\r\n") {
		return nil, errors.New("invalid content type")
	}
	objectKey := fmt.Sprintf("users/%d/%s", input.OwnerID, uuid.NewString())
	minioUploadID, err := s.storage.StartMultipart(ctx, objectKey, contentType)
	if err != nil {
		return nil, fmt.Errorf("start MinIO multipart upload: %w", err)
	}

	session := &Session{
		ID:            uuid.NewString(),
		OwnerID:       input.OwnerID,
		FolderID:      input.FolderID,
		OriginalName:  name,
		ObjectKey:     objectKey,
		MinIOUploadID: minioUploadID,
		Size:          input.Size,
		PartSize:      partSize,
		ContentType:   contentType,
		Status:        StatusUploading,
		ExpiresAt:     time.Now().Add(24 * time.Hour),
	}

	if err := s.repo.CreateWithQuota(ctx, session); err != nil {
		// 数据库失败时，撤销已经在 MinIO 发起的上传。
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()

		if abortErr := s.storage.AbortMultipart(cleanupCtx, objectKey, minioUploadID); abortErr != nil {
			return nil, errors.Join(fmt.Errorf("create upload session: %w", err), fmt.Errorf("abort orphan multipart upload: %w", abortErr))
		}
		return nil, fmt.Errorf("create upload session: %w", err)
	}

	return session, nil
}

func (s *Service) UploadPart(ctx context.Context, input UploadPartInput) (*Part, error) {
	if input.OwnerID == 0 || input.SessionID == "" || input.Reader == nil {
		return nil, errors.New("invalid upload part input")
	}

	session, err := s.repo.GetByID(ctx, input.OwnerID, input.SessionID)
	if err != nil {
		return nil, err
	}
	if session.Status != StatusUploading ||
		!session.ExpiresAt.After(time.Now()) {
		return nil, ErrSessionNotUploading
	}
	if session.Size <= 0 || session.PartSize <= 0 {
		return nil, errors.New("invalid upload session size")
	}

	partCount := (session.Size-1)/session.PartSize + 1
	if input.PartNumber < 1 || int64(input.PartNumber) > partCount {
		return nil, ErrInvalidPart
	}

	offset := int64(input.PartNumber-1) * session.PartSize
	expectedSize := session.PartSize
	if remaining := session.Size - offset; remaining < expectedSize {
		expectedSize = remaining
	}
	if input.Size != expectedSize {
		return nil, ErrInvalidPart
	}

	uploaded, err := s.storage.UploadPart(
		ctx,
		session.ObjectKey,
		session.MinIOUploadID,
		input.PartNumber,
		input.Reader,
		input.Size,
	)
	if err != nil {
		return nil, fmt.Errorf("upload part to MinIO: %w", err)
	}
	if uploaded.Number != input.PartNumber ||
		uploaded.Size != expectedSize ||
		uploaded.ETag == "" {
		return nil, errors.New("MinIO returned invalid part information")
	}

	part := Part{
		SessionID:  session.ID,
		PartNumber: uploaded.Number,
		Size:       uploaded.Size,
		ETag:       uploaded.ETag,
	}
	if err := s.repo.SavePart(ctx, input.OwnerID, session.ID, part); err != nil {
		return nil, fmt.Errorf("record uploaded part: %w", err)
	}
	return &part, nil
}

func (s *Service) Progress(ctx context.Context, ownerID uint64, sessionID string) (*ProgressResult, error) {
	session, err := s.repo.GetByID(ctx, ownerID, sessionID)
	if err != nil {
		return nil, err
	}

	parts, err := s.repo.ListParts(ctx, ownerID, sessionID)
	if err != nil {
		return nil, err
	}

	numbers := make([]int, 0, len(parts))
	for _, part := range parts {
		numbers = append(numbers, part.PartNumber)
	}

	return &ProgressResult{
		SessionID:     session.ID,
		Status:        session.Status,
		Size:          session.Size,
		PartSize:      session.PartSize,
		TotalParts:    (session.Size-1)/session.PartSize + 1,
		UploadedParts: numbers,
		ExpiresAt:     session.ExpiresAt,
	}, nil
}

func (s *Service) Complete(ctx context.Context, ownerID uint64, sessionID string) (*file.File, error) {
	if ownerID == 0 || strings.TrimSpace(sessionID) == "" {
		return nil, errors.New("invalid completion input")
	}

	session, err := s.repo.GetByID(ctx, ownerID, sessionID)
	if err != nil {
		return nil, err
	}

	switch session.Status {
	case StatusCompleted:
		// FinalizeWithQuota returns the existing file without settling quota again.
		return s.repo.FinalizeWithQuota(ctx, ownerID, sessionID, storage.ObjectInfo{})

	case StatusCompleting:
		// A previous request may have merged the object but failed to update MySQL.
		info, err := s.storage.Stat(ctx, session.ObjectKey)
		if err != nil {
			return nil, errors.Join(
				ErrCompletionPending,
				fmt.Errorf("inspect completed object: %w", err),
			)
		}
		return s.repo.FinalizeWithQuota(ctx, ownerID, sessionID, info)

	case StatusUploading:
		session, parts, err := s.repo.BeginComplete(ctx, ownerID, sessionID)
		if err != nil {
			return nil, err
		}

		completedParts, err := prepareParts(session, parts)
		if err != nil {
			return nil, errors.Join(ErrCompletionPending, err)
		}

		info, completeErr := s.storage.CompleteMultipart(
			ctx, session.ObjectKey, session.MinIOUploadID, completedParts,
		)
		if completeErr != nil {
			// The object may exist even if the completion request returned an error.
			statInfo, statErr := s.storage.Stat(ctx, session.ObjectKey)
			if statErr != nil {
				return nil, errors.Join(
					ErrCompletionPending,
					fmt.Errorf("complete multipart upload: %w", completeErr),
					fmt.Errorf("inspect object after error: %w", statErr),
				)
			}
			info = statInfo
		}

		saved, err := s.repo.FinalizeWithQuota(ctx, ownerID, sessionID, info)
		if err != nil {
			return nil, fmt.Errorf("finalize merged upload: %w", err)
		}
		return saved, nil

	default:
		return nil, ErrSessionNotUploading
	}
}

func (s *Service) Cancel(ctx context.Context, ownerID uint64, sessionID string) error {
	if ownerID == 0 || strings.TrimSpace(sessionID) == "" {
		return errors.New("invalid cancellation input")
	}

	session, err := s.repo.CancelWithQuota(ctx, ownerID, sessionID)
	if err != nil {
		return err
	}

	// 即使客户端断开，也尽量完成已经开始的清理。
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()

	if err := s.storage.AbortMultipart(cleanupCtx, session.ObjectKey, session.MinIOUploadID); err != nil {
		return fmt.Errorf("abort MinIO multipart upload: %w", err)
	}
	return nil
}
