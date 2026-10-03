package folder

import "errors"

var (
	ErrFolderNotFound      = errors.New("folder not found")
	ErrFolderAlreadyExists = errors.New("folder with the same name already exists")
	ErrInvalidFolderName   = errors.New("invalid folder name")
	ErrFolderNotEmpty      = errors.New("folder is not empty")
	ErrInvalidFolderMove   = errors.New("invalid folder move")
)
