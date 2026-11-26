package share

import (
	"context"

	"gorm.io/gorm"
)

type Repository interface {
	Create(ctx context.Context, share *Share) error
	GetByToken(ctx context.Context, token string) (*Share, error)
	// GetByID resolves a share by primary key, backing Service.Access which
	// only carries the share ID inside the share-access JWT (spec §4).
	// Unknown IDs return ErrShareNotFound.
	GetByID(ctx context.Context, shareID uint64) (*Share, error)
	// ListByOwner includes revoked shares, newest first.
	ListByOwner(ctx context.Context, ownerID uint64) ([]Share, error)
	CountActiveByFile(ctx context.Context, fileID uint64) (int, error)
	CountActiveByOwner(ctx context.Context, ownerID uint64) (int, error)
	// Revoke is idempotent for already-revoked shares; only unknown or
	// foreign shares return ErrShareNotFound.
	Revoke(ctx context.Context, ownerID uint64, shareID uint64) error
	IncrementDownload(ctx context.Context, shareID uint64) error
	PurgeByFileTx(tx *gorm.DB, fileID uint64) error
}
