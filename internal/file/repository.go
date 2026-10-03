package file

import "context"

type Repository interface {
	Create(ctx context.Context, file *File) error
	ListByStatus(ctx context.Context, ownerID uint64, status Status, limit int, offset int) ([]File, int64, error)
	GetByID(ctx context.Context, ownerID uint64, fileID uint64) (*File, error)
	SoftDelete(ctx context.Context, ownerID uint64, fileID uint64) error
	Restore(ctx context.Context, ownerID uint64, fileID uint64) error
	GetDeletedByID(ctx context.Context, ownerID uint64, fileID uint64) (*File, error)
	HardDeleteWithQuota(ctx context.Context, ownerID uint64, fileID uint64) error
	ListByFolderAndStatus(ctx context.Context, ownerID uint64, folderID uint64, status Status, limit int, offset int) ([]File, int64, error)
	Move(ctx context.Context, ownerID uint64, fileID uint64, targetFolderID uint64) error
	Rename(ctx context.Context, ownerID uint64, fileID uint64, newName string) error
	HasFilesInFolder(ctx context.Context, ownerID uint64, folderID uint64) (bool, error)
	SearchByName(ctx context.Context, ownerID uint64, keyword string, limit int, offset int) ([]File, int64, error)
	UsedBytes(ctx context.Context, ownerID uint64) (int64, error)
	ReserveQuota(ctx context.Context, ownerID uint64, size int64) error
	ReleaseQuota(ctx context.Context, ownerID uint64, size int64) error
	CreateWithQuota(ctx context.Context, file *File, reservedSize int64) error
}
