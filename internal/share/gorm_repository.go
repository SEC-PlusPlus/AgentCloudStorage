package share

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// "Active" per spec §5: not revoked and not expired, judged by the DB clock.
const activeCondition = "revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())"

type GORMRepository struct {
	db *gorm.DB
}

func NewGORMRepository(db *gorm.DB) *GORMRepository {
	return &GORMRepository{
		db: db,
	}
}

func (r *GORMRepository) Create(ctx context.Context, share *Share) error {
	if share == nil {
		return errors.New("share is required")
	}

	return r.db.WithContext(ctx).Create(share).Error
}

func (r *GORMRepository) GetByToken(ctx context.Context, token string) (*Share, error) {
	var record Share

	err := r.db.WithContext(ctx).Where("token = ?", token).First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrShareNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get share by token: %w", err)
	}
	return &record, nil
}

func (r *GORMRepository) GetByID(ctx context.Context, shareID uint64) (*Share, error) {
	var record Share

	err := r.db.WithContext(ctx).Where("id = ?", shareID).First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrShareNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get share by id: %w", err)
	}
	return &record, nil
}

func (r *GORMRepository) ListByOwner(ctx context.Context, ownerID uint64) ([]Share, error) {
	var shares []Share

	if err := r.db.WithContext(ctx).
		Model(&Share{}).
		Where("owner_id = ?", ownerID).
		Order("created_at DESC, id DESC").
		Find(&shares).Error; err != nil {
		return nil, fmt.Errorf("list shares by owner: %w", err)
	}

	return shares, nil
}

func (r *GORMRepository) CountActiveByFile(ctx context.Context, fileID uint64) (int, error) {
	var count int64

	if err := r.db.WithContext(ctx).
		Model(&Share{}).
		Where("file_id = ?", fileID).
		Where(activeCondition).
		Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count active shares by file: %w", err)
	}

	return int(count), nil
}

func (r *GORMRepository) CountActiveByOwner(ctx context.Context, ownerID uint64) (int, error) {
	var count int64

	if err := r.db.WithContext(ctx).
		Model(&Share{}).
		Where("owner_id = ?", ownerID).
		Where(activeCondition).
		Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count active shares by owner: %w", err)
	}

	return int(count), nil
}

func (r *GORMRepository) Revoke(ctx context.Context, ownerID uint64, shareID uint64) error {
	now := time.Now()

	result := r.db.WithContext(ctx).
		Model(&Share{}).
		Where("id = ? AND owner_id = ? AND revoked_at IS NULL", shareID, ownerID).
		Update("revoked_at", now)
	if result.Error != nil {
		return fmt.Errorf("revoke share: %w", result.Error)
	}
	if result.RowsAffected > 0 {
		return nil
	}

	// Nothing was revoked: an already-revoked share stays a no-op (DELETE is
	// idempotent per spec §3); only unknown or foreign shares are not found.
	var total int64
	if err := r.db.WithContext(ctx).
		Model(&Share{}).
		Where("id = ? AND owner_id = ?", shareID, ownerID).
		Count(&total).Error; err != nil {
		return fmt.Errorf("check share ownership: %w", err)
	}
	if total == 0 {
		return ErrShareNotFound
	}
	return nil
}

func (r *GORMRepository) IncrementDownload(ctx context.Context, shareID uint64) error {
	result := r.db.WithContext(ctx).
		Model(&Share{}).
		Where("id = ?", shareID).
		UpdateColumn("download_count", gorm.Expr("download_count + 1"))
	if result.Error != nil {
		return fmt.Errorf("increment share download count: %w", result.Error)
	}
	return nil
}

func (r *GORMRepository) PurgeByFileTx(tx *gorm.DB, fileID uint64) error {
	if tx == nil {
		return errors.New("transaction is required")
	}

	if err := tx.Where("file_id = ?", fileID).Delete(&Share{}).Error; err != nil {
		return fmt.Errorf("purge shares by file: %w", err)
	}
	return nil
}

var _ Repository = (*GORMRepository)(nil)
