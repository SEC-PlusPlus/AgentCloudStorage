package upload

import (
	"context"
	"errors"
	"io"
	"testing"

	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/storage"
)

type completeStorageStub struct {
	completeInfo  storage.ObjectInfo
	completeErr   error
	statInfo      storage.ObjectInfo
	statErr       error
	completeCalls int
	statCalls     int
}

func (*completeStorageStub) StartMultipart(context.Context, string, string) (string, error) {
	return "", errors.New("unexpected StartMultipart call")
}

func (*completeStorageStub) UploadPart(context.Context, string, string, int, io.Reader, int64) (storage.UploadedPart, error) {
	return storage.UploadedPart{}, errors.New("unexpected UploadPart call")
}

func (s *completeStorageStub) CompleteMultipart(context.Context, string, string, []storage.UploadedPart) (storage.ObjectInfo, error) {
	s.completeCalls++
	return s.completeInfo, s.completeErr
}

func (*completeStorageStub) AbortMultipart(context.Context, string, string) error {
	return errors.New("unexpected AbortMultipart call")
}

func (s *completeStorageStub) Stat(context.Context, string) (storage.ObjectInfo, error) {
	s.statCalls++
	return s.statInfo, s.statErr
}

type completeRepositoryStub struct {
	session       *Session
	parts         []Part
	beginCalls    int
	finalizeCalls int
}

func (r *completeRepositoryStub) GetByID(context.Context, uint64, string) (*Session, error) {
	return r.session, nil
}

func (*completeRepositoryStub) ListParts(context.Context, uint64, string) ([]Part, error) {
	return nil, errors.New("unexpected ListParts call")
}

func (*completeRepositoryStub) CreateWithQuota(context.Context, *Session) error {
	return errors.New("unexpected CreateWithQuota call")
}

func (*completeRepositoryStub) SavePart(context.Context, uint64, string, Part) error {
	return errors.New("unexpected SavePart call")
}

func (*completeRepositoryStub) CancelWithQuota(context.Context, uint64, string) (*Session, error) {
	return nil, errors.New("unexpected CancelWithQuota call")
}

func (r *completeRepositoryStub) BeginComplete(context.Context, uint64, string) (*Session, []Part, error) {
	r.beginCalls++
	r.session.Status = StatusCompleting
	return r.session, r.parts, nil
}

func (r *completeRepositoryStub) FinalizeWithQuota(_ context.Context, _ uint64, _ string, info storage.ObjectInfo) (*file.File, error) {
	r.finalizeCalls++
	if r.session.Status != StatusCompleted && (info.Key != r.session.ObjectKey || info.Size != r.session.Size) {
		return nil, errors.New("unexpected object info")
	}
	r.session.Status = StatusCompleted
	return &file.File{ID: 42}, nil
}

func TestCompleteNewUpload(t *testing.T) {
	session := &Session{ID: "session", OwnerID: 1, ObjectKey: "object", MinIOUploadID: "minio", Size: 3, PartSize: 8 << 20, Status: StatusUploading}
	repo := &completeRepositoryStub{session: session, parts: []Part{{SessionID: session.ID, PartNumber: 1, Size: 3, ETag: "part-etag"}}}
	store := &completeStorageStub{completeInfo: storage.ObjectInfo{Key: session.ObjectKey, Size: session.Size, ETag: "object-etag"}}
	svc := NewService(store, repo, nil)

	saved, err := svc.Complete(context.Background(), 1, session.ID)
	if err != nil || saved == nil || saved.ID != 42 {
		t.Fatalf("Complete() = %#v, %v; want file 42", saved, err)
	}
	if repo.beginCalls != 1 || repo.finalizeCalls != 1 || store.completeCalls != 1 || store.statCalls != 0 {
		t.Fatalf("unexpected calls: begin=%d finalize=%d complete=%d stat=%d", repo.beginCalls, repo.finalizeCalls, store.completeCalls, store.statCalls)
	}
}

func TestCompleteRecoversMergedObject(t *testing.T) {
	session := &Session{ID: "session", OwnerID: 1, ObjectKey: "object", Size: 3, Status: StatusCompleting}
	repo := &completeRepositoryStub{session: session}
	store := &completeStorageStub{statInfo: storage.ObjectInfo{Key: session.ObjectKey, Size: session.Size, ETag: "object-etag"}}
	svc := NewService(store, repo, nil)

	saved, err := svc.Complete(context.Background(), 1, session.ID)
	if err != nil || saved == nil || saved.ID != 42 {
		t.Fatalf("Complete() = %#v, %v; want file 42", saved, err)
	}
	if repo.beginCalls != 0 || repo.finalizeCalls != 1 || store.completeCalls != 0 || store.statCalls != 1 {
		t.Fatalf("unexpected calls: begin=%d finalize=%d complete=%d stat=%d", repo.beginCalls, repo.finalizeCalls, store.completeCalls, store.statCalls)
	}
}

func TestCompleteAlreadyCompleted(t *testing.T) {
	session := &Session{ID: "session", OwnerID: 1, ObjectKey: "object", Status: StatusCompleted}
	repo := &completeRepositoryStub{session: session}
	store := &completeStorageStub{}
	svc := NewService(store, repo, nil)

	if _, err := svc.Complete(context.Background(), 1, session.ID); err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if repo.beginCalls != 0 || repo.finalizeCalls != 1 || store.completeCalls != 0 || store.statCalls != 0 {
		t.Fatalf("unexpected calls: begin=%d finalize=%d complete=%d stat=%d", repo.beginCalls, repo.finalizeCalls, store.completeCalls, store.statCalls)
	}
}

func TestCompleteRecoversAfterAmbiguousStorageError(t *testing.T) {
	session := &Session{ID: "session", OwnerID: 1, ObjectKey: "object", MinIOUploadID: "minio", Size: 3, PartSize: 8 << 20, Status: StatusUploading}
	repo := &completeRepositoryStub{session: session, parts: []Part{{SessionID: session.ID, PartNumber: 1, Size: 3, ETag: "part-etag"}}}
	store := &completeStorageStub{
		completeErr: errors.New("connection lost"),
		statInfo:    storage.ObjectInfo{Key: session.ObjectKey, Size: session.Size, ETag: "object-etag"},
	}
	svc := NewService(store, repo, nil)

	saved, err := svc.Complete(context.Background(), 1, session.ID)
	if err != nil || saved == nil || saved.ID != 42 {
		t.Fatalf("Complete() = %#v, %v; want file 42", saved, err)
	}
	if repo.beginCalls != 1 || repo.finalizeCalls != 1 || store.completeCalls != 1 || store.statCalls != 1 {
		t.Fatalf("unexpected calls: begin=%d finalize=%d complete=%d stat=%d", repo.beginCalls, repo.finalizeCalls, store.completeCalls, store.statCalls)
	}
}

func TestCompleteKeepsUncertainResultPending(t *testing.T) {
	session := &Session{ID: "session", OwnerID: 1, ObjectKey: "object", MinIOUploadID: "minio", Size: 3, PartSize: 8 << 20, Status: StatusUploading}
	repo := &completeRepositoryStub{session: session, parts: []Part{{SessionID: session.ID, PartNumber: 1, Size: 3, ETag: "part-etag"}}}
	store := &completeStorageStub{completeErr: errors.New("connection lost"), statErr: errors.New("storage unavailable")}
	svc := NewService(store, repo, nil)

	_, err := svc.Complete(context.Background(), 1, session.ID)
	if !errors.Is(err, ErrCompletionPending) {
		t.Fatalf("Complete() error = %v; want ErrCompletionPending", err)
	}
	if session.Status != StatusCompleting || repo.finalizeCalls != 0 || store.completeCalls != 1 || store.statCalls != 1 {
		t.Fatalf("unexpected state: status=%d finalize=%d complete=%d stat=%d", session.Status, repo.finalizeCalls, store.completeCalls, store.statCalls)
	}
}
