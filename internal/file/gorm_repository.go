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
	extra ...func(tx *gorm.DB) error,
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

		// Hooks only run once the file row is provably gone, still in-tx:
		// a failing hook rolls the whole permanent delete back (spec §5.4).
		for _, hook := range extra {
			if err := hook(tx); err != nil {
				return err
			}
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

func (r *GORMRepository) QuotaBytes(ctx context.Context, ownerID uint64) (int64, error) {
	var quotaBytes int64

	err := r.db.WithContext(ctx).
		Table("users").
		Where("id = ?", ownerID).
		Select("quota_bytes").Row().Scan(&quotaBytes)
	if err != nil {
		return 0, fmt.Errorf("get user quota: %w", err)
	}

	return quotaBytes, nil
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

func (r *GORMRepository) FindBlob(ctx context.Context, sha256 string) (*Object, error) {
	var obj Object
	err := r.db.WithContext(ctx).Where("sha256 = ?", sha256).First(&obj).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrBlobNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find blob: %w", err)
	}
	return &obj, nil
}

// AcquireBlob inserts-or-adopts the objects row for sha256 and returns it
// locked for the remainder of tx, with refcount already incremented (new row:
// 1, existing row: +1). created reports whether this call inserted the row.
//
// Two-step per spec §5: INSERT IGNORE first, then SELECT ... FOR UPDATE.
// RowsAffected is trustworthy for "created" here and only here: the go-sql-
// driver reports changed rows, so INSERT IGNORE returns exactly 1 when the
// row was inserted and 0 when the duplicate was ignored — an unambiguous
// boolean. The usual upsert alternative is not: ON DUPLICATE KEY UPDATE would
// report 1/2/0 depending on whether the duplicate update changes anything,
// which cannot distinguish "pre-existing" from "inserted".
func (r *GORMRepository) AcquireBlob(tx *gorm.DB, sha256, contentType string, size int64) (*Object, bool, error) {
	result := tx.Clauses(clause.Insert{Modifier: "IGNORE"}).Create(&Object{
		Sha256:      sha256,
		ObjectKey:   BlobObjectKey(sha256),
		ContentType: contentType,
		Size:        size,
		Refcount:    1,
	})
	if result.Error != nil {
		return nil, false, fmt.Errorf("acquire blob insert: %w", result.Error)
	}
	created := result.RowsAffected == 1

	// Lock the row (or block until the racing inserter commits) so the
	// refcount read-back and increment are serialised against ReleaseBlob.
	var obj Object
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("sha256 = ?", sha256).First(&obj).Error
	if err != nil {
		return nil, false, fmt.Errorf("acquire blob lock: %w", err)
	}

	if !created {
		if err := tx.Model(&Object{}).Where("sha256 = ?", sha256).
			UpdateColumn("refcount", gorm.Expr("refcount + 1")).Error; err != nil {
			return nil, false, fmt.Errorf("acquire blob refcount: %w", err)
		}
		obj.Refcount++
	}
	return &obj, created, nil
}

// ReleaseBlob decrements the objects row for sha256. When refcount hits zero
// the row is deleted and (objectKey, true) is returned so the caller can hand
// the key to the delayed physical GC (spec §1.4); otherwise (objectKey, false).
// A row that is already gone (concurrent release raced to zero, or never
// existed) is a no-op: ("", false, nil) — releases are idempotent per file row.
func (r *GORMRepository) ReleaseBlob(tx *gorm.DB, sha256 string) (string, bool, error) {
	result := tx.Model(&Object{}).Where("sha256 = ?", sha256).
		UpdateColumn("refcount", gorm.Expr("refcount - 1"))
	if result.Error != nil {
		return "", false, fmt.Errorf("release blob: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return "", false, nil
	}

	var obj Object
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("sha256 = ?", sha256).First(&obj).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("read back blob refcount: %w", err)
	}
	if obj.Refcount > 0 {
		return obj.ObjectKey, false, nil
	}

	if err := tx.Where("sha256 = ?", sha256).Delete(&Object{}).Error; err != nil {
		return "", false, fmt.Errorf("delete zero-refcount blob: %w", err)
	}
	return obj.ObjectKey, true, nil
}

var _ Repository = (*GORMRepository)(nil)
