package file

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type GORMRepository struct {
	db *gorm.DB
}

func NewGORMRepository(db *gorm.DB) *GORMRepository {
	return &GORMRepository{
		db: db,
	}
}

func (r *GORMRepository) Create(ctx context.Context, file *File) error {
	if file == nil {
		return errors.New("file is required")
	}

	return r.db.WithContext(ctx).Create(file).Error
}

func (r *GORMRepository) ListByStatus(ctx context.Context, ownerID uint64, status Status, limit int, offset int) ([]File, int64, error) {
	query := r.db.WithContext(ctx).Model(&File{}).Where("owner_id = ? AND status = ?", ownerID, status)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count files :%w", err)
	}

	var files []File
	if err := query.Order("created_at DESC, id DESC").Limit(limit).Offset(offset).Find(&files).Error; err != nil {
		return nil, 0, fmt.Errorf("list files:%w", err)
	}
	return files, total, nil
}

func (r *GORMRepository) GetByID(ctx context.Context, ownerID uint64, fileID uint64) (*File, error) {
	var record File
	err := r.db.WithContext(ctx).Where("id = ? AND owner_id = ? AND status = ?",
		fileID,
		ownerID,
		StatusActive).First(&record).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrFileNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get file by id:%w", err)
	}
	return &record, nil
}

func (r *GORMRepository) SoftDelete(ctx context.Context, ownerID uint64, fileID uint64) error {
	now := time.Now()

	result := r.db.WithContext(ctx).Model(&File{}).Where("id = ? AND owner_id = ? AND status = ?", fileID, ownerID, StatusActive).Updates(map[string]any{"status": StatusDeleted, "deleted_at": now, "updated_at": now})

	if result.Error != nil {
		return fmt.Errorf("soft delete file:%w", result.Error)
	}

	if result.RowsAffected == 0 {
		return ErrFileNotFound
	}

	return nil
}

func (r *GORMRepository) Restore(ctx context.Context, ownerID uint64, fileID uint64) error {
	now := time.Now()

	result := r.db.WithContext(ctx).Model(&File{}).Where("id = ? AND owner_id = ? AND status = ?", fileID, ownerID, StatusDeleted).Updates(map[string]any{"status": StatusActive, "deleted_at": nil, "updated_at": now})
	if result.Error != nil {
		return fmt.Errorf("restore file:%w", result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrFileNotFound
	}
	return nil
}

func (r *GORMRepository) GetDeletedByID(ctx context.Context, ownerID uint64, fileID uint64) (*File, error) {
	var record File

	err := r.db.WithContext(ctx).Where("id = ? AND owner_id = ? AND status = ?",
		fileID,
		ownerID,
		StatusDeleted).First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrFileNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get deleted file by id:%w", err)
	}
	return &record, nil
}

func (r *GORMRepository) HardDeleteWithQuota(
	ctx context.Context,
	ownerID uint64,
	fileID uint64,
) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var record File
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND status = ?",
				fileID, ownerID, StatusDeleted).
			First(&record).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrFileNotFound
		}
		if err != nil {
			return fmt.Errorf("get file for permanent deletion: %w", err)
		}

		if record.Size > 0 {
			result := tx.Table("users").
				Where("id = ? AND used_bytes >= ?", ownerID, record.Size).
				UpdateColumn("used_bytes", gorm.Expr("used_bytes - ?", record.Size))
			if result.Error != nil {
				return fmt.Errorf("decrease used quota: %w", result.Error)
			}
			if result.RowsAffected == 0 {
				return errors.New("used quota is inconsistent with file size")
			}
		}

		result := tx.Where("id = ? AND owner_id = ? AND status = ?",
			fileID, ownerID, StatusDeleted).
			Delete(&File{})
		if result.Error != nil {
			return fmt.Errorf("hard delete file: %w", result.Error)
		}
		if result.RowsAffected == 0 {
			return ErrFileNotFound
		}
		return nil
	})
}

func (r *GORMRepository) ListByFolderAndStatus(ctx context.Context, ownerID uint64, folderID uint64, status Status, limit int, offset int) ([]File, int64, error) {
	query := r.db.WithContext(ctx).Model(&File{}).Where(
		"owner_id = ? AND folder_id = ? AND status = ?",
		ownerID,
		folderID,
		status,
	)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count files by folder: %w", err)
	}

	var files []File
	if err := query.Order("created_at DESC, id DESC").Limit(limit).Offset(offset).Find(&files).Error; err != nil {
		return nil, 0, fmt.Errorf(
			"list files by folder: %w",
			err,
		)
	}

	return files, total, nil
}

func (r *GORMRepository) Move(ctx context.Context, ownerID uint64, fileID uint64, targetFolderID uint64) error {
	result := r.db.WithContext(ctx).Model(&File{}).Where("id = ? AND owner_id = ? AND status = ?", fileID, ownerID, StatusActive).Update("folder_id", targetFolderID)
	if result.Error != nil {
		return fmt.Errorf("move file: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrFileNotFound
	}
	return nil
}

func (r *GORMRepository) Rename(ctx context.Context, ownerID uint64, fileID uint64, newName string) error {
	result := r.db.WithContext(ctx).
		Model(&File{}).
		Where("id = ? AND owner_id = ? AND status = ?", fileID, ownerID, StatusActive).
		Update("original_name", newName)

	if result.Error != nil {
		return fmt.Errorf("rename file: %w", result.Error)
	}

	if result.RowsAffected == 0 {
		return ErrFileNotFound
	}

	return nil
}

func (r *GORMRepository) HasFilesInFolder(ctx context.Context, ownerID uint64, folderID uint64) (bool, error) {
	var count int64

	err := r.db.WithContext(ctx).
		Model(&File{}).
		Where("owner_id = ? AND folder_id = ?", ownerID, folderID).
		Count(&count).
		Error
	if err != nil {
		return false, fmt.Errorf(
			"count files in folder: %w",
			err,
		)
	}

	return count > 0, nil
}

func (r *GORMRepository) SearchByName(ctx context.Context, ownerID uint64, keyword string, limit int, offset int) ([]File, int64, error) {
	escaped := strings.NewReplacer(
		"!", "!!",
		"%", "!%",
		"_", "!_",
	).Replace(keyword)
	pattern := "%" + escaped + "%"

	query := r.db.WithContext(ctx).
		Model(&File{}).
		Where("owner_id = ? AND status = ? AND original_name LIKE ? ESCAPE '!'", ownerID, StatusActive, pattern)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count matching files: %w", err)
	}

	var files []File
	if err := query.
		Order("created_at DESC, id DESC").Limit(limit).Offset(offset).Find(&files).Error; err != nil {
		return nil, 0, fmt.Errorf("search files: %w", err)
	}

	return files, total, nil
}

func (r *GORMRepository) UsedBytes(ctx context.Context, ownerID uint64) (int64, error) {
	var usedBytes int64

	err := r.db.WithContext(ctx).
		Model(&File{}).Where("owner_id = ?", ownerID).Select("COALESCE(SUM(size), 0)").Row().Scan(&usedBytes)
	if err != nil {
		return 0, fmt.Errorf("sum file sizes: %w", err)
	}

	return usedBytes, nil
}

func (r *GORMRepository) ReserveQuota(ctx context.Context, ownerID uint64, size int64) error {
	if size < 0 {
		return errors.New("file size must not be negative")
	}
	if size == 0 {
		return nil
	}

	result := r.db.WithContext(ctx).
		Table("users").
		Where(
			"id = ? AND used_bytes <= quota_bytes "+
				"AND reserved_bytes <= quota_bytes - used_bytes "+
				"AND ? <= quota_bytes - used_bytes - reserved_bytes",
			ownerID, size,
		).
		UpdateColumn("reserved_bytes", gorm.Expr("reserved_bytes + ?", size))

	if result.Error != nil {
		return fmt.Errorf("reserve storage quota: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrQuotaExceeded
	}
	return nil
}

func (r *GORMRepository) ReleaseQuota(ctx context.Context, ownerID uint64, size int64) error {
	if size < 0 {
		return errors.New("file size must not be negative")
	}
	if size == 0 {
		return nil
	}

	result := r.db.WithContext(ctx).
		Table("users").
		Where("id = ? AND reserved_bytes >= ?", ownerID, size).
		UpdateColumn("reserved_bytes", gorm.Expr("reserved_bytes - ?", size))

	if result.Error != nil {
		return fmt.Errorf("release storage quota: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return errors.New("quota reservation not found")
	}
	return nil
}

func (r *GORMRepository) CreateWithQuota(
	ctx context.Context,
	file *File,
	reservedSize int64,
) error {
	if file == nil {
		return errors.New("file is required")
	}
	if reservedSize < 0 || file.Size < 0 || file.Size > reservedSize {
		return errors.New("invalid file size or reservation")
	}

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if reservedSize > 0 {
			result := tx.Table("users").
				Where(
					"id = ? AND reserved_bytes >= ? "+
						"AND used_bytes <= quota_bytes "+
						"AND ? <= quota_bytes - used_bytes",
					file.OwnerID, reservedSize, file.Size,
				).
				Updates(map[string]any{
					"reserved_bytes": gorm.Expr("reserved_bytes - ?", reservedSize),
					"used_bytes":     gorm.Expr("used_bytes + ?", file.Size),
				})

			if result.Error != nil {
				return fmt.Errorf("convert reserved quota: %w", result.Error)
			}
			if result.RowsAffected == 0 {
				return errors.New("quota reservation not found or quota exceeded")
			}
		}

		if err := tx.Create(file).Error; err != nil {
			return fmt.Errorf("create file metadata: %w", err)
		}
		return nil
	})
}

var _ Repository = (*GORMRepository)(nil)
