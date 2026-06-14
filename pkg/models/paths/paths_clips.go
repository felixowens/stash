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

// GetStreamPath is the pre-rendered, full-range playback file for a clip: a
// frame-accurate, full-resolution encode of [start, end] written once in the
// background. When present it's served directly (a plain static file with range
// support) instead of re-transcoding the source scene live on every play.
func (cp *clipPaths) GetStreamPath(clipID int) string {
	return filepath.Join(cp.Clips, strconv.Itoa(clipID)+"_stream.mp4")
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
