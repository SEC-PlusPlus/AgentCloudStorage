package httpapi

import (
	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/folder"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// fakes for the FileServiceAPI seam (precedent: ShareAPI in share_handler.go)
// ---------------------------------------------------------------------------

type fakeFileService struct {
	t *testing.T

	// instant behaviour
	instantResult *file.File
	instantErr    error
	instantInput  file.InstantInput
	instantCalls  int

	// upload behaviour (parity leg)
	uploadResult *file.File
	uploadErr    error
	uploadCalls  int

	// move behaviour (coexistence leg)
	moveErr   error
	moveCalls int

	// permanent-delete behaviour (B5 error faces)
	permanentDeleteErr   error
	permanentDeleteCalls int
}

var _ FileServiceAPI = (*fakeFileService)(nil)

func (f *fakeFileService) InstantUpload(_ context.Context, in file.InstantInput) (*file.File, error) {
	f.instantCalls++
	f.instantInput = in
	if f.instantErr != nil {
		return nil, f.instantErr
	}
	return f.instantResult, nil
}

func (f *fakeFileService) Upload(context.Context, file.UploadInput) (*file.File, error) {
	f.uploadCalls++
	if f.uploadErr != nil {
		return nil, f.uploadErr
	}
	return f.uploadResult, nil
}

func (f *fakeFileService) Move(_ context.Context, in file.MoveInput) error {
	f.moveCalls++
	_ = in
	return f.moveErr
}

func (f *fakeFileService) List(context.Context, file.ListInput) (*file.ListResult, error) {
	return nil, errors.New("unexpected List call")
}

func (f *fakeFileService) Download(context.Context, uint64, uint64) (*file.DownloadResult, error) {
	return nil, errors.New("unexpected Download call")
}

func (f *fakeFileService) Delete(context.Context, uint64, uint64) error {
	return errors.New("unexpected Delete call")
}

func (f *fakeFileService) ListTrash(context.Context, file.ListInput) (*file.ListResult, error) {
	return nil, errors.New("unexpected ListTrash call")
}

func (f *fakeFileService) Restore(context.Context, uint64, uint64) error {
	return errors.New("unexpected Restore call")
}

func (f *fakeFileService) PermanentDelete(context.Context, uint64, uint64) error {
	f.permanentDeleteCalls++
	if f.permanentDeleteErr != nil {
		return f.permanentDeleteErr
	}
	return errors.New("unexpected PermanentDelete call")
}

func (f *fakeFileService) Rename(context.Context, file.RenameInput) error {
	return errors.New("unexpected Rename call")
}

func (f *fakeFileService) Search(context.Context, file.SearchInput) (*file.ListResult, error) {
	return nil, errors.New("unexpected Search call")
}

func (f *fakeFileService) StorageUsage(context.Context, uint64) (*file.StorageUsageResult, error) {
	return nil, errors.New("unexpected StorageUsage call")
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func instantRouter(t *testing.T, svc *fakeFileService) (*gin.Engine, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	svc.t = t
	manager := newHandlerTestTokenManager(t)
	// Other handlers stay nil: NewRouter binds their method values but this
	// test never calls them (precedent: newShareTestRouter passes nil fileHandler).
	router := NewRouter(NewFileHandler(svc), nil, nil, nil, manager, nil, nil, &fakeShareLimiter{allowed: true})
	return router, ownerAuthHeader(t, manager, 7)
}

func decodeObject(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &out); err != nil {
		t.Fatalf("body is not a JSON object: %q", response.Body.String())
	}
	return out
}

const instantShaHex = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func validInstantBody() string {
	return fmt.Sprintf(
		`{"sha256":"%s","original_name":"notes.txt","content_type":"text/plain","folder_id":3}`,
		instantShaHex,
	)
}

func seededInstantRow() *file.File {
	sha := instantShaHex
	return &file.File{
		ID:           42,
		OwnerID:      7,
		FolderID:     3,
		OriginalName: "notes.txt",
		ObjectKey:    "blobs/" + sha,
		Sha256:       &sha,
		Size:         4096,
		ContentType:  "text/plain",
		ETag:         sha,
		Status:       file.StatusActive,
		CreatedAt:    time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
	}
}

// ---------------------------------------------------------------------------
// hit: 201 with the POST /files field set, EXACTLY (parity by shared ctor)
// ---------------------------------------------------------------------------

func TestInstantUploadHitMatchesUploadShape(t *testing.T) {
	svc := &fakeFileService{instantResult: seededInstantRow()}
	router, auth := instantRouter(t, svc)

	// Leg 1: real POST /files success through the same router + handler.
	var form bytes.Buffer
	writer := multipart.NewWriter(&form)
	part, err := writer.CreateFormFile("file", "upload.txt")
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	if _, err := io.WriteString(part, "hello bytes"); err != nil {
		t.Fatalf("write form part: %v", err)
	}
	if err := writer.WriteField("folder_id", "3"); err != nil {
		t.Fatalf("WriteField: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("multipart Close: %v", err)
	}
	svc.uploadResult = &file.File{
		ID: 41, OwnerID: 7, FolderID: 3, OriginalName: "upload.txt",
		ObjectKey: "users/7/uuid", Size: 11, ContentType: "text/plain",
		ETag: "etag-direct", Status: file.StatusActive, CreatedAt: time.Now(),
	}
	uploadRequest := httptest.NewRequest(http.MethodPost, "/api/v1/files", &form)
	uploadRequest.Header.Set("Content-Type", writer.FormDataContentType())
	uploadRequest.Header.Set("Authorization", auth)
	uploadRequest.RemoteAddr = "203.0.113.7:44444"
	uploadResponse := httptest.NewRecorder()
	router.ServeHTTP(uploadResponse, uploadRequest)
	if uploadResponse.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, body=%s, want 201", uploadResponse.Code, uploadResponse.Body)
	}
	uploadBody := decodeObject(t, uploadResponse)

	// Leg 2: instant hit.
	instantResponse := doShareRequest(t, router, http.MethodPost, "/api/v1/files/instant", validInstantBody(), auth)
	if instantResponse.Code != http.StatusCreated {
		t.Fatalf("instant status = %d, body=%s, want 201", instantResponse.Code, instantResponse.Body)
	}
	instantBody := decodeObject(t, instantResponse)

	// Key-SET parity both directions.
	for key := range instantBody {
		if _, ok := uploadBody[key]; !ok {
			t.Errorf("instant body has key %q absent from POST /files response", key)
		}
	}
	for key := range uploadBody {
		if _, ok := instantBody[key]; !ok {
			t.Errorf("POST /files key %q absent from instant response", key)
		}
	}
	// Values flow through the handler untouched.
	if instantBody["object_key"] != "blobs/"+instantShaHex {
		t.Errorf("object_key = %v, want blobs/<sha>", instantBody["object_key"])
	}
	if instantBody["content_type"] != "text/plain" {
		t.Errorf("content_type = %v, want objects-row text/plain", instantBody["content_type"])
	}
	if instantBody["size"] != float64(4096) {
		t.Errorf("size = %v, want 4096", instantBody["size"])
	}
	if svc.instantInput.Sha256 != instantShaHex || svc.instantInput.OriginalName != "notes.txt" ||
		svc.instantInput.ContentType != "text/plain" || svc.instantInput.FolderID != 3 ||
		svc.instantInput.OwnerID != 7 {
		t.Errorf("service input = %+v, want full probe mapping incl owner from JWT", svc.instantInput)
	}
}

func TestInstantUploadDefaultFolderRoot(t *testing.T) {
	svc := &fakeFileService{instantResult: seededInstantRow()}
	router, auth := instantRouter(t, svc)

	body := fmt.Sprintf(`{"sha256":"%s","original_name":"n.txt","content_type":"text/plain"}`, instantShaHex)
	response := doShareRequest(t, router, http.MethodPost, "/api/v1/files/instant", body, auth)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", response.Code)
	}
	if svc.instantInput.FolderID != 0 {
		t.Errorf("folder_id = %d, want 0 (root) when absent", svc.instantInput.FolderID)
	}
}

// ---------------------------------------------------------------------------
// miss: 200 {"exists": false} — shape DISJOINT from fileResponse (both ways)
// ---------------------------------------------------------------------------

func TestInstantUploadMissServesExistsFalse(t *testing.T) {
	svc := &fakeFileService{instantErr: file.ErrBlobNotFound}
	router, auth := instantRouter(t, svc)

	response := doShareRequest(t, router, http.MethodPost, "/api/v1/files/instant", validInstantBody(), auth)
	if response.Code != http.StatusOK {
		t.Fatalf("miss status = %d, want 200", response.Code)
	}
	body := decodeObject(t, response)
	if len(body) != 1 {
		t.Fatalf("miss body = %v, want exactly one key (exists)", body)
	}
	exists, ok := body["exists"].(bool)
	if !ok || exists {
		t.Fatalf("body = %v, want exists:false", body)
	}
	// Disjointness the spec demands (钉双向): no fileResponse field may wear
	// the miss shape — a client branches on exactly this set difference.
	for _, leak := range []string{"id", "folder_id", "original_name", "object_key", "size", "content_type", "created_at", "etag"} {
		if _, present := body[leak]; present {
			t.Errorf("miss body leaks fileResponse key %q", leak)
		}
	}
}

// ---------------------------------------------------------------------------
// error faces
// ---------------------------------------------------------------------------

func TestInstantUploadErrorFaces(t *testing.T) {
	cases := []struct {
		name     string
		err      error
		wantCode int
		wantBody string
	}{
		{
			"quota",
			file.ErrQuotaExceeded,
			http.StatusInsufficientStorage,
			"storage quota exceeded",
		},
		{
			"busy",
			// Same construction shape as the service's exhaustion return.
			fmt.Errorf("instant upload: %w (last: %w)", file.ErrBlobBusy, errors.New("deadlock")),
			http.StatusConflict,
			"blob busy, retry",
		},
		{
			"bad sha",
			file.ErrInvalidSha256,
			http.StatusBadRequest,
			"invalid sha256",
		},
		{
			"bad name",
			fmt.Errorf("instant upload: %w", file.ErrInvalidFileName),
			http.StatusBadRequest,
			"invalid file name",
		},
		{
			// Foreign/missing folder: the service's real wrap of the folder
			// sentinel (§2.3: both share this one face).
			"folder",
			fmt.Errorf("validate instant upload folder: ensure folder ownership: %w", folder.ErrFolderNotFound),
			http.StatusNotFound,
			"folder not found",
		},
		{
			"unknown",
			errors.New("connection reset by peer"),
			http.StatusInternalServerError,
			"instant upload failed",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := &fakeFileService{instantErr: tc.err}
			router, auth := instantRouter(t, svc)
			response := doShareRequest(t, router, http.MethodPost, "/api/v1/files/instant", validInstantBody(), auth)
			if response.Code != tc.wantCode {
				t.Fatalf("status = %d, want %d (body %s)", response.Code, tc.wantCode, response.Body)
			}
			if got := decodeObject(t, response)["error"]; got != tc.wantBody {
				t.Errorf("error body = %v, want %q", got, tc.wantBody)
			}
		})
	}
}

func TestInstantUploadRejectsBadShape(t *testing.T) {
	svc := &fakeFileService{}
	router, auth := instantRouter(t, svc)

	for name, body := range map[string]string{
		"empty object":       `{}`,
		"missing sha":        `{"original_name":"n","content_type":"text/plain"}`,
		"missing name":       fmt.Sprintf(`{"sha256":"%s","content_type":"text/plain"}`, instantShaHex),
		"missing content":    fmt.Sprintf(`{"sha256":"%s","original_name":"n"}`, instantShaHex),
		"blank content_type": fmt.Sprintf(`{"sha256":"%s","original_name":"n","content_type":""}`, instantShaHex),
		"not json":           `hello`,
		"empty body":         ``,
	} {
		response := doShareRequest(t, router, http.MethodPost, "/api/v1/files/instant", body, auth)
		if response.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", name, response.Code)
		}
	}
	if svc.instantCalls != 0 {
		t.Errorf("bad shapes must not reach the service, calls = %d", svc.instantCalls)
	}
}

func TestInstantUploadRequiresAuth(t *testing.T) {
	svc := &fakeFileService{}
	router, _ := instantRouter(t, svc)

	response := doShareRequest(t, router, http.MethodPost, "/api/v1/files/instant", validInstantBody(), "")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
	if svc.instantCalls != 0 {
		t.Errorf("anonymous probe must not reach the service, calls = %d", svc.instantCalls)
	}
}

// ---------------------------------------------------------------------------
// router: static /files/instant and the /files/:id wildcard coexist
// ---------------------------------------------------------------------------

func TestInstantRouteCoexistsWithIDWildcard(t *testing.T) {
	svc := &fakeFileService{instantResult: seededInstantRow()}
	router, auth := instantRouter(t, svc)

	registered := map[string]bool{}
	for _, route := range router.Routes() {
		registered[route.Method+" "+route.Path] = true
	}
	for _, want := range []string{
		"POST /api/v1/files/instant",
		"PATCH /api/v1/files/:id/move",
		"POST /api/v1/files/:id/restore",
		"GET /api/v1/files/:id/content",
		"POST /api/v1/files/:id/shares",
	} {
		if !registered[want] {
			t.Errorf("route not registered: %s", want)
		}
	}

	// Serve both: the static path must hit Instant (201), NOT be swallowed by
	// the :id subtree, and the :id path must still resolve.
	instant := doShareRequest(t, router, http.MethodPost, "/api/v1/files/instant", validInstantBody(), auth)
	if instant.Code != http.StatusCreated {
		t.Fatalf("instant via router = %d (body %s), want 201", instant.Code, instant.Body)
	}
	move := doShareRequest(t, router, http.MethodPatch, "/api/v1/files/9/move", `{"folder_id":2}`, auth)
	if move.Code != http.StatusNoContent {
		t.Fatalf("move via router = %d, want 204 (route swallowed?)", move.Code)
	}
	if svc.instantCalls != 1 || svc.moveCalls != 1 {
		t.Errorf("calls = instant %d move %d, want 1/1", svc.instantCalls, svc.moveCalls)
	}
}
