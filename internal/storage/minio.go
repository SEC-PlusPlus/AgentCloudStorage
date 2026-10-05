package storage

import (
	"context"
	"errors"
	"io"
	"sort"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type MinIOConfig struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	UseSSL    bool
}

type MinIOStorage struct {
	client *minio.Client
	bucket string
}

func NewMinIO(cfg MinIOConfig) (*MinIOStorage, error) {
	//校验
	if strings.TrimSpace(cfg.Endpoint) == "" {
		return nil, errors.New("minio endpoint is required")
	}
	if strings.TrimSpace(cfg.AccessKey) == "" {
		return nil, errors.New("minio access key is required")
	}
	if strings.TrimSpace(cfg.SecretKey) == "" {
		return nil, errors.New("minio secret key is required")
	}
	if strings.TrimSpace(cfg.Bucket) == "" {
		return nil, errors.New("minio bucket is required")
	}
	//连接客户端
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
	})
	if err != nil {
		return nil, err
	}
	return &MinIOStorage{
		client: client,
		bucket: cfg.Bucket,
	}, nil
}

func (s *MinIOStorage) Put(ctx context.Context, key string, src io.Reader, size int64, contentType string) (ObjectInfo, error) {
	result, err := s.client.PutObject(ctx, s.bucket, key, src, size, minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		return ObjectInfo{}, err
	}
	return ObjectInfo{
		Key:          key,
		Size:         result.Size,
		ContentType:  contentType,
		ETag:         result.ETag,
		LastModified: result.LastModified,
	}, nil
}

func (s *MinIOStorage) Get(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error) {
	object, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, ObjectInfo{}, err
	}
	info, err := object.Stat()
	if err != nil {
		_ = object.Close()
		return nil, ObjectInfo{}, err
	}
	return object, ObjectInfo{
		Key:          key,
		Size:         info.Size,
		ContentType:  info.ContentType,
		ETag:         info.ETag,
		LastModified: info.LastModified,
	}, nil
}

func (s *MinIOStorage) Stat(ctx context.Context, key string) (ObjectInfo, error) {
	info, err := s.client.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		return ObjectInfo{}, err
	}
	return ObjectInfo{
		Key:          key,
		Size:         info.Size,
		ContentType:  info.ContentType,
		ETag:         info.ETag,
		LastModified: info.LastModified,
	}, nil
}
func (s *MinIOStorage) Delete(ctx context.Context, key string) error {
	return s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}

func (s *MinIOStorage) StartMultipart(ctx context.Context, key string, contentType string) (string, error) {
	core := minio.Core{Client: s.client}
	return core.NewMultipartUpload(ctx, s.bucket, key, minio.PutObjectOptions{ContentType: contentType})
}

func (s *MinIOStorage) UploadPart(ctx context.Context, key string, uploadID string, partNumber int, src io.Reader, size int64) (UploadedPart, error) {
	core := minio.Core{Client: s.client}

	part, err := core.PutObjectPart(ctx, s.bucket, key, uploadID, partNumber, src, size, minio.PutObjectPartOptions{})
	if err != nil {
		return UploadedPart{}, err
	}

	return UploadedPart{
		Number: part.PartNumber,
		Size:   part.Size,
		ETag:   part.ETag,
	}, nil
}

func (s *MinIOStorage) CompleteMultipart(ctx context.Context, key string, uploadID string, parts []UploadedPart) (ObjectInfo, error) {
	if len(parts) == 0 {
		return ObjectInfo{}, errors.New("no parts to complete")
	}

	completed := make([]minio.CompletePart, 0, len(parts))
	for _, part := range parts {
		if part.Number < 1 || part.ETag == "" {
			return ObjectInfo{}, errors.New("invalid uploaded part")
		}

		completed = append(completed, minio.CompletePart{
			PartNumber: part.Number,
			ETag:       part.ETag,
		})
	}

	sort.Slice(completed, func(i, j int) bool {
		return completed[i].PartNumber < completed[j].PartNumber
	})
	for i := 1; i < len(completed); i++ {
		if completed[i].PartNumber == completed[i-1].PartNumber {
			return ObjectInfo{}, errors.New("duplicate part number")
		}
	}

	core := minio.Core{Client: s.client}
	_, err := core.CompleteMultipartUpload(ctx, s.bucket, key, uploadID, completed, minio.PutObjectOptions{})
	if err != nil {
		return ObjectInfo{}, err
	}

	return s.Stat(ctx, key)
}

func (s *MinIOStorage) AbortMultipart(ctx context.Context, key string, uploadID string) error {
	core := minio.Core{Client: s.client}
	err := core.AbortMultipartUpload(ctx, s.bucket, key, uploadID)
	if err != nil && minio.ToErrorResponse(err).Code == minio.NoSuchUpload {
		return nil
	}
	return err
}

// 编译期检查: MinIOStorage 是否完整实现了 ObjectStorage 的四个方法。
var _ ObjectStorage = (*MinIOStorage)(nil)
var _ MultipartStorage = (*MinIOStorage)(nil)
