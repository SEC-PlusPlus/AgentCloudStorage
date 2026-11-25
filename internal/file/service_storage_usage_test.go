package file

import (
	"context"
	"errors"
	"testing"

	"gorm.io/gorm"
)

// usageRepositoryStub implements Repository with the quota/usage methods backed
// by canned values; every other method fails loudly like the stubs elsewhere.
type usageRepositoryStub struct {
	usedBytes  int64
	quotaBytes int64
	usedErr    error
	quotaErr   error

	usedCalls  int
	quotaCalls int
}

func (*usageRepositoryStub) Create(context.Context, *File) error {
	return errors.New("unexpected Create call")
}

func (*usageRepositoryStub) ListByStatus(context.Context, uint64, Status, int, int) ([]File, int64, error) {
	return nil, 0, errors.New("unexpected ListByStatus call")
}

func (*usageRepositoryStub) GetByID(context.Context, uint64, uint64) (*File, error) {
	return nil, errors.New("unexpected GetByID call")
}

func (*usageRepositoryStub) SoftDelete(context.Context, uint64, uint64) error {
	return errors.New("unexpected SoftDelete call")
}

func (*usageRepositoryStub) Restore(context.Context, uint64, uint64) error {
	return errors.New("unexpected Restore call")
}

func (*usageRepositoryStub) GetDeletedByID(context.Context, uint64, uint64) (*File, error) {
	return nil, errors.New("unexpected GetDeletedByID call")
}

func (*usageRepositoryStub) HardDeleteWithQuota(context.Context, uint64, uint64, ...func(*gorm.DB) error) error {
	return errors.New("unexpected HardDeleteWithQuota call")
}

func (*usageRepositoryStub) ListByFolderAndStatus(context.Context, uint64, uint64, Status, int, int) ([]File, int64, error) {
	return nil, 0, errors.New("unexpected ListByFolderAndStatus call")
}

func (*usageRepositoryStub) Move(context.Context, uint64, uint64, uint64) error {
	return errors.New("unexpected Move call")
}

func (*usageRepositoryStub) Rename(context.Context, uint64, uint64, string) error {
	return errors.New("unexpected Rename call")
}

func (*usageRepositoryStub) HasFilesInFolder(context.Context, uint64, uint64) (bool, error) {
	return false, errors.New("unexpected HasFilesInFolder call")
}

func (*usageRepositoryStub) SearchByName(context.Context, uint64, string, int, int) ([]File, int64, error) {
	return nil, 0, errors.New("unexpected SearchByName call")
}

func (s *usageRepositoryStub) UsedBytes(context.Context, uint64) (int64, error) {
	s.usedCalls++
	return s.usedBytes, s.usedErr
}

func (s *usageRepositoryStub) QuotaBytes(context.Context, uint64) (int64, error) {
	s.quotaCalls++
	return s.quotaBytes, s.quotaErr
}

func (*usageRepositoryStub) ReserveQuota(context.Context, uint64, int64) error {
	return errors.New("unexpected ReserveQuota call")
}

func (*usageRepositoryStub) ReleaseQuota(context.Context, uint64, int64) error {
	return errors.New("unexpected ReleaseQuota call")
}

func (*usageRepositoryStub) CreateWithQuota(context.Context, *File, int64) error {
	return errors.New("unexpected CreateWithQuota call")
}

func (*usageRepositoryStub) FindBlob(context.Context, string) (*Object, error) {
	return nil, ErrBlobNotFound
}

func (*usageRepositoryStub) AcquireBlob(*gorm.DB, string, string, int64) (*Object, bool, error) {
	return nil, false, errors.New("unexpected AcquireBlob call")
}

func (*usageRepositoryStub) ReleaseBlob(*gorm.DB, string) (string, bool, error) {
	return "", false, errors.New("unexpected ReleaseBlob call")
}

func TestStorageUsageReturnsUsedAndQuotaBytes(t *testing.T) {
	repo := &usageRepositoryStub{usedBytes: 1234, quotaBytes: 56789}
	svc := NewService(nil, repo, nil)

	result, err := svc.StorageUsage(context.Background(), 7)
	if err != nil {
		t.Fatalf("StorageUsage returned error: %v", err)
	}
	if result.UsedBytes != 1234 {
		t.Errorf("UsedBytes = %d, want 1234", result.UsedBytes)
	}
	if result.QuotaBytes != 56789 {
		t.Errorf("QuotaBytes = %d, want 56789", result.QuotaBytes)
	}
	if repo.usedCalls != 1 || repo.quotaCalls != 1 {
		t.Errorf("repo calls used=%d quota=%d, want 1 and 1", repo.usedCalls, repo.quotaCalls)
	}
}

func TestStorageUsagePropagatesQuotaLookupError(t *testing.T) {
	repoErr := errors.New("boom")
	repo := &usageRepositoryStub{quotaErr: repoErr}
	svc := NewService(nil, repo, nil)

	_, err := svc.StorageUsage(context.Background(), 7)
	if !errors.Is(err, repoErr) {
		t.Fatalf("StorageUsage error = %v, want wrapped %v", err, repoErr)
	}
}
