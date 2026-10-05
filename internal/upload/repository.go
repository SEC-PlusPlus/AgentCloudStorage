package upload

import (
	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/storage"
	"context"
)

type Repository interface {
	GetByID(ctx context.Context, ownerID uint64, sessionID string) (*Session, error)
	ListParts(ctx context.Context, ownerID uint64, sessionID string) ([]Part, error)
	CreateWithQuota(ctx context.Context, session *Session) error
	SavePart(ctx context.Context, ownerID uint64, sessionID string, part Part) error
	BeginComplete(ctx context.Context, ownerID uint64, sessionID string) (*Session, []Part, error)
	FinalizeWithQuota(ctx context.Context, ownerID uint64, sessionID string, info storage.ObjectInfo) (*file.File, error)
	CancelWithQuota(ctx context.Context, ownerID uint64, sessionID string) (*Session, error)
}
