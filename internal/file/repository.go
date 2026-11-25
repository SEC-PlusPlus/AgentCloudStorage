package file

import (
	"context"

	"gorm.io/gorm"
)

type Repository interface {
	Create(ctx context.Context, file *File) error
	ListByStatus(ctx context.Context, ownerID uint64, status Status, limit int, offset int) ([]File, int64, error)
	GetByID(ctx context.Context, ownerID uint64, fileID uint64) (*File, error)
	SoftDelete(ctx context.Context, ownerID uint64, fileID uint64) error
	Restore(ctx context.Context, ownerID uint64, fileID uint64) error
	GetDeletedByID(ctx context.Context, ownerID uint64, fileID uint64) (*File, error)
	// HardDeleteWithQuota removes the row and its quota atomically. extra
	// hooks (share purge today, blob release later) run INSIDE that same
	// transaction after the row delete succeeded; a hook error aborts the
	// whole delete.
	HardDeleteWithQuota(ctx context.Context, ownerID uint64, fileID uint64, extra ...func(tx *gorm.DB) error) error
	ListByFolderAndStatus(ctx context.Context, ownerID uint64, folderID uint64, status Status, limit int, offset int) ([]File, int64, error)
	Move(ctx context.Context, ownerID uint64, fileID uint64, targetFolderID uint64) error
	Rename(ctx context.Context, ownerID uint64, fileID uint64, newName string) error
	HasFilesInFolder(ctx context.Context, ownerID uint64, folderID uint64) (bool, error)
	SearchByName(ctx context.Context, ownerID uint64, keyword string, limit int, offset int) ([]File, int64, error)
	UsedBytes(ctx context.Context, ownerID uint64) (int64, error)
	QuotaBytes(ctx context.Context, ownerID uint64) (int64, error)
	ReserveQuota(ctx context.Context, ownerID uint64, size int64) error
	ReleaseQuota(ctx context.Context, ownerID uint64, size int64) error
	CreateWithQuota(ctx context.Context, file *File, reservedSize int64) error

	// Blob primitives (instant-upload dedup, spec §5). AcquireBlob and
	// ReleaseBlob are transaction-scoped: they take the caller's *gorm.DB so
	// the refcount move commits atomically with the files-row write.
	// FindBlob is a plain read and answers ErrBlobNotFound on a miss.
	FindBlob(ctx context.Context, sha256 string) (*Object, error)
	AcquireBlob(tx *gorm.DB, sha256, contentType string, size int64) (*Object, bool, error)
	ReleaseBlob(tx *gorm.DB, sha256 string) (objectKey string, gone bool, err error)
}
