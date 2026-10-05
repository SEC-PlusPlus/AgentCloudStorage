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
