package generate

import (
	"context"

	"github.com/stashapp/stash/pkg/fsutil"
	"github.com/stashapp/stash/pkg/logger"
)

// Clips are virtual (non-destructive) assets streamed from their source scene,
// so the only files generated for them are a short hover-preview video and a
// poster screenshot. These reuse the bounded-range marker generators, keyed by
// the clip's ID via g.ClipPaths instead of the source scene hash.

func (g Generator) ClipPreviewVideo(ctx context.Context, input string, clipID int, startSeconds float64, endSeconds float64, includeAudio bool) error {
	lockCtx := g.LockManager.ReadLock(ctx, input)
	defer lockCtx.Cancel()

	output := g.ClipPaths.GetVideoPreviewPath(clipID)
	if !g.Overwrite {
		if exists, _ := fsutil.FileExists(output); exists {
			return nil
		}
	}

	// cap the hover preview at the marker preview duration
	duration := float64(maxMarkerPreviewDuration)
	if clipDuration := endSeconds - startSeconds; clipDuration < maxMarkerPreviewDuration {
		duration = clipDuration
	}

	if err := g.generateFile(lockCtx, g.ClipPaths, mp4Pattern, output, g.markerPreviewVideo(input, sceneMarkerOptions{
		Seconds:  startSeconds,
		Duration: duration,
		Audio:    includeAudio,
	})); err != nil {
		return err
	}

	logger.Debug("created clip video preview: ", output)

	return nil
}

func (g Generator) ClipScreenshot(ctx context.Context, input string, clipID int, startSeconds float64, endSeconds float64, width int) error {
	lockCtx := g.LockManager.ReadLock(ctx, input)
	defer lockCtx.Cancel()

	output := g.ClipPaths.GetScreenshotPath(clipID)
	if !g.Overwrite {
		if exists, _ := fsutil.FileExists(output); exists {
			return nil
		}
	}

	// poster from the midpoint of the clip — more representative than the start frame
	seconds := startSeconds + (endSeconds-startSeconds)/2

	if err := g.generateFile(lockCtx, g.ClipPaths, jpgPattern, output, g.sceneMarkerScreenshot(input, SceneMarkerScreenshotOptions{
		Seconds: seconds,
		Width:   width,
	})); err != nil {
		return err
	}

	logger.Debug("created clip screenshot: ", output)

	return nil
}
