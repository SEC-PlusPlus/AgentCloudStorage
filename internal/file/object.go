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
// blobs: "blobs/<sha256 hex>". Callers that first pass validateBlobSha256 get
// a key that is always exactly len("blobs/")+64 = 70 chars — comfortably
// inside objects.object_key VARCHAR(255), so no separate key-length guard is
// needed at the primitive.
func BlobObjectKey(sha256 string) string {
	return "blobs/" + sha256
}

// maxBlobContentTypeLen is the width of objects.content_type VARCHAR(127)
// (spec §2.1); files.content_type is VARCHAR(255).
const maxBlobContentTypeLen = 127

// ClampContentType normalizes a content type to the objects column width.
// Deliberate fork (B1 review RF2): CLAMP, not reject — a long client MIME must
// not hard-fail an otherwise-valid upload. INSERT IGNORE cannot be trusted
// here because it downgrades ALL errors to warnings, so an over-long value
// would silently truncate in objects while the files row kept the full string.
// VARCHAR(127) counts characters in utf8mb4, so we cut after 127 runes.
// Consistency contract for callers (B3/B4): persist the files row's
// content_type from the returned Object.ContentType (or call this helper
// first) — never re-derive it from raw client input.
func ClampContentType(s string) string {
	// Byte fast path: ≤127 bytes implies ≤127 runes.
	if len(s) <= maxBlobContentTypeLen {
		return s
	}
	if r := []rune(s); len(r) > maxBlobContentTypeLen {
		return string(r[:maxBlobContentTypeLen])
	}
	return s
}

// validateBlobSha256 enforces the §2.1 identity rule: 64 lowercase hex chars.
func validateBlobSha256(sha256 string) error {
	if len(sha256) != 64 {
		return ErrInvalidSha256
	}
	for i := 0; i < len(sha256); i++ {
		c := sha256[i]
		if !(('0' <= c && c <= '9') || ('a' <= c && c <= 'f')) {
			return ErrInvalidSha256
		}
	}
	return nil
}
