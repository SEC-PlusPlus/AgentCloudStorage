package share

import "time"

// Reasons carried by *ErrShareGone when a share exists but is unavailable
// to visitors (spec §3 status matrix).
const (
	ReasonRevoked         = "revoked"
	ReasonExpired         = "expired"
	ReasonFileUnavailable = "file_unavailable"
)

type Share struct {
	ID            uint64     `gorm:"column:id;primaryKey"`
	Token         string     `gorm:"column:token"`
	OwnerID       uint64     `gorm:"column:owner_id"`
	FileID        uint64     `gorm:"column:file_id"`
	DisplayName   string     `gorm:"column:display_name"`
	PasswordHash  *string    `gorm:"column:password_hash"`
	ExpiresAt     *time.Time `gorm:"column:expires_at"`
	DownloadCount int        `gorm:"column:download_count"`
	RevokedAt     *time.Time `gorm:"column:revoked_at"`
	CreatedAt     time.Time  `gorm:"column:created_at"`
	UpdatedAt     time.Time  `gorm:"column:updated_at"`
}

func (Share) TableName() string {
	return "share_links"
}
