package httpapi

import (
	"PersonalCloudStorage/internal/auth"
	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/share"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// fakes
// ---------------------------------------------------------------------------

// fakeShareAPI implements ShareAPI in memory. PasswordHash carries the
// plaintext under a "pw:" sentinel so Verify can compare without bcrypt.
type fakeShareAPI struct {
	tokens *auth.TokenManager
	shares []*share.Share
	files  map[uint64]*file.File

	createErr    error
	listErr      error
	incrementErr error
	nextID       uint64

	createCalls       int
	lastCreateOwner   uint64
	lastCreateFile    uint64
	lastCreateOpts    share.CreateOptions
	listCalls         int
	revokeCalls       int
	lastRevokeOwner   uint64
	lastRevokeToken   string
	incrementCalls    int
	lastIncrementID   uint64
	accessVerifyCalls int
}

var _ ShareAPI = (*fakeShareAPI)(nil)

func ptrString(s string) *string { return &s }

func fakeShareToken(id uint64) string {
	// 43 chars like a real token, first 8 stable so log-masking assertions
	// can tell the kept prefix from the masked remainder.
	return fmt.Sprintf("abcdefgh%035d", id)
}

func (f *fakeShareAPI) seedFile(rec *file.File) {
	if f.files == nil {
		f.files = map[uint64]*file.File{}
	}
	f.files[rec.ID] = rec
}

func (f *fakeShareAPI) seedShare(sh *share.Share) *share.Share {
	if sh.ID == 0 {
		f.nextID++
		sh.ID = f.nextID
	}
	if sh.Token == "" {
		sh.Token = fakeShareToken(sh.ID)
	}
	f.shares = append(f.shares, sh)
	return sh
}

func (f *fakeShareAPI) Create(_ context.Context, ownerID, fileID uint64, opts share.CreateOptions) (*share.Share, error) {
	f.createCalls++
	f.lastCreateOwner = ownerID
	f.lastCreateFile = fileID
	f.lastCreateOpts = opts
	if f.createErr != nil {
		return nil, f.createErr
	}
	active, ok := f.files[fileID]
	if !ok || active.Status != file.StatusActive || active.OwnerID != ownerID {
		return nil, share.ErrShareNotFound
	}
	sh := &share.Share{
		OwnerID:     ownerID,
		FileID:      fileID,
		DisplayName: active.OriginalName,
		CreatedAt:   time.Now(),
	}
	if opts.Password != "" {
		sh.PasswordHash = ptrString("pw:" + opts.Password)
	}
	if opts.ExpiresIn > 0 {
		expires := time.Now().Add(opts.ExpiresIn)
		sh.ExpiresAt = &expires
	}
	return f.seedShare(sh), nil
}

func (f *fakeShareAPI) List(_ context.Context, ownerID uint64) ([]share.Share, error) {
	f.listCalls++
	if f.listErr != nil {
		return nil, f.listErr
	}
	var out []share.Share
	for _, sh := range f.shares { // newest first = reverse insertion order
		if sh.OwnerID == ownerID {
			out = append(out, *sh)
		}
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

func (f *fakeShareAPI) usable(sh *share.Share) error {
	if sh.RevokedAt != nil {
		return &share.ErrShareGone{Reason: share.ReasonRevoked}
	}
	if sh.ExpiresAt != nil && !time.Now().Before(*sh.ExpiresAt) {
		return &share.ErrShareGone{Reason: share.ReasonExpired}
	}
	if _, ok := f.files[sh.FileID]; !ok {
		return &share.ErrShareGone{Reason: share.ReasonFileUnavailable}
	}
	return nil
}

func (f *fakeShareAPI) find(token string) (*share.Share, *file.File, error) {
	for _, sh := range f.shares {
		if sh.Token == token {
			copied := *sh
			if err := f.usable(&copied); err != nil {
				return nil, nil, err
			}
			active := *f.files[sh.FileID]
			return &copied, &active, nil
		}
	}
	return nil, nil, share.ErrShareNotFound
}

func (f *fakeShareAPI) Meta(_ context.Context, token string) (*share.Share, *file.File, error) {
	return f.find(token)
}

func (f *fakeShareAPI) Verify(_ context.Context, token, password string) (string, error) {
	sh, _, err := f.find(token)
	if err != nil {
		return "", err
	}
	if sh.PasswordHash == nil {
		return "", share.ErrNoPassword
	}
	if *sh.PasswordHash != "pw:"+password {
		return "", share.ErrPassword
	}
	return f.tokens.IssueShareToken(sh.ID)
}

func (f *fakeShareAPI) Access(_ context.Context, shareJWT string) (*share.Share, *file.File, error) {
	f.accessVerifyCalls++
	shareID, err := f.tokens.ParseShareToken(shareJWT)
	if err != nil {
		return nil, nil, err
	}
	for _, sh := range f.shares {
		if sh.ID == shareID {
			copied := *sh
			if err := f.usable(&copied); err != nil {
				return nil, nil, err
			}
			active := *f.files[sh.FileID]
			return &copied, &active, nil
		}
	}
	return nil, nil, share.ErrShareNotFound
}

func (f *fakeShareAPI) RevokeByToken(_ context.Context, ownerID uint64, token string) error {
	f.revokeCalls++
	f.lastRevokeOwner = ownerID
	f.lastRevokeToken = token
	for _, sh := range f.shares {
		if sh.Token == token {
			if sh.OwnerID != ownerID {
				return share.ErrShareNotFound
			}
			now := time.Now()
			sh.RevokedAt = &now
			return nil
		}
	}
	return share.ErrShareNotFound
}

func (f *fakeShareAPI) IncrementDownload(_ context.Context, shareID uint64) error {
	f.incrementCalls++
	f.lastIncrementID = shareID
	if f.incrementErr != nil {
		return f.incrementErr
	}
	for _, sh := range f.shares {
		if sh.ID == shareID {
			sh.DownloadCount++
			return nil
		}
	}
	return nil
}

// fakeShareFiles backs ShareFileSource with canned object bytes.
type fakeShareFiles struct {
	objects     map[string][]byte
	contentType string
	err         error
	keys        []string
}

var _ ShareFileSource = (*fakeShareFiles)(nil)

func (f *fakeShareFiles) DownloadByKey(_ context.Context, key string) (*file.DownloadResult, error) {
	f.keys = append(f.keys, key)
	if f.err != nil {
		return nil, f.err
	}
	body, ok := f.objects[key]
	if !ok {
		return nil, fmt.Errorf("object %q missing", key)
	}
	return &file.DownloadResult{
		ContentType: f.contentType,
		Size:        int64(len(body)),
		Reader:      io.NopCloser(bytes.NewReader(body)),
	}, nil
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// newShareTestRouter builds the real router with everything but the share
// stack nil/blank, capturing gin's access-log output for the run.
func newShareTestRouter(t *testing.T) (*gin.Engine, *fakeShareAPI, *fakeShareFiles, *auth.TokenManager, *bytes.Buffer) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	manager := newHandlerTestTokenManager(t)
	api := &fakeShareAPI{tokens: manager, files: map[uint64]*file.File{}}
	files := &fakeShareFiles{objects: map[string][]byte{}, contentType: "application/pdf"}
	handler := NewShareHandler(api, files)

	previous := gin.DefaultWriter
	logs := &bytes.Buffer{}
	gin.DefaultWriter = logs
	t.Cleanup(func() { gin.DefaultWriter = previous })

	router := NewRouter(nil, nil, nil, nil, manager, nil, handler, &fakeShareLimiter{allowed: true})
	return router, api, files, manager, logs
}

func newHandlerTestTokenManager(t *testing.T) *auth.TokenManager {
	t.Helper()
	manager, err := auth.NewTokenManager(auth.TokenConfig{
		Secret:    "share-handler-unit-test-secret-0123456789",
		Issuer:    "personal-cloud-storage-test",
		AccessTTL: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewTokenManager: %v", err)
	}
	return manager
}

func ownerAuthHeader(t *testing.T, manager *auth.TokenManager, ownerID uint64) string {
	t.Helper()
	token, _, err := manager.GenerateAccessToken(ownerID)
	if err != nil {
		t.Fatalf("GenerateAccessToken: %v", err)
	}
	return "Bearer " + token
}

func doShareRequest(
	t *testing.T,
	router *gin.Engine,
	method, target, body, authorization string,
) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, target, reader)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	// Non-loopback RemoteAddr keeps ClientIP (and limiter keys) deterministic.
	request.RemoteAddr = "203.0.113.7:44444"
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func decodeJSONBody(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var decoded map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode body %q: %v", response.Body.String(), err)
	}
	return decoded
}

// ---------------------------------------------------------------------------
// statusForShareError — spec §3 v2 matrix, pure function
// ---------------------------------------------------------------------------

func TestStatusForShareErrorMatrix(t *testing.T) {
	goneCases := []struct {
		name   string
		reason string
	}{
		{"revoked", share.ReasonRevoked},
		{"expired", share.ReasonExpired},
		{"file unavailable", share.ReasonFileUnavailable},
	}

	type testCase struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
		wantReason string
	}

	cases := []testCase{
		{name: "not found", err: share.ErrShareNotFound, wantStatus: 404, wantCode: "not_found"},
		{name: "not found wrapped", err: fmt.Errorf("outer: %w", share.ErrShareNotFound), wantStatus: 404, wantCode: "not_found"},
		{name: "invalid password", err: share.ErrPassword, wantStatus: 401, wantCode: "invalid_password"},
		{name: "invalid password wrapped", err: fmt.Errorf("outer: %w", share.ErrPassword), wantStatus: 401, wantCode: "invalid_password"},
		{name: "no password link", err: share.ErrNoPassword, wantStatus: 400, wantCode: "password_not_required"},
		{name: "too many shares", err: share.ErrTooManyShares, wantStatus: 409, wantCode: "too_many_shares"},
		{name: "too many wrapped", err: fmt.Errorf("outer: %w", share.ErrTooManyShares), wantStatus: 409, wantCode: "too_many_shares"},
		{name: "password too long", err: share.ErrPasswordTooLong, wantStatus: 400, wantCode: "invalid_password_length"},
		{name: "password too long wrapped", err: fmt.Errorf("outer: %w", share.ErrPasswordTooLong), wantStatus: 400, wantCode: "invalid_password_length"},
		{name: "bad share jwt", err: auth.ErrInvalidToken, wantStatus: 401, wantCode: "unauthorized"},
		{name: "bad share jwt wrapped", err: fmt.Errorf("outer: %w", auth.ErrInvalidToken), wantStatus: 401, wantCode: "unauthorized"},
		{name: "unknown error", err: errors.New("db down"), wantStatus: 500, wantCode: "share request failed"},
	}
	for _, gone := range goneCases {
		cases = append(cases,
			testCase{
				name:       "gone " + gone.name,
				err:        &share.ErrShareGone{Reason: gone.reason},
				wantStatus: 410,
				wantCode:   "share_unavailable",
				wantReason: gone.reason,
			},
			testCase{
				name:       "gone " + gone.name + " wrapped",
				err:        fmt.Errorf("outer: %w", &share.ErrShareGone{Reason: gone.reason}),
				wantStatus: 410,
				wantCode:   "share_unavailable",
				wantReason: gone.reason,
			},
		)
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, body := statusForShareError(tc.err)
			if status != tc.wantStatus {
				t.Errorf("status = %d, want %d", status, tc.wantStatus)
			}
			if code, _ := body["error"].(string); code != tc.wantCode {
				t.Errorf("error field = %q, want %q", body["error"], tc.wantCode)
			}
			reason, hasReason := body["reason"]
			if tc.wantReason == "" {
				if hasReason {
					t.Errorf("unexpected reason field %v", reason)
				}
				return
			}
			if reason != tc.wantReason {
				t.Errorf("reason = %v, want %q", reason, tc.wantReason)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// owner CRUD over HTTP
// ---------------------------------------------------------------------------

func TestShareCRUDViaHTTP(t *testing.T) {
	router, api, _, manager, _ := newShareTestRouter(t)
	authHeader := ownerAuthHeader(t, manager, 7)

	// Seed one active owned file plus a foreign owner's share for 404 checks.
	api.seedFile(&file.File{
		ID: 42, OwnerID: 7, OriginalName: "报告-2026.pdf",
		ObjectKey: "users/7/blob-42", Size: 12, ContentType: "application/pdf",
		Status: file.StatusActive,
	})
	foreign := api.seedShare(&share.Share{OwnerID: 8, FileID: 42, DisplayName: "mine"})

	// --- create: 201 shape, password + expiry plumbed through ---
	response := doShareRequest(t, router, http.MethodPost, "/api/v1/files/42/shares",
		`{"password":"hunter2","expires_in":3600}`, authHeader)
	if response.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want 201 (body %s)", response.Code, response.Body.String())
	}
	created := decodeJSONBody(t, response)
	if api.lastCreateOwner != 7 || api.lastCreateFile != 42 {
		t.Errorf("create captured owner/file = %d/%d, want 7/42", api.lastCreateOwner, api.lastCreateFile)
	}
	if api.lastCreateOpts.Password != "hunter2" || api.lastCreateOpts.ExpiresIn != time.Hour {
		t.Errorf("create opts = %+v, want password hunter2 / 1h", api.lastCreateOpts)
	}
	token, _ := created["token"].(string)
	if token == "" {
		t.Fatalf("create response missing token: %v", created)
	}
	if created["canonical_url"] != "/api/v1/public/shares/"+token {
		t.Errorf("canonical_url = %v, want /api/v1/public/shares/%s", created["canonical_url"], token)
	}
	if created["display_name"] != "报告-2026.pdf" || created["has_password"] != true || created["revoked"] != false {
		t.Errorf("create shape wrong: %v", created)
	}
	if _, leaked := created["password_hash"]; leaked {
		t.Errorf("create response must never carry password_hash: %v", created)
	}
	if _, ok := created["expires_at"]; !ok || created["expires_at"] == nil {
		t.Errorf("expires_at missing/null: %v", created)
	}

	// --- create: expires_in must be positive when provided ---
	response = doShareRequest(t, router, http.MethodPost, "/api/v1/files/42/shares", `{"expires_in":0}`, authHeader)
	if response.Code != http.StatusBadRequest {
		t.Errorf("expires_in=0 status = %d, want 400", response.Code)
	}

	// --- create: mapping of service sentinels ---
	sentinelCases := []struct {
		name       string
		createErr  error
		wantStatus int
		wantCode   string
	}{
		{"foreign or missing file", share.ErrShareNotFound, http.StatusNotFound, "not_found"},
		{"over active cap", share.ErrTooManyShares, http.StatusConflict, "too_many_shares"},
		{"password too long", share.ErrPasswordTooLong, http.StatusBadRequest, "invalid_password_length"},
	}
	for _, tc := range sentinelCases {
		api.createErr = tc.createErr
		response = doShareRequest(t, router, http.MethodPost, "/api/v1/files/42/shares", `{}`, authHeader)
		api.createErr = nil
		if response.Code != tc.wantStatus {
			t.Errorf("%s: status = %d, want %d", tc.name, response.Code, tc.wantStatus)
			continue
		}
		if code, _ := decodeJSONBody(t, response)["error"].(string); code != tc.wantCode {
			t.Errorf("%s: error = %q, want %q", tc.name, code, tc.wantCode)
		}
	}

	// --- create: unauthenticated → 401 ---
	response = doShareRequest(t, router, http.MethodPost, "/api/v1/files/42/shares", `{}`, "")
	if response.Code != http.StatusUnauthorized {
		t.Errorf("unauthenticated create status = %d, want 401", response.Code)
	}

	// --- list: {items:[…]} includes revoked, hides hash ---
	api.seedShare(&share.Share{OwnerID: 7, FileID: 42, DisplayName: "old"})
	response = doShareRequest(t, router, http.MethodGet, "/api/v1/shares", "", authHeader)
	if response.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200", response.Code)
	}
	var listed struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listed.Items) != 2 {
		t.Fatalf("list items = %d, want 2", len(listed.Items))
	}
	if listed.Items[0]["display_name"] != "old" { // seeded later ⇒ newest first
		t.Errorf("list not newest-first: %v", listed.Items[0])
	}
	for _, item := range listed.Items {
		if _, leaked := item["password_hash"]; leaked {
			t.Errorf("list item leaks password_hash: %v", item)
		}
	}

	// --- revoke: 204, idempotent, foreign 404, unknown 404 ---
	response = doShareRequest(t, router, http.MethodDelete, "/api/v1/shares/"+token, "", authHeader)
	if response.Code != http.StatusNoContent {
		t.Fatalf("revoke status = %d, want 204", response.Code)
	}
	response = doShareRequest(t, router, http.MethodDelete, "/api/v1/shares/"+token, "", authHeader)
	if response.Code != http.StatusNoContent {
		t.Errorf("idempotent revoke status = %d, want 204", response.Code)
	}
	response = doShareRequest(t, router, http.MethodDelete, "/api/v1/shares/"+foreign.Token, "", authHeader)
	if response.Code != http.StatusNotFound {
		t.Errorf("foreign revoke status = %d, want 404", response.Code)
	}
	if code, _ := decodeJSONBody(t, response)["error"].(string); code != "not_found" {
		t.Errorf("foreign revoke must wear the same not_found face, got %q", code)
	}
	response = doShareRequest(t, router, http.MethodDelete, "/api/v1/shares/nonexistent-token", "", authHeader)
	if response.Code != http.StatusNotFound {
		t.Errorf("unknown revoke status = %d, want 404", response.Code)
	}
}

// ---------------------------------------------------------------------------
// public visitor flow
// ---------------------------------------------------------------------------

func TestPublicMetaAndDownloadFlow(t *testing.T) {
	router, api, files, manager, _ := newShareTestRouter(t)

	files.objects["users/7/blob-42"] = []byte("hello-shared")
	api.seedFile(&file.File{
		ID: 42, OwnerID: 7, OriginalName: "renamed-after-share.pdf", // renamed AFTER sharing: must not surface
		ObjectKey: "users/7/blob-42", Size: 12, ContentType: "application/pdf",
		Status: file.StatusActive,
	})
	locked := api.seedShare(&share.Share{
		OwnerID: 7, FileID: 42, DisplayName: "报告-2026.pdf",
		PasswordHash: ptrString("pw:hunter2"),
	})
	open := api.seedShare(&share.Share{OwnerID: 7, FileID: 42, DisplayName: "open-report.pdf"})

	// --- meta of a needs_password link ---
	response := doShareRequest(t, router, http.MethodGet, "/api/v1/public/shares/"+locked.Token, "", "")
	if response.Code != http.StatusOK {
		t.Fatalf("meta status = %d, want 200 (body %s)", response.Code, response.Body.String())
	}
	meta := decodeJSONBody(t, response)
	if meta["needs_password"] != true || meta["display_name"] != "报告-2026.pdf" ||
		meta["size"] != float64(12) || meta["content_type"] != "application/pdf" {
		t.Errorf("meta shape wrong: %v", meta)
	}
	if _, leaked := meta["password_hash"]; leaked {
		t.Errorf("meta leaks password_hash: %v", meta)
	}

	// --- download without credential → 401 password_required ---
	response = doShareRequest(t, router, http.MethodGet, "/api/v1/public/shares/"+locked.Token+"/download", "", "")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("locked download status = %d, want 401", response.Code)
	}
	if code, _ := decodeJSONBody(t, response)["error"].(string); code != "password_required" {
		t.Errorf("download error = %q, want password_required", code)
	}
	if api.incrementCalls != 0 {
		t.Errorf("rejected download must not increment, calls = %d", api.incrementCalls)
	}

	// --- verify: missing password field → 400, wrong → 401, right → 200 ---
	response = doShareRequest(t, router, http.MethodPost, "/api/v1/public/shares/"+locked.Token+"/verify", `{"password":""}`, "")
	if response.Code != http.StatusBadRequest {
		t.Errorf("verify empty password status = %d, want 400", response.Code)
	}
	response = doShareRequest(t, router, http.MethodPost, "/api/v1/public/shares/"+locked.Token+"/verify", `{"password":"wrong"}`, "")
	if response.Code != http.StatusUnauthorized {
		t.Errorf("verify wrong password status = %d, want 401", response.Code)
	}
	if code, _ := decodeJSONBody(t, response)["error"].(string); code != "invalid_password" {
		t.Errorf("verify error = %q, want invalid_password", code)
	}
	// verify on a passwordless link → 400 (not a fake 401)
	response = doShareRequest(t, router, http.MethodPost, "/api/v1/public/shares/"+open.Token+"/verify", `{"password":"whatever"}`, "")
	if response.Code != http.StatusBadRequest {
		t.Errorf("verify passwordless status = %d, want 400", response.Code)
	}
	response = doShareRequest(t, router, http.MethodPost, "/api/v1/public/shares/"+locked.Token+"/verify", `{"password":"hunter2"}`, "")
	if response.Code != http.StatusOK {
		t.Fatalf("verify status = %d, want 200 (body %s)", response.Code, response.Body.String())
	}
	verified := decodeJSONBody(t, response)
	shareJWT, _ := verified["share_token"].(string)
	if shareJWT == "" {
		t.Fatalf("verify response missing share_token: %v", verified)
	}

	// --- download via Authorization: Bearer <shareJWT> ---
	response = doShareRequest(t, router, http.MethodGet, "/api/v1/public/shares/"+locked.Token+"/download", "", "Bearer "+shareJWT)
	if response.Code != http.StatusOK {
		t.Fatalf("download status = %d, want 200", response.Code)
	}
	if got := response.Body.String(); got != "hello-shared" {
		t.Errorf("download body = %q, want hello-shared", got)
	}
	disposition := response.Header().Get("Content-Disposition")
	if !strings.HasPrefix(disposition, "attachment;") {
		t.Errorf("Content-Disposition = %q, want attachment prefix", disposition)
	}
	// CJK snapshot name, RFC5987 charset tag UTF-8''; 报=E6 8A A5 告=E5 91 8A;
	// attr-chars '-' '.' and digits pass through; ASCII fallback first.
	if !strings.Contains(disposition, "filename*=UTF-8''%E6%8A%A5%E5%91%8A-2026.pdf") {
		t.Errorf("Content-Disposition missing UTF-8'' filename*: %q", disposition)
	}
	if !strings.Contains(disposition, `filename="__-2026.pdf"`) {
		t.Errorf("Content-Disposition missing ASCII fallback: %q", disposition)
	}
	if strings.Contains(disposition, "renamed-after-share") {
		t.Errorf("disposition must use the share snapshot name, not current file name: %q", disposition)
	}
	if response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", response.Header().Get("X-Content-Type-Options"))
	}
	if response.Header().Get("Content-Length") != "12" {
		t.Errorf("Content-Length = %q, want 12", response.Header().Get("Content-Length"))
	}
	if response.Header().Get("Content-Type") != "application/pdf" {
		t.Errorf("Content-Type = %q, want application/pdf", response.Header().Get("Content-Type"))
	}
	if api.incrementCalls != 1 || api.lastIncrementID != locked.ID {
		t.Errorf("increment = %d calls/last %d, want 1/%d", api.incrementCalls, api.lastIncrementID, locked.ID)
	}
	if len(files.keys) != 1 || files.keys[0] != "users/7/blob-42" {
		t.Errorf("DownloadByKey keys = %v, want [users/7/blob-42]", files.keys)
	}

	// --- download via ?access=<shareJWT> (same credential, other form) ---
	response = doShareRequest(t, router, http.MethodGet, "/api/v1/public/shares/"+locked.Token+"/download?access="+shareJWT, "", "")
	if response.Code != http.StatusOK {
		t.Errorf("?access= download status = %d, want 200", response.Code)
	}
	if api.incrementCalls != 2 {
		t.Errorf("increments = %d, want 2", api.incrementCalls)
	}

	// --- login (user-scope) token must NOT unlock a locked link ---
	userJWT := ownerAuthHeader(t, manager, 7)
	response = doShareRequest(t, router, http.MethodGet, "/api/v1/public/shares/"+locked.Token+"/download", "", userJWT)
	if response.Code != http.StatusUnauthorized {
		t.Errorf("user token download status = %d, want 401 (Review Focus 2)", response.Code)
	}

	// --- user token on an OPEN link is still rejected (credential present ⇒ validated) ---
	response = doShareRequest(t, router, http.MethodGet, "/api/v1/public/shares/"+open.Token+"/download", "", userJWT)
	if response.Code != http.StatusUnauthorized {
		t.Errorf("user token on open download status = %d, want 401", response.Code)
	}

	// --- garbage credential → 401 ---
	response = doShareRequest(t, router, http.MethodGet, "/api/v1/public/shares/"+locked.Token+"/download", "", "Bearer totally.garbage.jwt")
	if response.Code != http.StatusUnauthorized {
		t.Errorf("garbage credential status = %d, want 401", response.Code)
	}

	// --- share JWT from another share must not unlock this one ---
	otherJWT, err := manager.IssueShareToken(open.ID)
	if err != nil {
		t.Fatalf("IssueShareToken: %v", err)
	}
	before := api.incrementCalls
	response = doShareRequest(t, router, http.MethodGet, "/api/v1/public/shares/"+locked.Token+"/download", "", "Bearer "+otherJWT)
	if response.Code != http.StatusUnauthorized {
		t.Errorf("cross-share jwt status = %d, want 401", response.Code)
	}
	if api.incrementCalls != before {
		t.Errorf("cross-share jwt must not increment, calls = %d", api.incrementCalls)
	}

	// --- passwordless link: no verify, straight download ---
	response = doShareRequest(t, router, http.MethodGet, "/api/v1/public/shares/"+open.Token+"/download", "", "")
	if response.Code != http.StatusOK {
		t.Fatalf("open download status = %d, want 200", response.Code)
	}
	if !strings.Contains(response.Header().Get("Content-Disposition"), "open-report.pdf") {
		t.Errorf("open download disposition = %q", response.Header().Get("Content-Disposition"))
	}

	// --- increment failure never blocks the stream ---
	api.incrementErr = errors.New("counters table on fire")
	response = doShareRequest(t, router, http.MethodGet, "/api/v1/public/shares/"+open.Token+"/download", "", "")
	api.incrementErr = nil
	if response.Code != http.StatusOK {
		t.Errorf("download with failing increment status = %d, want 200", response.Code)
	}

	// --- stream failure → 500 ---
	files.err = errors.New("minio down")
	response = doShareRequest(t, router, http.MethodGet, "/api/v1/public/shares/"+open.Token+"/download", "", "")
	files.err = nil
	if response.Code != http.StatusInternalServerError {
		t.Errorf("stream failure status = %d, want 500", response.Code)
	}
}

func TestPublicShareUnavailableStates(t *testing.T) {
	// Each state must produce the §3 matrix answer on meta, verify AND download.
	type state struct {
		name   string
		mutate func(sh *share.Share, api *fakeShareAPI)
		status int
		reason string // "" → expect not_found
	}
	states := []state{
		{
			name:   "unknown token",
			mutate: func(_ *share.Share, _ *fakeShareAPI) {},
			status: http.StatusNotFound,
		},
		{
			name:   "revoked",
			mutate: func(sh *share.Share, _ *fakeShareAPI) { now := time.Now(); sh.RevokedAt = &now },
			status: http.StatusGone, reason: share.ReasonRevoked,
		},
		{
			name:   "expired",
			mutate: func(sh *share.Share, _ *fakeShareAPI) { past := time.Now().Add(-time.Minute); sh.ExpiresAt = &past },
			status: http.StatusGone, reason: share.ReasonExpired,
		},
		{
			name:   "file in trash",
			mutate: func(sh *share.Share, api *fakeShareAPI) { delete(api.files, sh.FileID) },
			status: http.StatusGone, reason: share.ReasonFileUnavailable,
		},
	}

	for _, st := range states {
		t.Run(st.name, func(t *testing.T) {
			router, api, files, _, _ := newShareTestRouter(t)
			files.objects["users/7/blob-42"] = []byte("x")
			api.seedFile(&file.File{ID: 42, OwnerID: 7, OriginalName: "f.pdf", ObjectKey: "users/7/blob-42", Status: file.StatusActive})
			token := "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef12"
			sh := api.seedShare(&share.Share{ID: 99, OwnerID: 7, FileID: 42, Token: token, DisplayName: "f.pdf"})
			st.mutate(sh, api)
			if st.name == "unknown token" {
				api.shares = api.shares[:0]
			}

			wantCode := "not_found"
			wantReason := ""
			if st.reason != "" {
				wantCode = "share_unavailable"
				wantReason = st.reason
			}

			verbs := []struct{ method, target, body string }{
				{http.MethodGet, "/api/v1/public/shares/" + token, ""},
				{http.MethodPost, "/api/v1/public/shares/" + token + "/verify", `{"password":"p"}`},
				{http.MethodGet, "/api/v1/public/shares/" + token + "/download", ""},
			}
			for _, v := range verbs {
				response := doShareRequest(t, router, v.method, v.target, v.body, "")
				if response.Code != st.status {
					t.Errorf("%s %s status = %d, want %d (body %s)", v.method, v.target, response.Code, st.status, response.Body.String())
					continue
				}
				body := decodeJSONBody(t, response)
				if code, _ := body["error"].(string); code != wantCode {
					t.Errorf("%s error = %q, want %q", v.target, code, wantCode)
				}
				if wantReason != "" && body["reason"] != wantReason {
					t.Errorf("%s reason = %v, want %q", v.target, body["reason"], wantReason)
				}
			}
		})
	}
}

// ---------------------------------------------------------------------------
// router wiring + log scrub
// ---------------------------------------------------------------------------

func TestShareRoutesRegistered(t *testing.T) {
	// Constructing the router at all proves gin's tree accepts the new
	// :id/:token siblings (wildcard conflict would panic here).
	router, _, _, _, _ := newShareTestRouter(t)

	want := []string{
		"POST /api/v1/files/:id/shares",
		"GET /api/v1/shares",
		"DELETE /api/v1/shares/:token",
		"GET /api/v1/public/shares/:token",
		"POST /api/v1/public/shares/:token/verify",
		"GET /api/v1/public/shares/:token/download",
	}
	registered := map[string]bool{}
	for _, route := range router.Routes() {
		registered[route.Method+" "+route.Path] = true
	}
	for _, entry := range want {
		if !registered[entry] {
			t.Errorf("route not registered: %s", entry)
		}
	}
}

func TestPublicAccessLogMasksShareToken(t *testing.T) {
	router, api, files, _, logs := newShareTestRouter(t)
	files.objects["users/7/blob-42"] = []byte("x")
	api.seedFile(&file.File{ID: 42, OwnerID: 7, OriginalName: "f.pdf", ObjectKey: "users/7/blob-42", Status: file.StatusActive})
	token := "abcdefgh" + strings.Repeat("TOPSECRET", 5) // first 8 = "abcdefgh"
	api.seedShare(&share.Share{ID: 5, OwnerID: 7, FileID: 42, Token: token, DisplayName: "f.pdf"})
	shareJWT, err := api.tokens.IssueShareToken(5)
	if err != nil {
		t.Fatalf("IssueShareToken: %v", err)
	}

	response := doShareRequest(t, router, http.MethodGet,
		"/api/v1/public/shares/"+token+"/download?access="+shareJWT, "", "")
	if response.Code != http.StatusOK {
		t.Fatalf("download status = %d, want 200", response.Code)
	}

	line := logs.String()
	if strings.Contains(line, token) {
		t.Errorf("access log leaked full share token: %s", line)
	}
	if strings.Contains(line, shareJWT) {
		t.Errorf("access log leaked full share JWT: %s", line)
	}
	if strings.Contains(line, token[:9]) {
		t.Errorf("access log leaked beyond first 8 chars (%q): %s", token[:9], line)
	}
	if !strings.Contains(line, "abcdefgh") {
		t.Errorf("access log should keep the first 8 chars, got: %s", line)
	}

	// Owner routes are untouched by the masker.
	logs.Reset()
	authHeader := ownerAuthHeader(t, api.tokens, 7)
	response = doShareRequest(t, router, http.MethodGet, "/api/v1/shares", "", authHeader)
	if response.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200", response.Code)
	}
	if !strings.Contains(logs.String(), "/api/v1/shares") {
		t.Errorf("owner route log path mangled: %s", logs.String())
	}
}
