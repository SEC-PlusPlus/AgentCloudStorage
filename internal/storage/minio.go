package storage

import (
	"context"
	"errors"
	"io"
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

// 编译期检查: MinIOStorage 是否完整实现了 ObjectStorage 的四个方法。
var _ ObjectStorage = (*MinIOStorage)(nil)
