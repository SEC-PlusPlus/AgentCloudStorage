package knowledge

import (
	"errors"
	"strings"
)

type Chunk struct {
	Number int
	Text   string
}

func SplitText(text string, chunkSize, overlap int) ([]Chunk, error) {

	if chunkSize <= 0 {
		return nil, errors.New("chunk size must be positive")
	}
	if overlap < 0 || overlap >= chunkSize {
		return nil, errors.New("overlap must be between 0 and chunk size - 1")
	}

	runes := []rune(strings.TrimSpace(text))
	chunks := make([]Chunk, 0)

	for start := 0; start < len(runes); {
		end := start + chunkSize
		if end >= len(runes) {
			end = len(runes)
		}

		content := strings.TrimSpace(string(runes[start:end]))
		if content != "" {
			chunks = append(chunks, Chunk{
				Number: len(chunks) + 1,
				Text:   content,
			})
		}
		if end == len(runes) {
			break
		}

		start = end - overlap
	}

	return chunks, nil
}
