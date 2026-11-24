package share

import "errors"

var ErrShareNotFound = errors.New("share not found")
var ErrPassword = errors.New("invalid password")
var ErrNoPassword = errors.New("share does not require a password")
var ErrTooManyShares = errors.New("too many active shares")

// ErrShareGone reports an existing share that is no longer usable, carrying
// one of the Reason* constants for the visitor-facing 410 payload.
type ErrShareGone struct {
	Reason string
}

func (e *ErrShareGone) Error() string {
	return "share unavailable: " + e.Reason
}
