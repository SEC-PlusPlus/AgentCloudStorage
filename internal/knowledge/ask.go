package knowledge

import (
	"PersonalCloudStorage/internal/file"
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	maxQuestionRunes = 500
	maxContextRunes  = 8000
)

// PrepareAsk 校验问题并组装文件段落文本，返回修剪后的问题与 source。
// 错误仍为普通 error（公网映射保持现状）。
func PrepareAsk(ctx context.Context, files *file.Service, ownerID, fileID uint64, question string) (q, source string, err error) {
	question = strings.TrimSpace(question)
	if question == "" {
		return "", "", errors.New("question is required")
	}
	if utf8.RuneCountInString(question) > maxQuestionRunes {
		return "", "", errors.New("question is too long")
	}

	chunks, err := PrepareFile(ctx, files, ownerID, fileID)
	if err != nil {
		return "", "", fmt.Errorf("prepare file: %w", err)
	}
	if len(chunks) == 0 {
		return "", "", errors.New("file has no text chunks")
	}

	var sb strings.Builder
	totalRunes := 0

	for _, chunk := range chunks {
		totalRunes += utf8.RuneCountInString(chunk.Text)
		if totalRunes > maxContextRunes {
			return "", "", errors.New("file text is too long for this version")
		}
		fmt.Fprintf(&sb, "[%d] %s\n\n", chunk.Number, chunk.Text)
	}

	return question, sb.String(), nil
}

// AskFile 组装问题上下文并通过 Answerer 获取回答。
func AskFile(ctx context.Context, files *file.Service, a Answerer, ownerID, fileID uint64, question string) (string, error) {
	q, source, err := PrepareAsk(ctx, files, ownerID, fileID, question)
	if err != nil {
		return "", err
	}
	return a.Answer(ctx, q, source)
}
