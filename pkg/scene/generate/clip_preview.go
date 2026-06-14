package generate

import (
	"context"

	"github.com/stashapp/stash/pkg/ffmpeg"
	"github.com/stashapp/stash/pkg/ffmpeg/transcoder"
	"github.com/stashapp/stash/pkg/fsutil"
	"github.com/stashapp/stash/pkg/logger"
)

const (
	// quality/size knobs for the pre-rendered full clip. Unlike the hover
	// preview, this is the asset the user actually watches, so it keeps source
	// resolution and uses a near-visually-lossless CRF. "medium" keeps the
	// background encode tractable on long or high-res sources.
	clipStreamCRF          = "20"
	clipStreamPreset       = "medium"
	clipStreamAudioBitrate = "128k"
)

// Clips are virtual (non-destructive) assets streamed from their source scene.
// We generate three files per clip, all keyed by the clip's ID via g.ClipPaths
// instead of the source scene hash:
//   - a pre-rendered full-range mp4 (ClipStreamVideo) served as the playback
//     stream so plays don't re-transcode the source live every time;
//   - a short hover-preview video and a poster screenshot (reusing the
//     bounded-range marker generators).

// ClipStreamVideo renders the clip's entire [start, end] range to a single
// frame-accurate, full-resolution mp4 with the moov atom up front (+faststart),
// so it streams instantly and seeks via HTTP range requests. This is the heavy
// generate step; it runs in the background and the stream route falls back to a
// live transcode until the file lands.
func (g Generator) ClipStreamVideo(ctx context.Context, input string, clipID int, startSeconds float64, endSeconds float64) error {
	lockCtx := g.LockManager.ReadLock(ctx, input)
	defer lockCtx.Cancel()

	output := g.ClipPaths.GetStreamPath(clipID)
	if !g.Overwrite {
		if exists, _ := fsutil.FileExists(output); exists {
			return nil
		}
	}

	duration := endSeconds - startSeconds
	if duration <= 0 {
		return nil
	}

	if err := g.generateFile(lockCtx, g.ClipPaths, mp4Pattern, output, g.clipStreamVideo(input, startSeconds, duration)); err != nil {
		return err
	}

	logger.Debug("created clip stream video: ", output)

	return nil
}

func (g Generator) clipStreamVideo(input string, startSeconds float64, duration float64) generateFn {
	return func(lockCtx *fsutil.LockContext, tmpFn string) error {
		var videoArgs ffmpeg.Args
		videoArgs = append(videoArgs,
			"-pix_fmt", "yuv420p",
			"-profile:v", "high",
			"-level", "4.2",
			"-preset", clipStreamPreset,
			"-crf", clipStreamCRF,
			"-movflags", "+faststart",
			"-threads", "4",
			"-strict", "-2",
		)

		var audioArgs ffmpeg.Args
		audioArgs = audioArgs.AudioBitrate(clipStreamAudioBitrate)

		// -ss before -i (fast seek) is still frame-accurate here because we
		// re-encode: ffmpeg decodes from the prior keyframe and drops frames up
		// to the seek point. A -c copy path would snap to the keyframe instead.
		trimOptions := transcoder.TranscodeOptions{
			Duration:   duration,
			StartTime:  startSeconds,
			OutputPath: tmpFn,
			VideoCodec: ffmpeg.VideoCodecLibX264,
			VideoArgs:  videoArgs,
			AudioCodec: ffmpeg.AudioCodecAAC,
			AudioArgs:  audioArgs,
		}

		args := transcoder.Transcode(input, trimOptions)

		return g.generate(lockCtx, args)
	}
}

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
