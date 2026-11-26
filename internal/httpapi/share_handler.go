package httpapi

import (
	"PersonalCloudStorage/internal/auth"
	"PersonalCloudStorage/internal/file"
	"PersonalCloudStorage/internal/share"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// sharePublicURLPrefix is the canonical visitor route of a share link
// (spec §3 ShareResponse.canonical_url); it is also the exact mount point of
// the public route group in router.go.
const sharePublicURLPrefix = "/api/v1/public/shares/"

// maxShareRequestBody caps owner create / visitor verify bodies — both are
// tiny JSON documents; the password byte guard itself lives in share.Service.
const maxShareRequestBody = 8 << 10

// ShareAPI is the handler's narrow view of share.Service: the six A3 methods
// plus the two owner-side passthroughs the token-keyed routes need
// (GET /shares has no other way to list; DELETE /shares/:token cannot use
// Service.Revoke, which is keyed by share ID). *share.Service satisfies it.
type ShareAPI interface {
	Create(ctx context.Context, ownerID uint64, fileID uint64, opts share.CreateOptions) (*share.Share, error)
	List(ctx context.Context, ownerID uint64) ([]share.Share, error)
	Meta(ctx context.Context, token string) (*share.Share, *file.File, error)
	Verify(ctx context.Context, token string, password string) (string, error)
	Access(ctx context.Context, shareJWT string) (*share.Share, *file.File, error)
	RevokeByToken(ctx context.Context, ownerID uint64, token string) error
	IncrementDownload(ctx context.Context, shareID uint64) error
}

// ShareFileSource exposes the share-path-only streaming method; ownership
// validation is the handler's job, never the repository's second guess.
type ShareFileSource interface {
	DownloadByKey(ctx context.Context, key string) (*file.DownloadResult, error)
}

type ShareHandler struct {
	shares ShareAPI
	files  ShareFileSource
}

func NewShareHandler(shares ShareAPI, files ShareFileSource) *ShareHandler {
	return &ShareHandler{
		shares: shares,
		files:  files,
	}
}

// ---------------------------------------------------------------------------
// payloads (spec §3): owner view and visitor view, neither leaks the hash
// ---------------------------------------------------------------------------

type shareResponse struct {
	Token         string     `json:"token"`
	CanonicalURL  string     `json:"canonical_url"`
	DisplayName   string     `json:"display_name"`
	ExpiresAt     *time.Time `json:"expires_at"`
	DownloadCount int        `json:"download_count"`
	Revoked       bool       `json:"revoked"`
	CreatedAt     time.Time  `json:"created_at"`
	HasPassword   bool       `json:"has_password"`
}

type shareMetaResponse struct {
	DisplayName   string     `json:"display_name"`
	Size          int64      `json:"size"`
	ContentType   string     `json:"content_type"`
	NeedsPassword bool       `json:"needs_password"`
	ExpiresAt     *time.Time `json:"expires_at"`
}

func toShareResponse(sh *share.Share) shareResponse {
	return shareResponse{
		Token:         sh.Token,
		CanonicalURL:  sharePublicURLPrefix + sh.Token,
		DisplayName:   sh.DisplayName,
		ExpiresAt:     sh.ExpiresAt,
		DownloadCount: sh.DownloadCount,
		Revoked:       sh.RevokedAt != nil,
		CreatedAt:     sh.CreatedAt,
		HasPassword:   sh.PasswordHash != nil,
	}
}

type createShareRequest struct {
	Password  *string `json:"password"`
	ExpiresIn *int64  `json:"expires_in"`
}

type verifyShareRequest struct {
	Password string `json:"password" binding:"required"`
}

// ---------------------------------------------------------------------------
// error mapping — spec §3 v2 matrix, pure function
// ---------------------------------------------------------------------------

// statusForShareError turns share/auth sentinel errors into the public status
// and body (same shape as statusForAskError). Wrapped errors classify via
// errors.Is/As; anything unknown is a 500 whose detail only reaches the log.
func statusForShareError(err error) (int, gin.H) {
	var gone *share.ErrShareGone
	switch {
	case errors.Is(err, share.ErrShareNotFound):
		return http.StatusNotFound, gin.H{"error": "not_found"}
	case errors.As(err, &gone):
		return http.StatusGone, gin.H{"error": "share_unavailable", "reason": gone.Reason}
	case errors.Is(err, share.ErrPassword):
		return http.StatusUnauthorized, gin.H{"error": "invalid_password"}
	case errors.Is(err, auth.ErrInvalidToken):
		return http.StatusUnauthorized, gin.H{"error": "unauthorized"}
	case errors.Is(err, share.ErrNoPassword):
		return http.StatusBadRequest, gin.H{"error": "password_not_required"}
	case errors.Is(err, share.ErrTooManyShares):
		return http.StatusConflict, gin.H{"error": "too_many_shares"}
	case errors.Is(err, share.ErrPasswordTooLong):
		return http.StatusBadRequest, gin.H{"error": "invalid_password_length"}
	default:
		return http.StatusInternalServerError, gin.H{"error": "share request failed"}
	}
}

// respondShareError maps then attaches 5xx causes to gin's error list so the
// access log's ErrorMessage (and Recovery) still see the real failure.
func respondShareError(c *gin.Context, err error) {
	status, body := statusForShareError(err)
	if status >= http.StatusInternalServerError {
		_ = c.Error(err)
	}
	c.JSON(status, body)
}

// ---------------------------------------------------------------------------
// owner routes (protected group)
// ---------------------------------------------------------------------------

func (h *ShareHandler) Create(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	fileID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || fileID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file id"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxShareRequestBody)
	var request createShareRequest
	if err := c.ShouldBindJSON(&request); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid share request"})
		return
	}
	if request.ExpiresIn != nil && *request.ExpiresIn <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_expires_in"})
		return
	}

	password := ""
	if request.Password != nil {
		password = *request.Password
	}
	var expiresIn time.Duration
	if request.ExpiresIn != nil {
		expiresIn = time.Duration(*request.ExpiresIn) * time.Second
	}

	created, err := h.shares.Create(
		c.Request.Context(),
		ownerID,
		fileID,
		share.CreateOptions{Password: password, ExpiresIn: expiresIn},
	)
	if err != nil {
		respondShareError(c, err)
		return
	}
	c.JSON(http.StatusCreated, toShareResponse(created))
}

func (h *ShareHandler) List(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	shares, err := h.shares.List(c.Request.Context(), ownerID)
	if err != nil {
		respondShareError(c, err)
		return
	}
	items := make([]shareResponse, 0, len(shares))
	for i := range shares {
		items = append(items, toShareResponse(&shares[i]))
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *ShareHandler) Revoke(c *gin.Context) {
	ownerID, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	token := c.Param("token")
	if token == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
		return
	}
	if err := h.shares.RevokeByToken(c.Request.Context(), ownerID, token); err != nil {
		respondShareError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// visitor routes (public group, rate limited per route kind)
// ---------------------------------------------------------------------------

func (h *ShareHandler) Meta(c *gin.Context) {
	token := c.Param("token")
	if token == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
		return
	}
	sh, active, err := h.shares.Meta(c.Request.Context(), token)
	if err != nil {
		respondShareError(c, err)
		return
	}
	c.JSON(http.StatusOK, shareMetaResponse{
		DisplayName:   sh.DisplayName, // snapshot, not the current file name
		Size:          active.Size,
		ContentType:   active.ContentType,
		NeedsPassword: sh.PasswordHash != nil,
		ExpiresAt:     sh.ExpiresAt,
	})
}

func (h *ShareHandler) Verify(c *gin.Context) {
	token := c.Param("token")
	if token == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxShareRequestBody)
	var request verifyShareRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid verify request"})
		return
	}
	shareJWT, err := h.shares.Verify(c.Request.Context(), token, request.Password)
	if err != nil {
		respondShareError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"share_token": shareJWT})
}

// shareAccessCredential accepts the share JWT in either transport (spec §3
// v2): `Authorization: Bearer` or the `?access=` query used by plain
// <a download> links. "" means "no credential supplied".
func shareAccessCredential(c *gin.Context) string {
	parts := strings.Fields(c.GetHeader("Authorization"))
	if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
		if token := strings.TrimSpace(parts[1]); token != "" {
			return token
		}
	}
	return strings.TrimSpace(c.Query("access"))
}

func (h *ShareHandler) Download(c *gin.Context) {
	token := c.Param("token")
	if token == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
		return
	}

	ctx := c.Request.Context()
	visitorShare, activeFile, err := h.shares.Meta(ctx, token)
	if err != nil {
		respondShareError(c, err)
		return
	}

	if credential := shareAccessCredential(c); credential != "" {
		// Any supplied credential must be a share JWT for THIS token. That is
		// what makes a login token here a 401 instead of a bypass (Review
		// Focus 2), and it also re-validates share state on every byte (the
		// JWT outlives revocation/expiry/trash by design — §4 Access).
		verifiedShare, verifiedFile, err := h.shares.Access(ctx, credential)
		if err != nil {
			respondShareError(c, err)
			return
		}
		if verifiedShare.Token != token {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_share_access"})
			return
		}
		visitorShare, activeFile = verifiedShare, verifiedFile
	} else if visitorShare.PasswordHash != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "password_required"})
		return
	}

	// v2: pure statistics — a failed increment logs and never blocks the
	// download (spec §4).
	if err := h.shares.IncrementDownload(ctx, visitorShare.ID); err != nil {
		slog.Warn("increment share download count failed",
			"share_id", visitorShare.ID, "error", err)
	}

	result, err := h.files.DownloadByKey(ctx, activeFile.ObjectKey)
	if err != nil {
		_ = c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "download share failed"})
		return
	}
	defer result.Reader.Close()

	contentType := result.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	// spec §7: public endpoints never inline — attachment disposition with the
	// RFC5987 snapshot name plus nosniff.
	c.Header("Content-Disposition", shareContentDisposition(visitorShare.DisplayName))
	c.Header("Content-Type", contentType)
	c.Header("Content-Length", strconv.FormatInt(result.Size, 10))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Status(http.StatusOK)

	if _, err := io.Copy(c.Writer, result.Reader); err != nil {
		_ = c.Error(fmt.Errorf("stream share response: %w", err))
	}
}

// ---------------------------------------------------------------------------
// Content-Disposition helpers (pure)
// ---------------------------------------------------------------------------

// shareContentDisposition renders attachment disposition with both an
// ASCII-safe legacy filename and the RFC5987 filename* extension carrying the
// share's frozen display name (CJK intact).
func shareContentDisposition(displayName string) string {
	return fmt.Sprintf(
		"attachment; filename=%s; filename*=%s",
		`"`+asciiFilenameFallback(displayName)+`"`,
		rfc5987Encode(displayName),
	)
}

// rfc5987Encode emits the RFC 5987 extended-value form (charset tag "UTF-8"
// plus two apostrophes, then the percent-encoded value) per §3.2.1: attr-char
// passes through, every other byte becomes uppercase %XX.
func rfc5987Encode(value string) string {
	const attrChars = "!#$%&'*+-._^`|~"
	var builder strings.Builder
	builder.WriteString("UTF-8''")
	for i := 0; i < len(value); i++ {
		char := value[i]
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || strings.IndexByte(attrChars, char) >= 0 {
			builder.WriteByte(char)
			continue
		}
		fmt.Fprintf(&builder, "%%%02X", char)
	}
	return builder.String()
}

// asciiFilenameFallback is the legacy clients' copy: printable ASCII minus
// quote/backslash stays, everything else (CJK, control) becomes one '_' per
// rune — 报告 maps to __, not six underscores.
func asciiFilenameFallback(value string) string {
	var builder strings.Builder
	for _, char := range value {
		if char >= 0x20 && char < 0x7F && char != '"' && char != '\\' {
			builder.WriteRune(char)
		} else {
			builder.WriteByte('_')
		}
	}
	if builder.Len() == 0 {
		return "download"
	}
	return builder.String()
}
