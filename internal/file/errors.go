package file

import "errors"

var ErrFileNotFound = errors.New("file not found")
var ErrInvalidFileName = errors.New("invalid file name")
var ErrInvalidSearchKeyword = errors.New("invalid search keyword")
var ErrQuotaExceeded = errors.New("storage quota exceeded")

// ErrBlobNotFound is the sentinel for an unknown sha256 in the objects table
// (instant-upload probe miss and repo-level lookup miss alike).
var ErrBlobNotFound = errors.New("blob not found")

// ErrInvalidSha256 rejects non-64-lowercase-hex input at the blob primitives.
// INSERT IGNORE would silently COERCE such input into a garbage primary key
// with created=true (a phantom refcount row), so the primitive guards it.
var ErrInvalidSha256 = errors.New("invalid sha256")

// ErrBlobBusy is the bounded-retry exhaustion sentinel (B1 review RF1),
// shared by the instant probe (B3) and the direct-upload dedup transaction
// (B4): the acquire+create tx lost the InnoDB deadlock race (1213) or hit the
// lock-wait timeout (1205) on every attempt. Nothing was written — MySQL rolls
// the loser back cleanly — so the client may safely retry the whole call
// (probe re-attempt is byte-free; direct upload re-sends the body). Handlers
// map it to 409.
var ErrBlobBusy = errors.New("blob busy, retry")
