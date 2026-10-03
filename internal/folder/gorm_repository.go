package folder

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
)

type GORMRepository struct{ db *gorm.DB }

func NewGORMRepository(db *gorm.DB) *GORMRepository {
	return &GORMRepository{
		db: db,
	}
}

func (r *GORMRepository) Create(ctx context.Context, folder *Folder) error {
	if folder == nil {
		return errors.New("folder is required")
	}

	err := r.db.WithContext(ctx).
		Create(folder).
		Error

	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return ErrFolderAlreadyExists
	}
	if err != nil {
		return fmt.Errorf("create folder: %w", err)
	}

	return nil
}

func (r *GORMRepository) ListByParent(ctx context.Context, ownerID uint64, parentID uint64) ([]Folder, error) {
	var folders []Folder

	err := r.db.WithContext(ctx).
		Where(
			"owner_id = ? AND parent_id = ?",
			ownerID,
			parentID,
		).
		Order("name ASC, id ASC").
		Find(&folders).
		Error
	if err != nil {
		return nil, fmt.Errorf(
			"list folders by parent: %w",
			err,
		)
	}

	if folders == nil {
		folders = []Folder{}
	}

	return folders, nil
}

func (r *GORMRepository) GetByID(ctx context.Context, ownerID uint64, folderID uint64) (*Folder, error) {
	var record Folder

	err := r.db.WithContext(ctx).
		Where(
			"id = ? AND owner_id = ?",
			folderID,
			ownerID,
		).
		First(&record).
		Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrFolderNotFound
	}

	if err != nil {
		return nil, fmt.Errorf(
			"get folder by id: %w",
			err,
		)
	}

	return &record, nil
}

func (r *GORMRepository) Rename(ctx context.Context, ownerID uint64, folderID uint64, newName string) error {
	result := r.db.WithContext(ctx).Model(&Folder{}).
		Where("id = ? AND owner_id = ?", folderID, ownerID).
		Update("name", newName)

	if errors.Is(result.Error, gorm.ErrDuplicatedKey) {
		return ErrFolderAlreadyExists
	}

	if result.Error != nil {
		return fmt.Errorf("rename folder: %w", result.Error)
	}

	if result.RowsAffected == 0 {
		return ErrFolderNotFound
	}

	return nil
}

func (r *GORMRepository) HasChildFolders(ctx context.Context, ownerID uint64, folderID uint64) (bool, error) {
	var count int64

	err := r.db.WithContext(ctx).
		Model(&Folder{}).
		Where("owner_id = ? AND parent_id = ?", ownerID, folderID).
		Count(&count).
		Error
	if err != nil {
		return false, fmt.Errorf("count child folders: %w", err)
	}

	return count > 0, nil
}

func (r *GORMRepository) Delete(ctx context.Context, ownerID uint64, folderID uint64) error {
	result := r.db.WithContext(ctx).
		Where("id = ? AND owner_id = ?", folderID, ownerID).
		Delete(&Folder{})

	if result.Error != nil {
		return fmt.Errorf("delete folder: %w", result.Error)
	}

	if result.RowsAffected == 0 {
		return ErrFolderNotFound
	}

	return nil
}

func (r *GORMRepository) Move(ctx context.Context, ownerID uint64, folderID uint64, targetParentID uint64) error {
	result := r.db.WithContext(ctx).
		Model(&Folder{}).
		Where("id = ? AND owner_id = ?", folderID, ownerID).
		Update("parent_id", targetParentID)

	if errors.Is(result.Error, gorm.ErrDuplicatedKey) {
		return ErrFolderAlreadyExists
	}

	if result.Error != nil {
		return fmt.Errorf("move folder: %w", result.Error)
	}

	if result.RowsAffected == 0 {
		return ErrFolderNotFound
	}

	return nil
}

var _ Repository = (*GORMRepository)(nil)
