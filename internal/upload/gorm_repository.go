package upload

import (
	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/storage"
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type GORMRepository struct {
	db *gorm.DB
}

func NewGORMRepository(db *gorm.DB) *GORMRepository {
	return &GORMRepository{db: db}
}

func (r *GORMRepository) GetByID(ctx context.Context, ownerID uint64, sessionID string) (*Session, error) {
	var session Session
	err := r.db.WithContext(ctx).
		Where("id = ? AND owner_id = ?", sessionID, ownerID).
		First(&session).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrSessionNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get upload session: %w", err)
	}
	return &session, nil
}

func (r *GORMRepository) ListParts(ctx context.Context, ownerID uint64, sessionID string) ([]Part, error) {
	// 先确认该会话属于当前用户，不能只凭 sessionID 读取分片。
	if _, err := r.GetByID(ctx, ownerID, sessionID); err != nil {
		return nil, err
	}
	var parts []Part
	err := r.db.WithContext(ctx).
		Where("session_id = ?", sessionID).
		Order("part_number ASC").
		Find(&parts).Error
	if err != nil {
		return nil, fmt.Errorf("list uploaded parts: %w", err)
	}
	return parts, nil
}

func (r *GORMRepository) CreateWithQuota(ctx context.Context, session *Session) error {
	if session == nil {
		return errors.New("upload session is required")
	}
	if session.OwnerID == 0 || session.Size <= 0 || session.PartSize <= 0 {
		return errors.New("invalid upload session")
	}

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Table("users").
			Where(
				"id = ? AND used_bytes <= quota_bytes "+
					"AND reserved_bytes <= quota_bytes - used_bytes "+
					"AND ? <= quota_bytes - used_bytes - reserved_bytes",
				session.OwnerID, session.Size,
			).
			UpdateColumn(
				"reserved_bytes",
				gorm.Expr("reserved_bytes + ?", session.Size),
			)

		if result.Error != nil {
			return fmt.Errorf("reserve upload quota: %w", result.Error)
		}
		if result.RowsAffected == 0 {
			return ErrQuotaExceeded
		}

		if err := tx.Create(session).Error; err != nil {
			return fmt.Errorf("create upload session: %w", err)
		}
		return nil
	})
}

func (r *GORMRepository) SavePart(ctx context.Context, ownerID uint64, sessionID string, part Part) error {
	if part.PartNumber < 1 || part.Size <= 0 || part.ETag == "" {
		return errors.New("invalid uploaded part")
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var session Session
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", sessionID, ownerID).
			First(&session).Error

		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSessionNotFound
		}
		if err != nil {
			return fmt.Errorf("get upload session: %w", err)
		}
		if session.Status != StatusUploading ||
			!session.ExpiresAt.After(time.Now()) {
			return ErrSessionNotUploading
		}

		part.SessionID = sessionID
		err = tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "session_id"},
				{Name: "part_number"},
			},
			DoUpdates: clause.AssignmentColumns([]string{"size", "etag"}),
		}).Create(&part).Error
		if err != nil {
			return fmt.Errorf("save uploaded part: %w", err)
		}
		return nil
	})
}

func (r *GORMRepository) BeginComplete(ctx context.Context, ownerID uint64, sessionID string) (*Session, []Part, error) {
	var session Session
	var parts []Part

	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", sessionID, ownerID).
			First(&session).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSessionNotFound
		}
		if err != nil {
			return fmt.Errorf("get upload session: %w", err)
		}
		if session.Status != StatusUploading ||
			!session.ExpiresAt.After(time.Now()) {
			return ErrSessionNotUploading
		}

		if err := tx.Where("session_id = ?", sessionID).
			Order("part_number ASC").
			Find(&parts).Error; err != nil {
			return fmt.Errorf("list parts for completion: %w", err)
		}
		if _, err := prepareParts(&session, parts); err != nil {
			return err
		}

		result := tx.Model(&Session{}).
			Where("id = ? AND owner_id = ? AND status = ?",
				sessionID, ownerID, StatusUploading).
			Update("status", StatusCompleting)
		if result.Error != nil {
			return fmt.Errorf("mark upload completing: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return ErrSessionNotUploading
		}

		session.Status = StatusCompleting
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return &session, parts, nil
}

func (r *GORMRepository) FinalizeWithQuota(ctx context.Context, ownerID uint64, sessionID string, info storage.ObjectInfo) (*file.File, error) {
	var saved file.File

	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var session Session
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", sessionID, ownerID).
			First(&session).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSessionNotFound
		}
		if err != nil {
			return fmt.Errorf("get upload session: %w", err)
		}

		// 重复请求不能再次扣容量、再次创建文件。
		if session.Status == StatusCompleted {
			if session.FileID == nil {
				return errors.New("completed session has no file id")
			}
			return tx.Where("id = ? AND owner_id = ? AND object_key = ?",
				*session.FileID, ownerID, session.ObjectKey).
				First(&saved).Error
		}
		if session.Status != StatusCompleting {
			return ErrSessionNotCompleting
		}
		if info.Key != session.ObjectKey ||
			info.Size != session.Size ||
			info.ETag == "" {
			return errors.New("completed object does not match upload session")
		}

		result := tx.Table("users").
			Where(
				"id = ? AND reserved_bytes >= ? "+
					"AND used_bytes <= quota_bytes "+
					"AND ? <= quota_bytes - used_bytes",
				ownerID, session.Size, info.Size,
			).
			Updates(map[string]any{
				"reserved_bytes": gorm.Expr("reserved_bytes - ?", session.Size),
				"used_bytes":     gorm.Expr("used_bytes + ?", info.Size),
			})
		if result.Error != nil {
			return fmt.Errorf("settle upload quota: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return errors.New("upload quota reservation is inconsistent")
		}

		saved = file.File{
			OwnerID:      ownerID,
			FolderID:     session.FolderID,
			OriginalName: session.OriginalName,
			ObjectKey:    session.ObjectKey,
			Size:         info.Size,
			ContentType:  session.ContentType,
			ETag:         info.ETag,
			Status:       file.StatusActive,
		}
		if err := tx.Create(&saved).Error; err != nil {
			return fmt.Errorf("create completed file: %w", err)
		}

		result = tx.Model(&Session{}).
			Where("id = ? AND owner_id = ? AND status = ?",
				sessionID, ownerID, StatusCompleting).
			Updates(map[string]any{
				"status":  StatusCompleted,
				"file_id": saved.ID,
			})
		if result.Error != nil {
			return fmt.Errorf("mark upload completed: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return ErrSessionNotCompleting
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &saved, nil
}

func (r *GORMRepository) CancelWithQuota(ctx context.Context, ownerID uint64, sessionID string) (*Session, error) {
	var session Session

	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", sessionID, ownerID).
			First(&session).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSessionNotFound
		}
		if err != nil {
			return fmt.Errorf("get upload session: %w", err)
		}

		if session.Status == StatusCancelled {
			return nil // 重试时不重复释放容量
		}
		if session.Status != StatusUploading {
			return ErrSessionNotUploading
		}

		result := tx.Table("users").
			Where("id = ? AND reserved_bytes >= ?", ownerID, session.Size).
			UpdateColumn(
				"reserved_bytes",
				gorm.Expr("reserved_bytes - ?", session.Size),
			)
		if result.Error != nil {
			return fmt.Errorf("release upload quota: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return errors.New("upload quota reservation is inconsistent")
		}

		result = tx.Model(&Session{}).
			Where("id = ? AND owner_id = ? AND status = ?",
				sessionID, ownerID, StatusUploading).
			Update("status", StatusCancelled)
		if result.Error != nil {
			return fmt.Errorf("mark upload cancelled: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return ErrSessionNotUploading
		}

		session.Status = StatusCancelled
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &session, nil
}
