package manager

import (
	"context"
	"fmt"
	"strconv"

	"github.com/stashapp/stash/pkg/fsutil"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/scene/generate"
)

// GenerateClipsTask generates playback, preview, and poster files for virtual
// clips. It operates either over every clip of a single Scene (whose primary
// file is already loaded) or over one specific Clip (whose source scene it
// loads itself).
type GenerateClipsTask struct {
	repository models.Repository
	Scene      *models.Scene
	Clip       *models.Clip
	Overwrite  bool

	generator *generate.Generator
}

func (t *GenerateClipsTask) GetDescription() string {
	if t.Scene != nil {
		return fmt.Sprintf("Generating clips for %s", t.Scene.Path)
	} else if t.Clip != nil {
		return fmt.Sprintf("Generating clip preview for clip ID %d", t.Clip.ID)
	}

	return "Generating clips"
}

func (t *GenerateClipsTask) Start(ctx context.Context) {
	if t.Scene != nil {
		t.generateSceneClips(ctx)
	}

	if t.Clip != nil {
		var scene *models.Scene
		r := t.repository
		if err := r.WithReadTxn(ctx, func(ctx context.Context) error {
			var err error
			scene, err = r.Scene.Find(ctx, t.Clip.SceneID)
			if err != nil {
				return err
			}
			if scene == nil {
				return fmt.Errorf("scene with id %d not found", t.Clip.SceneID)
			}

			return scene.LoadPrimaryFile(ctx, r.File)
		}); err != nil {
			logger.Errorf("error finding scene for clip generation: %v", err)
			return
		}

		videoFile := scene.Files.Primary()
		if videoFile == nil {
			// nothing to do
			return
		}

		t.generateClip(ctx, videoFile, t.Clip)
	}
}

func (t *GenerateClipsTask) generateSceneClips(ctx context.Context) {
	var clips []*models.Clip
	r := t.repository
	if err := r.WithReadTxn(ctx, func(ctx context.Context) error {
		var err error
		clips, err = r.Clip.FindBySceneID(ctx, t.Scene.ID)
		return err
	}); err != nil {
		logger.Errorf("error getting clips: %s", err.Error())
		return
	}

	videoFile := t.Scene.Files.Primary()

	if len(clips) == 0 || videoFile == nil {
		return
	}

	for i, clip := range clips {
		index := i + 1
		logger.Progressf("[generator] <scene %d> clip %d of %d", t.Scene.ID, index, len(clips))

		t.generateClip(ctx, videoFile, clip)
	}
}

func (t *GenerateClipsTask) generateClip(ctx context.Context, videoFile *models.VideoFile, clip *models.Clip) {
	// check if clip range is past the video duration
	if clip.StartSeconds > float64(videoFile.Duration) {
		logger.Warnf("[generator] clip %d starts at %.2fs which exceeds video duration of %.2fs, skipping", clip.ID, clip.StartSeconds, float64(videoFile.Duration))
		return
	}

	if err := fsutil.EnsureDir(instance.Paths.Generated.Clips); err != nil {
		logger.Warnf("could not create the clips folder (%v): %v", instance.Paths.Generated.Clips, err)
	}

	g := t.generator

	// Render playback first: until this file lands every play consumes a live
	// ffmpeg transcode, and concurrent clip surfaces can starve one another.
	if err := g.ClipStreamVideo(ctx, videoFile.Path, clip.ID, clip.StartSeconds, clip.EndSeconds); err != nil {
		logger.Errorf("[generator] failed to generate clip stream video: %v", err)
		logErrorOutput(err)
	}

	if err := g.ClipPreviewVideo(ctx, videoFile.Path, clip.ID, clip.StartSeconds, clip.EndSeconds, instance.Config.GetPreviewAudio()); err != nil {
		logger.Errorf("[generator] failed to generate clip video preview: %v", err)
		logErrorOutput(err)
	}

	if err := g.ClipScreenshot(ctx, videoFile.Path, clip.ID, clip.StartSeconds, clip.EndSeconds, videoFile.Width); err != nil {
		logger.Errorf("[generator] failed to generate clip screenshot: %v", err)
		logErrorOutput(err)
	}
}

func (t *GenerateClipsTask) clipsNeeded(ctx context.Context) int {
	needed := 0
	clips, err := t.repository.Clip.FindBySceneID(ctx, t.Scene.ID)
	if err != nil {
		logger.Errorf("error finding clips: %s", err.Error())
		return 0
	}

	if len(clips) == 0 || t.Scene.Files.Primary() == nil {
		return 0
	}

	for _, clip := range clips {
		if t.Overwrite || !t.clipExists(clip.ID) {
			needed++
		}
	}

	return needed
}

func (t *GenerateClipsTask) clipExists(clipID int) bool {
	streamExists, _ := fsutil.FileExists(instance.Paths.Clips.GetStreamPath(clipID))
	videoExists, _ := fsutil.FileExists(instance.Paths.Clips.GetVideoPreviewPath(clipID))
	screenshotExists, _ := fsutil.FileExists(instance.Paths.Clips.GetScreenshotPath(clipID))

	return streamExists && videoExists && screenshotExists
}

// enqueueMissingClipStreams upgrades clips created before static playback was
// automatic. It queues one resumable background job after startup; completed
// assets are skipped, so subsequent starts only pick up interrupted work.
func (s *Manager) enqueueMissingClipStreams(ctx context.Context) {
	var clips []*models.Clip
	if err := s.Repository.WithReadTxn(ctx, func(ctx context.Context) error {
		var err error
		clips, err = s.Repository.Clip.All(ctx)
		return err
	}); err != nil {
		logger.Warnf("error finding clips missing playback streams: %v", err)
		return
	}

	clipIDs := make([]string, 0, len(clips))
	for _, clip := range clips {
		streamPath := s.Paths.Clips.GetStreamPath(clip.ID)
		if exists, _ := fsutil.FileExists(streamPath); !exists {
			clipIDs = append(clipIDs, strconv.Itoa(clip.ID))
		}
	}
	if len(clipIDs) == 0 {
		return
	}

	if _, err := s.Generate(ctx, GenerateMetadataInput{
		ClipIDs:    clipIDs,
		SceneClips: true,
	}); err != nil {
		logger.Warnf("error enqueuing playback generation for %d clips: %v", len(clipIDs), err)
		return
	}
	logger.Infof("queued playback generation for %d clips missing static streams", len(clipIDs))
}
