package user

import "errors"

var (
	ErrUserNotFound       = errors.New("user not found")
	ErrUserAlreadyExists  = errors.New("username or email already exists")
	ErrInvalidUsername    = errors.New("username must be between 3 and 32 characters")
	ErrInvalidEmail       = errors.New("invalid email address")
	ErrInvalidPassword    = errors.New("password must be at least 8 characters and no more than 72 bytes")
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrUserDisabled       = errors.New("user is disabled")
)
