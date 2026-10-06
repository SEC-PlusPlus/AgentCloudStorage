package knowledge

import (
	"PersonalCloudStorage/internal/file"
	"context"
)

func PrepareFile(ctx context.Context, files *file.Service, ownerID, fileID uint64) ([]Chunk, error) {
	text, err := ExtractText(ctx, files, ownerID, fileID)
	if err != nil {
		return nil, err
	}

	return SplitText(text, 500, 80)
}
