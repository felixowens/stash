package paths

import (
	"path/filepath"
	"strconv"
)

// clipPaths resolves the generated preview/screenshot files for virtual clips.
// Clips are keyed by their stable integer ID (unlike scene markers, which key
// off the source scene hash + offset), so each clip owns a single flat set of
// files under Generated/clips.
type clipPaths struct {
	generatedPaths
}

func newClipPaths(p Paths) *clipPaths {
	cp := clipPaths{
		generatedPaths: *p.Generated,
	}
	return &cp
}

func (cp *clipPaths) GetVideoPreviewPath(clipID int) string {
	return filepath.Join(cp.Clips, strconv.Itoa(clipID)+".mp4")
}

func (cp *clipPaths) GetWebpPreviewPath(clipID int) string {
	return filepath.Join(cp.Clips, strconv.Itoa(clipID)+".webp")
}

func (cp *clipPaths) GetScreenshotPath(clipID int) string {
	return filepath.Join(cp.Clips, strconv.Itoa(clipID)+".jpg")
}
