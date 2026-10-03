package folder

import "context"

type Repository interface {
	Create(ctx context.Context, folder *Folder) error

	ListByParent(ctx context.Context, ownerID uint64, parentID uint64) ([]Folder, error)

	GetByID(ctx context.Context, ownerID uint64, folderID uint64) (*Folder, error)

	Rename(ctx context.Context, ownerID uint64, folderID uint64, newName string) error

	HasChildFolders(ctx context.Context, ownerID uint64, folderID uint64) (bool, error)

	Delete(ctx context.Context, ownerID uint64, folderID uint64) error

	Move(ctx context.Context, ownerID uint64, folderID uint64, targetParentID uint64) error
}
