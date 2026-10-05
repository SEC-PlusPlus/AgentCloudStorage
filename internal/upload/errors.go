package upload

import "errors"

var ErrSessionNotFound = errors.New("upload session not found")
var ErrQuotaExceeded = errors.New("storage quota exceeded")
var ErrSessionNotUploading = errors.New("upload session is not active")
var ErrIncompleteUpload = errors.New("upload parts are incomplete")
var ErrSessionNotCompleting = errors.New("upload session is not completing")
var ErrCompletionPending = errors.New("upload completion needs recovery")
var ErrInvalidPart = errors.New("invalid upload part")
