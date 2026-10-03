package user

import "time"

type Status uint8

const (
	StatusActive   Status = 1
	StatusDisabled Status = 2
)

type User struct {
	ID           uint64    `gorm:"column:id;primaryKey"`
	Username     string    `gorm:"column:username"`
	Email        string    `gorm:"column:email"`
	PasswordHash string    `gorm:"column:password_hash" json:"-"`
	Status       Status    `gorm:"column:status"`
	CreatedAt    time.Time `gorm:"column:created_at"`
	UpdatedAt    time.Time `gorm:"column:updated_at"`
}

func (User) TableName() string {
	return "users"
}
