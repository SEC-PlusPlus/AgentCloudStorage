package file

import "errors"

var ErrFileNotFound = errors.New("file not found")
var ErrInvalidFileName = errors.New("invalid file name")
var ErrInvalidSearchKeyword = errors.New("invalid search keyword")
var ErrQuotaExceeded = errors.New("storage quota exceeded")
