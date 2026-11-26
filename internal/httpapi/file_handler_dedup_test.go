package httpapi

import (
	"PersonalCloudStorage/internal/file"
	"bytes"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ---------------------------------------------------------------------------
// B5 handler faces: the dedup error sentinels keep their HTTP contracts on
// the paths that newly gained them (PermanentDelete 409) and on the path
// whose repo error became Is-able (direct upload convert → 507, B3-M3).
// ---------------------------------------------------------------------------

func TestPermanentDeleteErrorFaces(t *testing.T) {
	cases := []struct {
		name     string
		err      error
		wantCode int
		wantBody string
	}{
		{
			// Same wrap shape as service.PermanentDelete exhaustion.
			"blob busy",
			fmt.Errorf("permanent delete: %w (last: %w)", file.ErrBlobBusy, errors.New("deadlock")),
			http.StatusConflict,
			"blob busy, retry",
		},
		{
			"row gone",
			fmt.Errorf("delete file metadata: %w", file.ErrFileNotFound),
			http.StatusNotFound,
			"file not found in trash",
		},
		{
			"unknown",
			errors.New("db down"),
			http.StatusInternalServerError,
			"permanetly delete file failed",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := &fakeFileService{permanentDeleteErr: tc.err}
			router, auth := instantRouter(t, svc)
			response := doShareRequest(t, router, http.MethodDelete, "/api/v1/trash/42", "", auth)
			if response.Code != tc.wantCode {
				t.Fatalf("status = %d, want %d (body %s)", response.Code, tc.wantCode, response.Body)
			}
			if got := decodeObject(t, response)["error"]; got != tc.wantBody {
				t.Errorf("error body = %v, want %q", got, tc.wantBody)
			}
			if svc.permanentDeleteCalls != 1 {
				t.Errorf("service calls = %d, want 1", svc.permanentDeleteCalls)
			}
		})
	}
}

func TestUploadConvertContentionServesQuotaFace(t *testing.T) {
	// B5 contract 4: convertReservationTx's RowsAffected==0 now answers
	// ErrQuotaExceeded, and Upload surfaces it through the DedupCreate wrap —
	// the same 507 body the pre-dedup path served. errors.Is walking through
	// both fmt.Errorf layers is exactly what this pins.
	svc := &fakeFileService{
		uploadErr: fmt.Errorf("save dedup upload: convert reserved quota: %w", file.ErrQuotaExceeded),
	}
	router, auth := instantRouter(t, svc)

	var form bytes.Buffer
	writer := multipart.NewWriter(&form)
	part, err := writer.CreateFormFile("file", "q.txt")
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	if _, err := io.WriteString(part, "payload"); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("writer close: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/files", &form)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", auth)
	request.RemoteAddr = "203.0.113.7:44444"

	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusInsufficientStorage {
		t.Fatalf("status = %d, want 507 (body %s)", response.Code, response.Body)
	}
	if got := decodeObject(t, response)["error"]; got != "storage quota exceeded" {
		t.Errorf("error body = %v, want %q", got, "storage quota exceeded")
	}
}
