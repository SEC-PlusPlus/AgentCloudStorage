package storage

import (
	"context"
	"io"
	"time"
)

type ObjectInfo struct {
	Key          string
	Size         int64
	ContentType  string
	ETag         string
	LastModified time.Time
}

type ObjectStorage interface {
	Put(ctx context.Context, key string, src io.Reader, size int64, contentType string) (ObjectInfo, error)
	Get(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error)
	Stat(ctx context.Context, key string) (ObjectInfo, error)
	Delete(ctx context.Context, key string) error

	// List enumerates every object whose key starts with prefix (recursive),
	// returning at least Key/Size/LastModified per entry — cmd/blob-gc's input
	// (B5, spec §1.4). Same interface-extension precedent as Copy from B2:
	// every ObjectStorage implementation grows the method repo-wide.
	List(ctx context.Context, prefix string) ([]ObjectInfo, error)

	// Copy performs a server-side copy of srcKey to dstKey inside the same
	// bucket — no object bytes ever round-trip through this client. Dedup
	// uses it to promote a tmp upload key to the content-addressed
	// blobs/<sha256> placement. It returns an error when srcKey is missing.
	Copy(ctx context.Context, srcKey, dstKey string) error
}

type UploadedPart struct {
	Number int
	Size   int64
	ETag   string
}

type MultipartStorage interface {
	StartMultipart(ctx context.Context, key string, contentType string) (uploadID string, err error)

	UploadPart(ctx context.Context, key string, uploadID string, partNumber int, src io.Reader, size int64) (UploadedPart, error)

	CompleteMultipart(ctx context.Context, key string, uploadID string, parts []UploadedPart) (ObjectInfo, error)

	AbortMultipart(ctx context.Context, key string, uploadID string) error
}
