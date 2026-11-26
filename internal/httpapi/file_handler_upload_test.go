package httpapi

import (
	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/folder"
	"bytes"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
)

// postUpload drives POST /files through the shared test router (same token
// manager as the auth header — instantRouter's) with a tiny multipart body;
// the fakeFileService seam decides the service outcome (no DB, no MinIO).
func postUpload(t *testing.T, router http.Handler, auth string) *httptest.ResponseRecorder {
	t.Helper()
	var form bytes.Buffer
	writer := multipart.NewWriter(&form)
	part, err := writer.CreateFormFile("file", "up.txt")
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	if _, err := io.WriteString(part, "dedup me"); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("multipart close: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/files", &form)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	req.RemoteAddr = "203.0.113.7:44444"
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// B4 adds ONE error face to POST /files: the dedup transaction losing every
// InnoDB lock round surfaces as ErrBlobBusy and must map to the same 409 body
// the instant probe uses — a plain upload retry (bytes re-sent), not a 500.
func TestUploadErrorFaces(t *testing.T) {
	cases := []struct {
		name     string
		err      error
		wantCode int
		wantBody string
	}{
		{
			"busy",
			// Same construction as the service's exhaustion return.
			fmt.Errorf("direct upload: %w (last: %w)", file.ErrBlobBusy, errors.New("deadlock")),
			http.StatusConflict,
			"blob busy, retry",
		},
		{
			"quota",
			fmt.Errorf("reserve upload quota: %w", file.ErrQuotaExceeded),
			http.StatusInsufficientStorage,
			"storage quota exceeded",
		},
		{
			"bad name",
			file.ErrInvalidFileName,
			http.StatusBadRequest,
			"invalid file name",
		},
		{
			"folder",
			fmt.Errorf("validate upload folder: ensure folder ownership: %w", folder.ErrFolderNotFound),
			http.StatusNotFound,
			"folder not found",
		},
		{
			"unknown",
			errors.New("minio unreachable"),
			http.StatusInternalServerError,
			"upload file failed",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := &fakeFileService{uploadErr: tc.err}
			router, auth := instantRouter(t, svc)
			rec := postUpload(t, router, auth)
			if rec.Code != tc.wantCode {
				t.Fatalf("status = %d, want %d (body %s)", rec.Code, tc.wantCode, rec.Body)
			}
			if got := decodeObject(t, rec)["error"]; got != tc.wantBody {
				t.Errorf("error body = %v, want %q", got, tc.wantBody)
			}
			if svc.uploadCalls != 1 {
				t.Errorf("service calls = %d, want 1", svc.uploadCalls)
			}
		})
	}
}
