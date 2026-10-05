package upload

import (
	"PersonalCloudStorage/internal/storage"
	"sort"
)

func prepareParts(session *Session, parts []Part) ([]storage.UploadedPart, error) {
	if session == nil || session.Size <= 0 || session.PartSize <= 0 {
		return nil, ErrIncompleteUpload
	}

	count := (session.Size-1)/session.PartSize + 1
	if count > maxParts || len(parts) != int(count) {
		return nil, ErrIncompleteUpload
	}

	ordered := append([]Part(nil), parts...)
	sort.Slice(ordered, func(i, j int) bool {
		return ordered[i].PartNumber < ordered[j].PartNumber
	})

	result := make([]storage.UploadedPart, 0, len(ordered))
	for i, part := range ordered {
		expectedSize := session.PartSize
		if remaining := session.Size - int64(i)*session.PartSize; remaining < expectedSize {
			expectedSize = remaining
		}
		if part.PartNumber != i+1 || part.Size != expectedSize || part.ETag == "" {
			return nil, ErrIncompleteUpload
		}

		result = append(result, storage.UploadedPart{
			Number: part.PartNumber,
			Size:   part.Size,
			ETag:   part.ETag,
		})
	}
	return result, nil
}
