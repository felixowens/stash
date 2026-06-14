package api

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/sliceutil"
	"github.com/stashapp/stash/pkg/sliceutil/stringslice"
	"github.com/stashapp/stash/pkg/utils"
)

func (r *mutationResolver) ClipCreate(ctx context.Context, input ClipCreateInput) (*models.Clip, error) {
	translator := changesetTranslator{
		inputMap: getUpdateInputMap(ctx),
	}

	sceneID, err := strconv.Atoi(input.SceneID)
	if err != nil {
		return nil, fmt.Errorf("converting scene id: %w", err)
	}

	if input.EndSeconds <= input.StartSeconds {
		return nil, errors.New("end_seconds must be greater than start_seconds")
	}

	newClip := models.NewClip()
	newClip.SceneID = sceneID
	newClip.StartSeconds = input.StartSeconds
	newClip.EndSeconds = input.EndSeconds
	newClip.Title = translator.string(input.Title)
	newClip.Details = translator.string(input.Details)
	newClip.Rating = input.Rating100
	newClip.Organized = translator.bool(input.Organized)

	newClip.Date, err = translator.datePtr(input.Date)
	if err != nil {
		return nil, fmt.Errorf("converting date: %w", err)
	}
	newClip.StudioID, err = translator.intPtrFromString(input.StudioID)
	if err != nil {
		return nil, fmt.Errorf("converting studio id: %w", err)
	}

	newClip.TagIDs, err = translator.relatedIds(input.TagIds)
	if err != nil {
		return nil, fmt.Errorf("converting tag ids: %w", err)
	}

	// performers default to those of the source scene when not specified
	performersProvided := input.PerformerIds != nil
	newClip.PerformerIDs, err = translator.relatedIds(input.PerformerIds)
	if err != nil {
		return nil, fmt.Errorf("converting performer ids: %w", err)
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		// validate the source scene exists
		scene, err := r.repository.Scene.Find(ctx, sceneID)
		if err != nil {
			return err
		}
		if scene == nil {
			return fmt.Errorf("scene with id %d not found", sceneID)
		}

		if !performersProvided {
			if err := scene.LoadPerformerIDs(ctx, r.repository.Scene); err != nil {
				return err
			}
			newClip.PerformerIDs = models.NewRelatedIDs(scene.PerformerIDs.List())
		}

		return r.repository.Clip.Create(ctx, &newClip)
	}); err != nil {
		return nil, err
	}

	// render the clip's stream + preview + screenshot in the background
	// (best-effort — a missing ffmpeg or disabled generation must not fail
	// clip creation)
	enqueueClipGeneration(ctx, newClip.ID)

	return r.getClip(ctx, newClip.ID)
}

// enqueueClipGeneration kicks off background generation of a clip's pre-rendered
// stream, hover preview and poster screenshot. Best-effort: a missing ffmpeg or
// disabled generation must not fail the originating mutation.
func enqueueClipGeneration(ctx context.Context, clipID int) {
	if _, err := manager.GetInstance().Generate(ctx, manager.GenerateMetadataInput{
		ClipIDs:    []string{strconv.Itoa(clipID)},
		SceneClips: true,
	}); err != nil {
		logger.Warnf("error enqueuing clip generation for clip %d: %v", clipID, err)
	}
}

// used to refetch clip after mutations
func (r *mutationResolver) getClip(ctx context.Context, id int) (ret *models.Clip, err error) {
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		ret, err = r.repository.Clip.Find(ctx, id)
		return err
	}); err != nil {
		return nil, err
	}

	return ret, nil
}

func (r *mutationResolver) ClipUpdate(ctx context.Context, input ClipUpdateInput) (ret *models.Clip, err error) {
	translator := changesetTranslator{
		inputMap: getUpdateInputMap(ctx),
	}

	clipID, err := strconv.Atoi(input.ID)
	if err != nil {
		return nil, fmt.Errorf("converting id: %w", err)
	}

	partial := models.NewClipPartial()
	partial.Title = translator.optionalString(input.Title, "title")
	partial.Details = translator.optionalString(input.Details, "details")
	partial.Rating = translator.optionalInt(input.Rating100, "rating100")
	partial.Organized = translator.optionalBool(input.Organized, "organized")
	partial.StartSeconds = translator.optionalFloat64(input.StartSeconds, "start_seconds")
	partial.EndSeconds = translator.optionalFloat64(input.EndSeconds, "end_seconds")

	partial.Date, err = translator.optionalDate(input.Date, "date")
	if err != nil {
		return nil, fmt.Errorf("converting date: %w", err)
	}
	partial.StudioID, err = translator.optionalIntFromString(input.StudioID, "studio_id")
	if err != nil {
		return nil, fmt.Errorf("converting studio id: %w", err)
	}
	partial.SceneID, err = translator.optionalIntFromString(input.SceneID, "scene_id")
	if err != nil {
		return nil, fmt.Errorf("converting scene id: %w", err)
	}
	partial.TagIDs, err = translator.updateIds(input.TagIds, "tag_ids")
	if err != nil {
		return nil, fmt.Errorf("converting tag ids: %w", err)
	}
	partial.PerformerIDs, err = translator.updateIds(input.PerformerIds, "performer_ids")
	if err != nil {
		return nil, fmt.Errorf("converting performer ids: %w", err)
	}

	// if both bounds are being changed, ensure they remain valid
	if partial.StartSeconds.Set && partial.EndSeconds.Set && partial.EndSeconds.Value <= partial.StartSeconds.Value {
		return nil, errors.New("end_seconds must be greater than start_seconds")
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		ret, err = r.repository.Clip.UpdatePartial(ctx, clipID, partial)
		return err
	}); err != nil {
		return nil, err
	}

	// A changed range (or re-pointed source scene) invalidates the pre-rendered
	// stream + poster. Drop the stale files so playback immediately falls back
	// to a live transcode of the corrected range, then regenerate in the
	// background.
	if partial.StartSeconds.Set || partial.EndSeconds.Set || partial.SceneID.Set {
		deleteGeneratedClipFiles(clipID)
		enqueueClipGeneration(ctx, clipID)
	}

	return ret, nil
}

func (r *mutationResolver) BulkClipUpdate(ctx context.Context, input BulkClipUpdateInput) ([]*models.Clip, error) {
	translator := changesetTranslator{
		inputMap: getUpdateInputMap(ctx),
	}

	clipIDs, err := stringslice.StringSliceToIntSlice(input.Ids)
	if err != nil {
		return nil, fmt.Errorf("converting ids: %w", err)
	}

	partial := models.NewClipPartial()
	partial.Rating = translator.optionalInt(input.Rating100, "rating100")
	partial.Organized = translator.optionalBool(input.Organized, "organized")
	partial.StudioID, err = translator.optionalIntFromString(input.StudioID, "studio_id")
	if err != nil {
		return nil, fmt.Errorf("converting studio id: %w", err)
	}
	partial.TagIDs, err = translator.updateIdsBulk(input.TagIds, "tag_ids")
	if err != nil {
		return nil, fmt.Errorf("converting tag ids: %w", err)
	}
	partial.PerformerIDs, err = translator.updateIdsBulk(input.PerformerIds, "performer_ids")
	if err != nil {
		return nil, fmt.Errorf("converting performer ids: %w", err)
	}

	ret := make([]*models.Clip, 0, len(clipIDs))

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.Clip
		for _, id := range clipIDs {
			clip, err := qb.UpdatePartial(ctx, id, partial)
			if err != nil {
				return err
			}
			ret = append(ret, clip)
		}
		return nil
	}); err != nil {
		return nil, err
	}

	return ret, nil
}

func (r *mutationResolver) ClipDestroy(ctx context.Context, input ClipDestroyInput) (bool, error) {
	id, err := strconv.Atoi(input.ID)
	if err != nil {
		return false, fmt.Errorf("converting id: %w", err)
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		return r.repository.Clip.Destroy(ctx, id)
	}); err != nil {
		return false, err
	}

	// after the clip is gone, optionally remove its generated files
	if utils.IsTrue(input.DeleteGenerated) {
		deleteGeneratedClipFiles(id)
	}

	return true, nil
}

// deleteGeneratedClipFiles best-effort removes the preview/screenshot files for
// a destroyed clip.
func deleteGeneratedClipFiles(clipID int) {
	p := manager.GetInstance().Paths.Clips
	for _, path := range []string{
		p.GetStreamPath(clipID),
		p.GetVideoPreviewPath(clipID),
		p.GetScreenshotPath(clipID),
		p.GetWebpPreviewPath(clipID),
	} {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			logger.Warnf("error removing generated clip file %s: %v", path, err)
		}
	}
}

func (r *mutationResolver) ClipsDestroy(ctx context.Context, ids []string) (bool, error) {
	idInts, err := stringslice.StringSliceToIntSlice(ids)
	if err != nil {
		return false, fmt.Errorf("converting ids: %w", err)
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.Clip
		for _, id := range idInts {
			if err := qb.Destroy(ctx, id); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return false, err
	}

	return true, nil
}

func (r *mutationResolver) ClipAddO(ctx context.Context, id string, t []*time.Time) (*HistoryMutationResult, error) {
	clipID, err := strconv.Atoi(id)
	if err != nil {
		return nil, fmt.Errorf("converting id: %w", err)
	}

	var times []time.Time

	// convert time to local time, so that sorting is consistent
	for _, tt := range t {
		times = append(times, tt.Local())
	}

	var updatedTimes []time.Time

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		updatedTimes, err = r.repository.Clip.AddO(ctx, clipID, times)
		return err
	}); err != nil {
		return nil, err
	}

	return &HistoryMutationResult{
		Count:   len(updatedTimes),
		History: sliceutil.ValuesToPtrs(updatedTimes),
	}, nil
}

func (r *mutationResolver) ClipDeleteO(ctx context.Context, id string, t []*time.Time) (*HistoryMutationResult, error) {
	clipID, err := strconv.Atoi(id)
	if err != nil {
		return nil, fmt.Errorf("converting id: %w", err)
	}

	var times []time.Time

	for _, tt := range t {
		times = append(times, *tt)
	}

	var updatedTimes []time.Time

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		updatedTimes, err = r.repository.Clip.DeleteO(ctx, clipID, times)
		return err
	}); err != nil {
		return nil, err
	}

	return &HistoryMutationResult{
		Count:   len(updatedTimes),
		History: sliceutil.ValuesToPtrs(updatedTimes),
	}, nil
}

func (r *mutationResolver) ClipResetO(ctx context.Context, id string) (ret int, err error) {
	clipID, err := strconv.Atoi(id)
	if err != nil {
		return 0, fmt.Errorf("converting id: %w", err)
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		ret, err = r.repository.Clip.ResetO(ctx, clipID)
		return err
	}); err != nil {
		return 0, err
	}

	return ret, nil
}

func (r *mutationResolver) ClipAddPlay(ctx context.Context, id string, t []*time.Time) (*HistoryMutationResult, error) {
	clipID, err := strconv.Atoi(id)
	if err != nil {
		return nil, fmt.Errorf("converting id: %w", err)
	}

	var times []time.Time

	// convert time to local time, so that sorting is consistent
	for _, tt := range t {
		times = append(times, tt.Local())
	}

	var updatedTimes []time.Time

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		updatedTimes, err = r.repository.Clip.AddViews(ctx, clipID, times)
		return err
	}); err != nil {
		return nil, err
	}

	return &HistoryMutationResult{
		Count:   len(updatedTimes),
		History: sliceutil.ValuesToPtrs(updatedTimes),
	}, nil
}

func (r *mutationResolver) ClipDeletePlay(ctx context.Context, id string, t []*time.Time) (*HistoryMutationResult, error) {
	clipID, err := strconv.Atoi(id)
	if err != nil {
		return nil, fmt.Errorf("converting id: %w", err)
	}

	var times []time.Time

	for _, tt := range t {
		times = append(times, *tt)
	}

	var updatedTimes []time.Time

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		updatedTimes, err = r.repository.Clip.DeleteViews(ctx, clipID, times)
		return err
	}); err != nil {
		return nil, err
	}

	return &HistoryMutationResult{
		Count:   len(updatedTimes),
		History: sliceutil.ValuesToPtrs(updatedTimes),
	}, nil
}

func (r *mutationResolver) ClipResetPlayCount(ctx context.Context, id string) (ret int, err error) {
	clipID, err := strconv.Atoi(id)
	if err != nil {
		return 0, fmt.Errorf("converting id: %w", err)
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		ret, err = r.repository.Clip.DeleteAllViews(ctx, clipID)
		return err
	}); err != nil {
		return 0, err
	}

	return ret, nil
}

func (r *mutationResolver) ClipSaveActivity(ctx context.Context, id string, resumeTime *float64, playDuration *float64) (ret bool, err error) {
	clipID, err := strconv.Atoi(id)
	if err != nil {
		return false, fmt.Errorf("converting id: %w", err)
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		ret, err = r.repository.Clip.SaveActivity(ctx, clipID, resumeTime, playDuration)
		return err
	}); err != nil {
		return false, err
	}

	return ret, nil
}

func (r *mutationResolver) ClipResetActivity(ctx context.Context, id string, resetResume *bool, resetDuration *bool) (ret bool, err error) {
	clipID, err := strconv.Atoi(id)
	if err != nil {
		return false, fmt.Errorf("converting id: %w", err)
	}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		ret, err = r.repository.Clip.ResetActivity(ctx, clipID, utils.IsTrue(resetResume), utils.IsTrue(resetDuration))
		return err
	}); err != nil {
		return false, err
	}

	return ret, nil
}
