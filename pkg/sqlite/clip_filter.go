package sqlite

import (
	"context"

	"github.com/stashapp/stash/pkg/models"
)

type clipFilterHandler struct {
	clipFilter *models.ClipFilterType
}

func (qb *clipFilterHandler) validate() error {
	clipFilter := qb.clipFilter
	if clipFilter == nil {
		return nil
	}

	if err := validateFilterCombination(clipFilter.OperatorFilter); err != nil {
		return err
	}

	if subFilter := clipFilter.SubFilter(); subFilter != nil {
		sqb := &clipFilterHandler{clipFilter: subFilter}
		if err := sqb.validate(); err != nil {
			return err
		}
	}

	return nil
}

func (qb *clipFilterHandler) handle(ctx context.Context, f *filterBuilder) {
	clipFilter := qb.clipFilter
	if clipFilter == nil {
		return
	}

	if err := qb.validate(); err != nil {
		f.setError(err)
		return
	}

	sf := clipFilter.SubFilter()
	if sf != nil {
		sub := &clipFilterHandler{sf}
		handleSubFilter(ctx, sub, f, clipFilter.OperatorFilter)
	}

	f.handleCriterion(ctx, qb.criterionHandler())
}

func (qb *clipFilterHandler) criterionHandler() criterionHandler {
	filter := qb.clipFilter
	return compoundHandler{
		intCriterionHandler(filter.ID, "clips.id", nil),
		stringCriterionHandler(filter.Title, "clips.title"),
		stringCriterionHandler(filter.Details, "clips.details"),
		intCriterionHandler(filter.Rating100, "clips.rating", nil),
		boolCriterionHandler(filter.Organized, "clips.organized", nil),
		floatIntCriterionHandler(filter.Duration, "(clips.end_seconds - clips.start_seconds)", nil),
		studioCriterionHandler(clipTable, filter.Studios),
		qb.tagsCriterionHandler(filter.Tags),
		qb.tagCountCriterionHandler(filter.TagCount),
		qb.performersCriterionHandler(filter.Performers),
		qb.performerCountCriterionHandler(filter.PerformerCount),
		qb.scenesCriterionHandler(filter.Scenes),
		qb.playCountCriterionHandler(filter.PlayCount),
		qb.oCountCriterionHandler(filter.OCounter),
		&dateCriterionHandler{filter.Date, "clips.date", nil},
		&timestampCriterionHandler{filter.CreatedAt, "clips.created_at", nil},
		&timestampCriterionHandler{filter.UpdatedAt, "clips.updated_at", nil},

		&relatedFilterHandler{
			relatedIDCol:   "clips.scene_id",
			relatedRepo:    sceneRepository.repository,
			relatedHandler: &sceneFilterHandler{filter.ScenesFilter},
		},

		&relatedFilterHandler{
			relatedIDCol:   "clips.studio_id",
			relatedRepo:    studioRepository.repository,
			relatedHandler: &studioFilterHandler{filter.StudiosFilter},
		},

		&relatedFilterHandler{
			relatedIDCol:   "clip_tag.tag_id",
			relatedRepo:    tagRepository.repository,
			relatedHandler: &tagFilterHandler{filter.TagsFilter},
			joinFn: func(f *filterBuilder) {
				clipRepository.tags.innerJoin(f, "clip_tag", "clips.id")
			},
		},
	}
}

func (qb *clipFilterHandler) tagsCriterionHandler(tags *models.HierarchicalMultiCriterionInput) criterionHandlerFunc {
	h := joinedHierarchicalMultiCriterionHandlerBuilder{
		primaryTable: clipTable,
		foreignTable: tagTable,
		foreignFK:    "tag_id",

		relationsTable: "tags_relations",
		joinAs:         "clip_tag",
		joinTable:      clipsTagsTable,
		primaryFK:      clipIDColumn,
	}

	return h.handler(tags)
}

func (qb *clipFilterHandler) tagCountCriterionHandler(tagCount *models.IntCriterionInput) criterionHandlerFunc {
	h := countCriterionHandlerBuilder{
		primaryTable: clipTable,
		joinTable:    clipsTagsTable,
		primaryFK:    clipIDColumn,
	}

	return h.handler(tagCount)
}

func (qb *clipFilterHandler) performersCriterionHandler(performers *models.MultiCriterionInput) criterionHandlerFunc {
	h := joinedMultiCriterionHandlerBuilder{
		primaryTable: clipTable,
		joinTable:    performersClipsTable,
		joinAs:       "performers_join",
		primaryFK:    clipIDColumn,
		foreignFK:    performerIDColumn,

		addJoinTable: func(f *filterBuilder) {
			clipRepository.performers.join(f, "performers_join", "clips.id")
		},
	}

	return h.handler(performers)
}

func (qb *clipFilterHandler) performerCountCriterionHandler(performerCount *models.IntCriterionInput) criterionHandlerFunc {
	h := countCriterionHandlerBuilder{
		primaryTable: clipTable,
		joinTable:    performersClipsTable,
		primaryFK:    clipIDColumn,
	}

	return h.handler(performerCount)
}

func (qb *clipFilterHandler) scenesCriterionHandler(scenes *models.MultiCriterionInput) criterionHandlerFunc {
	h := multiCriterionHandlerBuilder{
		primaryTable: clipTable,
		foreignTable: sceneTable,
		joinTable:    "",
		primaryFK:    "id",
		foreignFK:    sceneIDColumn,
		addJoinsFunc: func(f *filterBuilder) {
			f.addLeftJoin(sceneTable, "", "clips.scene_id = scenes.id")
		},
	}

	return h.handler(scenes)
}

func (qb *clipFilterHandler) playCountCriterionHandler(count *models.IntCriterionInput) criterionHandlerFunc {
	h := countCriterionHandlerBuilder{
		primaryTable: clipTable,
		joinTable:    clipsViewDatesTable,
		primaryFK:    clipIDColumn,
	}

	return h.handler(count)
}

func (qb *clipFilterHandler) oCountCriterionHandler(count *models.IntCriterionInput) criterionHandlerFunc {
	h := countCriterionHandlerBuilder{
		primaryTable: clipTable,
		joinTable:    clipsODatesTable,
		primaryFK:    clipIDColumn,
	}

	return h.handler(count)
}
