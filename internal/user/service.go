package user

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

type RegisterInput struct {
	Username string
	Email    string
	Password string
}

type LoginInput struct {
	Email    string
	Password string
}

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{
		repo: repo,
	}
}

func (s *Service) Register(ctx context.Context, input RegisterInput) (*User, error) {
	username := strings.TrimSpace(input.Username)
	email := strings.ToLower(strings.TrimSpace(input.Email))
	password := input.Password

	usernameLength := utf8.RuneCountInString(username)
	if usernameLength < 3 || usernameLength > 32 {
		return nil, ErrInvalidUsername
	}
	parseAddress, err := mail.ParseAddress(email)
	if err != nil || parseAddress.Address != email {
		return nil, ErrInvalidEmail
	}
	passwordLength := utf8.RuneCountInString(password)
	if passwordLength < 8 || len([]byte(password)) > 72 || strings.TrimSpace(password) == "" {
		return nil, ErrInvalidPassword
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}
	createdUser := &User{
		Username:     username,
		Email:        email,
		PasswordHash: string(passwordHash),
		Status:       StatusActive,
	}

	if err := s.repo.Create(ctx, createdUser); err != nil {
		return nil, fmt.Errorf("register user: %w", err)
	}

	return createdUser, nil
}

func (s *Service) Authenticate(ctx context.Context, input LoginInput) (*User, error) {
	email := strings.ToLower(strings.TrimSpace(input.Email))
	password := input.Password

	if email == "" || password == "" {
		return nil, ErrInvalidCredentials
	}

	record, err := s.repo.GetByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			return nil, ErrInvalidCredentials
		}

		return nil, fmt.Errorf(
			"get user for authentication: %w",
			err,
		)
	}

	err = bcrypt.CompareHashAndPassword(
		[]byte(record.PasswordHash),
		[]byte(password),
	)
	if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, fmt.Errorf(
			"compare password hash: %w",
			err,
		)
	}

	if record.Status != StatusActive {
		return nil, ErrUserDisabled
	}

	return record, nil
}
