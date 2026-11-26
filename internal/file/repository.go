package file

import (
	"context"

	"gorm.io/gorm"
)

type Repository interface {
	Create(ctx context.Context, file *File) error
	ListByStatus(ctx context.Context, ownerID uint64, status Status, limit int, offset int) ([]File, int64, error)
	GetByID(ctx context.Context, ownerID uint64, fileID uint64) (*File, error)
	SoftDelete(ctx context.Context, ownerID uint64, fileID uint64) error
	Restore(ctx context.Context, ownerID uint64, fileID uint64) error
	GetDeletedByID(ctx context.Context, ownerID uint64, fileID uint64) (*File, error)
	// HardDeleteWithQuota removes the row and its quota atomically. extra
	// hooks (share purge) run INSIDE that same transaction after the row
	// delete succeeded; a hook error aborts the whole delete. Legacy rows
	// only (files.sha256 IS NULL): the object lives solely at this row's
	// object_key, so the service deletes the object BEFORE calling this.
	HardDeleteWithQuota(ctx context.Context, ownerID uint64, fileID uint64, extra ...func(tx *gorm.DB) error) error

	// HardDeleteWithBlobRelease is the B5 dedup-row twin (spec §1.3/§1.4):
	// ONE transaction that releases the blob reference FIRST (B3-M4: the
	// objects-first lock PREFIX shared with InstantCreate/DedupCreate — the
	// shared delete tail itself is files-row→users, legacy order unchanged),
	// then does HardDeleteWithQuota's exact guarded quota+row work, then the
	// extra hooks. It NEVER touches the storage layer: a zeroed
	// refcount deletes only the objects row; the physical blob waits for
	// cmd/blob-gc's safety window. InnoDB 1213/1205 surface verbatim for the
	// Service retry loop to classify.
	HardDeleteWithBlobRelease(ctx context.Context, ownerID uint64, fileID uint64, sha256 string, extra ...func(tx *gorm.DB) error) error
	ListByFolderAndStatus(ctx context.Context, ownerID uint64, folderID uint64, status Status, limit int, offset int) ([]File, int64, error)
	Move(ctx context.Context, ownerID uint64, fileID uint64, targetFolderID uint64) error
	Rename(ctx context.Context, ownerID uint64, fileID uint64, newName string) error
	HasFilesInFolder(ctx context.Context, ownerID uint64, folderID uint64) (bool, error)
	SearchByName(ctx context.Context, ownerID uint64, keyword string, limit int, offset int) ([]File, int64, error)
	UsedBytes(ctx context.Context, ownerID uint64) (int64, error)
	QuotaBytes(ctx context.Context, ownerID uint64) (int64, error)
	ReserveQuota(ctx context.Context, ownerID uint64, size int64) error
	ReleaseQuota(ctx context.Context, ownerID uint64, size int64) error

	// Blob primitives (instant-upload dedup, spec §5). AcquireBlob and
	// ReleaseBlob are transaction-scoped: they take the caller's *gorm.DB so
	// the refcount move commits atomically with the files-row write.
	// FindBlob is a plain read and answers ErrBlobNotFound on a miss.
	FindBlob(ctx context.Context, sha256 string) (*Object, error)
	AcquireBlob(tx *gorm.DB, sha256, contentType string, size int64) (*Object, bool, error)
	ReleaseBlob(tx *gorm.DB, sha256 string) (objectKey string, gone bool, err error)

	// InstantCreate (spec B3, §1.3/§4) runs the whole instant probe as ONE
	// transaction: locked blob read (miss → ErrBlobNotFound), AcquireBlob
	// refcount+1, quota consume (used+size ≤ quota else ErrQuotaExceeded),
	// files row insert with every content field taken from the acquired
	// Object. InnoDB 1213/1205 from the blob lock are classified by the
	// Service retry loop, not here.
	InstantCreate(ctx context.Context, ownerID uint64, in InstantInput) (*File, error)

	// DedupCreate (spec B4, §1.3/§4) runs the direct-upload dedup as ONE
	// transaction — the bytes are already promoted to blobs/<sha> by the
	// service before the call: AcquireBlob (created → objects row with the
	// clamped coarse content_type; hit → refcount+1 and the stored row wins),
	// reservation→usage conversion with CreateWithQuota's exact guarded SQL,
	// files row insert through the same newInstantFile provenance mapper
	// (all content fields from the acquired Object). A failed files insert
	// rolls the refcount move back with it — no ReleaseBlob compensation
	// exists because none can be needed. InnoDB 1213/1205 are classified by
	// the Service retry loop, not here.
	DedupCreate(ctx context.Context, in DedupCreateInput) (*File, error)
}
