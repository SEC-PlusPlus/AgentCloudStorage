package file

import "time"

type Status uint8

const StatusActive Status = 1
const StatusDeleted Status = 2

type File struct {
	ID           uint64     `gorm:"column:id;primaryKey"`
	OwnerID      uint64     `gorm:"column:owner_id"`
	FolderID     uint64     `gorm:"column:folder_id"`
	OriginalName string     `gorm:"column:original_name"`
	ObjectKey    string     `gorm:"column:object_key"`
	Size         int64      `gorm:"column:size"`
	ContentType  string     `gorm:"column:content_type"`
	ETag         string     `gorm:"column:etag"`
	Status       Status     `gorm:"column:status"`
	CreatedAt    time.Time  `gorm:"column:created_at"`
	UpdatedAt    time.Time  `gorm:"column:updated_at"`
	DeletedAt    *time.Time `gorm:"column:deleted_at"`
}

func (File) TableName() string {
	return "files"
}
