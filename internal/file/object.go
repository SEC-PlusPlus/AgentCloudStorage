package file

import "time"

// Object is one content-addressed physical blob (instant-upload spec §2.1).
// Identity is the sha256 hex of the content; several files rows may point at
// the same Object.object_key. refcount is the number of files rows (active or
// soft-deleted) referencing it; when a release drops it to zero the row is
// deleted immediately — no 0-refcount rows are left behind. Physical MinIO
// cleanup of the key is deliberately out of scope here (delayed GC command,
// spec §1.4).
type Object struct {
	Sha256      string    `gorm:"column:sha256;primaryKey"`
	ObjectKey   string    `gorm:"column:object_key"`
	ContentType string    `gorm:"column:content_type"`
	Size        int64     `gorm:"column:size"`
	Refcount    int       `gorm:"column:refcount"`
	CreatedAt   time.Time `gorm:"column:created_at"`
}

func (Object) TableName() string {
	return "objects"
}

// BlobObjectKey is the physical storage key convention for content-addressed
// blobs: "blobs/<sha256 hex>".
func BlobObjectKey(sha256 string) string {
	return "blobs/" + sha256
}
