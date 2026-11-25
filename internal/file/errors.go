package file

import "errors"

var ErrFileNotFound = errors.New("file not found")
var ErrInvalidFileName = errors.New("invalid file name")
var ErrInvalidSearchKeyword = errors.New("invalid search keyword")
var ErrQuotaExceeded = errors.New("storage quota exceeded")

// ErrBlobNotFound is the sentinel for an unknown sha256 in the objects table
// (instant-upload probe miss and repo-level lookup miss alike).
var ErrBlobNotFound = errors.New("blob not found")
