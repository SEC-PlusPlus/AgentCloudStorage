package folder

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

type CreateInput struct {
	OwnerID  uint64
	ParentID uint64
	Name     string
}

type ListInput struct {
	OwnerID  uint64
	ParentID uint64
}

type RenameInput struct {
	OwnerID  uint64
	FolderID uint64
	NewName  string
}

type MoveInput struct {
	OwnerID        uint64
	FolderID       uint64
	TargetParentID uint64
}

type FileChecker interface {
	HasFilesInFolder(ctx context.Context, ownerID uint64, folderID uint64) (bool, error)
}

type Service struct {
	repo  Repository
	files FileChecker
}

func NewService(repo Repository, files FileChecker) *Service {
	return &Service{
		repo:  repo,
		files: files,
	}
}

func (s *Service) Create(ctx context.Context, input CreateInput) (*Folder, error) {
	//校验参数
	if input.OwnerID == 0 {
		return nil, errors.New("owner id is required")
	}

	name := strings.TrimSpace(input.Name)
	if !validFolderName(name) {
		return nil, ErrInvalidFolderName
	}

	// parent_id=0 表示虚拟根目录，不需要查询数据库。
	if input.ParentID != 0 {
		_, err := s.repo.GetByID(
			ctx,
			input.OwnerID,
			input.ParentID,
		)
		if err != nil {
			return nil, fmt.Errorf("validate parent folder: %w", err)
		}
	}
	//调用创建文件夹数据层接口
	createdFolder := &Folder{
		OwnerID:  input.OwnerID,
		ParentID: input.ParentID,
		Name:     name,
	}

	if err := s.repo.Create(ctx, createdFolder); err != nil {
		return nil, fmt.Errorf(
			"create folder: %w",
			err,
		)
	}

	//返回文件夹信息
	return createdFolder, nil

}

func (s *Service) List(ctx context.Context, input ListInput) ([]Folder, error) {
	if input.OwnerID == 0 {
		return nil, errors.New("owner id is required")
	}

	//确认父目录属于当前用户
	if input.ParentID != 0 {
		_, err := s.repo.GetByID(ctx, input.OwnerID, input.ParentID)
		if err != nil {
			return nil, fmt.Errorf("validate parent folder: %w", err)
		}
	}

	folders, err := s.repo.ListByParent(ctx, input.OwnerID, input.ParentID)
	if err != nil {
		return nil, fmt.Errorf("list folders: %w", err)
	}

	return folders, nil
}

func (s *Service) Rename(ctx context.Context, input RenameInput) error {
	if input.OwnerID == 0 {
		return errors.New("owner id is required")
	}

	if input.FolderID == 0 {
		return errors.New("folder id is required")
	}

	newName := strings.TrimSpace(input.NewName)
	if !validFolderName(newName) {
		return ErrInvalidFolderName
	}

	record, err := s.repo.GetByID(ctx, input.OwnerID, input.FolderID)
	if err != nil {
		return fmt.Errorf("get folder for rename: %w", err)
	}

	if record.Name == newName {
		return nil
	}

	if err := s.repo.Rename(ctx, input.OwnerID, input.FolderID, newName); err != nil {
		return fmt.Errorf("rename folder: %w", err)
	}

	return nil
}

func (s *Service) Delete(ctx context.Context, ownerID uint64, folderID uint64) error {
	if ownerID == 0 {
		return errors.New("owner id is required")
	}

	if folderID == 0 {
		return errors.New("folder id is required")
	}

	if _, err := s.repo.GetByID(ctx, ownerID, folderID); err != nil {
		return fmt.Errorf("get folder for delete: %w", err)
	}

	hasChildFolders, err := s.repo.HasChildFolders(ctx, ownerID, folderID)
	if err != nil {
		return fmt.Errorf(
			"check child folders: %w",
			err,
		)
	}

	if hasChildFolders {
		return ErrFolderNotEmpty
	}

	hasFiles, err := s.files.HasFilesInFolder(ctx, ownerID, folderID)
	if err != nil {
		return fmt.Errorf(
			"check files in folder: %w",
			err,
		)
	}

	if hasFiles {
		return ErrFolderNotEmpty
	}

	if err := s.repo.Delete(ctx, ownerID, folderID); err != nil {
		return fmt.Errorf("delete folder: %w", err)
	}

	return nil
}

func (s *Service) Move(
	ctx context.Context,
	input MoveInput,
) error {
	if input.OwnerID == 0 {
		return errors.New("owner id is required")
	}

	if input.FolderID == 0 {
		return errors.New("folder id is required")
	}

	record, err := s.repo.GetByID(
		ctx,
		input.OwnerID,
		input.FolderID,
	)

	if err != nil {
		return fmt.Errorf("get folder for move: %w", err)
	}

	currentID := input.TargetParentID
	visited := make(map[uint64]struct{})

	//防止形成目录循环
	for currentID != 0 {
		if currentID == input.FolderID {
			return ErrInvalidFolderMove
		}
		if _, exists := visited[currentID]; exists {
			return ErrInvalidFolderMove
		}
		visited[currentID] = struct{}{}

		currentFolder, err := s.repo.GetByID(ctx, input.OwnerID, currentID)
		if err != nil {
			return fmt.Errorf("get target folder ancestor: %w", err)
		}
		currentID = currentFolder.ParentID
	}
	if record.ParentID == input.TargetParentID {
		return nil
	}
	if err := s.repo.Move(ctx, input.OwnerID, input.FolderID, input.TargetParentID); err != nil {
		return fmt.Errorf("move folder: %w", err)
	}

	return nil
}

func validFolderName(name string) bool {
	length := utf8.RuneCountInString(name)
	if length < 1 || length > 255 {
		return false
	}
	if name == "." || name == ".." {
		return false
	}

	if strings.ContainsAny(name, `/\`) {
		return false
	}

	for _, character := range name {
		if unicode.IsControl(character) {
			return false
		}
	}

	return true
}

func (s *Service) EnsureOwned(ctx context.Context, ownerID uint64, folderID uint64) error {
	if ownerID == 0 {
		return errors.New("owner id is required")
	}

	if folderID == 0 {
		return nil
	}

	_, err := s.repo.GetByID(ctx, ownerID, folderID)

	if err != nil {
		return fmt.Errorf("ensure folder ownership: %w", err)
	}

	return nil
}
