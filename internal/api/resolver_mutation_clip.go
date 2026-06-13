package api

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/sliceutil/stringslice"
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

	return r.getClip(ctx, newClip.ID)
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

	// NOTE: deleting generated preview/screenshot files (input.DeleteGenerated)
	// is wired up in Phase 3 when clip preview generation lands.

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		return r.repository.Clip.Destroy(ctx, id)
	}); err != nil {
		return false, err
	}

	return true, nil
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
