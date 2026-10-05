package upload

import "time"

type Status uint8

const (
	StatusUploading  Status = 1
	StatusCompleting Status = 2
	StatusCompleted  Status = 3
	StatusCancelled  Status = 4
)

type Session struct {
	ID            string    `gorm:"column:id;primaryKey"`
	OwnerID       uint64    `gorm:"column:owner_id"`
	FolderID      uint64    `gorm:"column:folder_id"`
	OriginalName  string    `gorm:"column:original_name"`
	ObjectKey     string    `gorm:"column:object_key"`
	MinIOUploadID string    `gorm:"column:minio_upload_id"`
	Size          int64     `gorm:"column:size"`
	PartSize      int64     `gorm:"column:part_size"`
	ContentType   string    `gorm:"column:content_type"`
	Status        Status    `gorm:"column:status"`
	FileID        *uint64   `gorm:"column:file_id"`
	ExpiresAt     time.Time `gorm:"column:expires_at"`
	CreatedAt     time.Time `gorm:"column:created_at"`
	UpdatedAt     time.Time `gorm:"column:updated_at"`
}

func (Session) TableName() string { return "upload_sessions" }

type Part struct {
	SessionID  string    `gorm:"column:session_id;primaryKey"`
	PartNumber int       `gorm:"column:part_number;primaryKey"`
	Size       int64     `gorm:"column:size"`
	ETag       string    `gorm:"column:etag"`
	CreatedAt  time.Time `gorm:"column:created_at"`
}

func (Part) TableName() string { return "upload_parts" }
