package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/pkg/ffmpeg"
	"github.com/stashapp/stash/pkg/fsutil"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/utils"
)

type ClipFinder interface {
	models.ClipGetter
}

type clipRoutes struct {
	routes
	clipFinder  ClipFinder
	sceneFinder models.SceneGetter
	fileGetter  models.FileGetter
}

func (rs clipRoutes) Routes() chi.Router {
	r := chi.NewRouter()

	r.Route("/{clipId}", func(r chi.Router) {
		r.Use(rs.ClipCtx)

		// virtual streaming endpoints — transcode the bounded range of the source scene
		r.Get("/stream.mp4", rs.StreamMp4)
		r.Get("/stream.webm", rs.StreamWebM)

		// generated assets
		r.Get("/preview", rs.Preview)
		r.Get("/screenshot", rs.Screenshot)
	})

	return r
}

func (rs clipRoutes) StreamMp4(w http.ResponseWriter, r *http.Request) {
	rs.streamTranscode(w, r, ffmpeg.StreamTypeMP4)
}

func (rs clipRoutes) StreamWebM(w http.ResponseWriter, r *http.Request) {
	rs.streamTranscode(w, r, ffmpeg.StreamTypeWEBM)
}

func (rs clipRoutes) streamTranscode(w http.ResponseWriter, r *http.Request, streamType ffmpeg.StreamFormat) {
	clip := r.Context().Value(clipKey).(*models.Clip)
	scene, _ := r.Context().Value(sceneKey).(*models.Scene)

	// Fast path: a pre-rendered, full-range mp4 may already exist (generated in
	// the background on clip create/update). Serve it directly — a plain static
	// file with HTTP range support — instead of re-transcoding the source scene
	// live on every play. Only mp4 is pre-rendered; .webm falls through to a
	// live transcode. This also lets a clip play even if live transcoding is off.
	if streamType.MimeType == ffmpeg.StreamTypeMP4.MimeType {
		streamPath := manager.GetInstance().Paths.Clips.GetStreamPath(clip.ID)
		if exists, _ := fsutil.FileExists(streamPath); exists {
			utils.ServeStaticFile(w, r, streamPath)
			return
		}
	}

	streamManager := manager.GetInstance().StreamManager
	if streamManager == nil {
		http.Error(w, "Live transcoding disabled", http.StatusServiceUnavailable)
		return
	}

	if scene == nil {
		http.Error(w, "source scene unavailable", http.StatusNotFound)
		return
	}

	f := scene.Files.Primary()
	if f == nil {
		http.Error(w, "source scene has no primary file", http.StatusNotFound)
		return
	}

	if err := r.ParseForm(); err != nil {
		logger.Warnf("[transcode] error parsing query form: %v", err)
	}

	resolution := r.Form.Get("resolution")

	options := ffmpeg.TranscodeOptions{
		StreamType: streamType,
		VideoFile:  f,
		Resolution: resolution,
		StartTime:  clip.StartSeconds,
		Duration:   clip.Duration(),
		// force a real re-encode so the cut is frame-accurate: -c copy with a
		// mid-file -ss would snap the start to the nearest preceding keyframe
		ForceTranscode: true,
	}

	logger.Debugf("[transcode] streaming clip %d (scene %d, %.2f-%.2fs) as %s", clip.ID, scene.ID, clip.StartSeconds, clip.EndSeconds, streamType.MimeType)
	streamManager.ServeTranscode(w, r, options)
}

func (rs clipRoutes) Preview(w http.ResponseWriter, r *http.Request) {
	clip := r.Context().Value(clipKey).(*models.Clip)
	filepath := manager.GetInstance().Paths.Clips.GetVideoPreviewPath(clip.ID)

	// Preview generation is asynchronous; don't let the browser cache a 404
	// from before the file exists, or it would never load the generated preview.
	if exists, _ := fsutil.FileExists(filepath); !exists {
		w.Header().Set("Cache-Control", "no-store")
		http.Error(w, http.StatusText(http.StatusNotFound), http.StatusNotFound)
		return
	}

	utils.ServeStaticFile(w, r, filepath)
}

func (rs clipRoutes) Screenshot(w http.ResponseWriter, r *http.Request) {
	clip := r.Context().Value(clipKey).(*models.Clip)
	filepath := manager.GetInstance().Paths.Clips.GetScreenshotPath(clip.ID)

	// If the image doesn't exist, send the placeholder. Generation is
	// asynchronous and the screenshot URL is cache-busted only on the clip's
	// updated_at (which generation does not change). The shared static-content
	// helpers mark any "?t="-tagged response as immutable for a year, which would
	// pin the placeholder forever — so write it directly with no-store instead,
	// ensuring the browser re-fetches the real screenshot once it lands.
	exists, _ := fsutil.FileExists(filepath)
	if !exists {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(utils.PendingGenerateResource)
		return
	}

	utils.ServeStaticFile(w, r, filepath)
}

func (rs clipRoutes) ClipCtx(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clipID, err := strconv.Atoi(chi.URLParam(r, "clipId"))
		if err != nil {
			http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
			return
		}

		var clip *models.Clip
		var scene *models.Scene
		_ = rs.withReadTxn(r, func(ctx context.Context) error {
			clip, _ = rs.clipFinder.Find(ctx, clipID)
			if clip == nil {
				return nil
			}

			scene, _ = rs.sceneFinder.Find(ctx, clip.SceneID)
			if scene != nil {
				if err := scene.LoadPrimaryFile(ctx, rs.fileGetter); err != nil {
					if !errors.Is(err, context.Canceled) {
						logger.Errorf("error loading primary file for scene %d: %v", clip.SceneID, err)
					}
					// set scene to nil so that it doesn't try to use the primary file
					scene = nil
				}
			}

			return nil
		})
		if clip == nil {
			http.Error(w, http.StatusText(404), 404)
			return
		}

		ctx := context.WithValue(r.Context(), clipKey, clip)
		ctx = context.WithValue(ctx, sceneKey, scene)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
