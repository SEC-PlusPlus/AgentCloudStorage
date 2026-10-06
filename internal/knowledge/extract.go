package knowledge

import (
	"PersonalCloudStorage/internal/file"
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const maxTextBytes = 1 << 20

func ExtractText(ctx context.Context, files *file.Service, ownerID, fileID uint64) (string, error) {
	result, err := files.Download(ctx, ownerID, fileID)
	if err != nil {
		return "", fmt.Errorf("download file: %w", err)
	}
	defer result.Reader.Close()

	ext := strings.ToLower(filepath.Ext(result.OriginalName))
	if ext != ".txt" && ext != ".md" {
		return "", errors.New("only .txt and .md files are supported")
	}
	data, err := io.ReadAll(io.LimitReader(result.Reader, maxTextBytes+1))
	if err != nil {
		return "", fmt.Errorf("read file: %w", err)
	}
	if len(data) > maxTextBytes {
		return "", errors.New("text file is too large")
	}
	if !utf8.Valid(data) {
		return "", errors.New("file is not valid UTF-8 text")
	}

	text := strings.TrimSpace(string(data))
	if text == "" {
		return "", errors.New("text file is empty")
	}
	return text, nil
}
