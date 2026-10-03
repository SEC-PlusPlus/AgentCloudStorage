package user

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
)

type GORMRepository struct {
	db *gorm.DB
}

func NewGORMRepository(db *gorm.DB) *GORMRepository {
	return &GORMRepository{
		db: db,
	}
}

func (r *GORMRepository) Create(ctx context.Context, user *User) error {
	if user == nil {
		return errors.New("user is required")
	}

	err := r.db.WithContext(ctx).Create(user).Error
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return ErrUserAlreadyExists
	}
	if err != nil {
		return fmt.Errorf("create user: %w", err)
	}
	return nil
}

func (r *GORMRepository) GetByEmail(ctx context.Context, email string) (*User, error) {
	var record User
	err := r.db.WithContext(ctx).Where("email = ?", email).First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get user by email:%w", err)
	}
	return &record, nil
}

var _ Repository = (*GORMRepository)(nil)
