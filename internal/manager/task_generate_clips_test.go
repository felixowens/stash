package manager

import (
	"os"
	"path/filepath"
	"testing"

	modelpaths "github.com/stashapp/stash/pkg/models/paths"
)

func TestGenerateClipsTaskClipExistsRequiresPlaybackStream(t *testing.T) {
	previous := instance
	t.Cleanup(func() { instance = previous })

	generated := t.TempDir()
	paths := modelpaths.NewPaths(generated, filepath.Join(generated, "blobs"))
	instance = &Manager{Paths: &paths}

	const clipID = 42
	writeAsset := func(path string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("asset"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	writeAsset(paths.Clips.GetVideoPreviewPath(clipID))
	writeAsset(paths.Clips.GetScreenshotPath(clipID))

	task := &GenerateClipsTask{}
	if task.clipExists(clipID) {
		t.Fatal("clip without a static playback stream must remain eligible for generation")
	}

	writeAsset(paths.Clips.GetStreamPath(clipID))
	if !task.clipExists(clipID) {
		t.Fatal("clip with playback, preview, and screenshot assets should be complete")
	}
}
