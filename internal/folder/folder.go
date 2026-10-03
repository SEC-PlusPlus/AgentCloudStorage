package folder

import "time"

type Folder struct {
	ID        uint64    `gorm:"column:id;primaryKey"`
	OwnerID   uint64    `gorm:"column:owner_id"`
	ParentID  uint64    `gorm:"column:parent_id"`
	Name      string    `gorm:"column:name"`
	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

func (Folder) TableName() string {
	return "folders"
}
