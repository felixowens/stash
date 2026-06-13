package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"

	"github.com/doug-martin/goqu/v9"
	"github.com/doug-martin/goqu/v9/exp"
	"github.com/jmoiron/sqlx"
	"gopkg.in/guregu/null.v4"
	"gopkg.in/guregu/null.v4/zero"

	"github.com/stashapp/stash/pkg/models"
)

const (
	clipTable = "clips"

	clipIDColumn         = "clip_id"
	clipsTagsTable       = "clips_tags"
	performersClipsTable = "performers_clips"

	clipsViewDatesTable = "clips_view_dates"
	clipViewDateColumn  = "view_date"
	clipsODatesTable    = "clips_o_dates"
	clipODateColumn     = "o_date"
)

type clipRow struct {
	ID            int         `db:"id" goqu:"skipinsert"`
	Title         zero.String `db:"title"`
	Details       zero.String `db:"details"`
	Date          NullDate    `db:"date"`
	DatePrecision null.Int    `db:"date_precision"`
	// expressed as 1-100
	Rating       null.Int  `db:"rating"`
	Organized    bool      `db:"organized"`
	StudioID     null.Int  `db:"studio_id,omitempty"`
	SceneID      int       `db:"scene_id"`
	StartSeconds float64   `db:"start_seconds"`
	EndSeconds   float64   `db:"end_seconds"`
	ResumeTime   float64   `db:"resume_time"`
	PlayDuration float64   `db:"play_duration"`
	CreatedAt    Timestamp `db:"created_at"`
	UpdatedAt    Timestamp `db:"updated_at"`
}

func (r *clipRow) fromClip(o models.Clip) {
	r.ID = o.ID
	r.Title = zero.StringFrom(o.Title)
	r.Details = zero.StringFrom(o.Details)
	r.Date = NullDateFromDatePtr(o.Date)
	r.DatePrecision = datePrecisionFromDatePtr(o.Date)
	r.Rating = intFromPtr(o.Rating)
	r.Organized = o.Organized
	r.StudioID = intFromPtr(o.StudioID)
	r.SceneID = o.SceneID
	r.StartSeconds = o.StartSeconds
	r.EndSeconds = o.EndSeconds
	r.ResumeTime = o.ResumeTime
	r.PlayDuration = o.PlayDuration
	r.CreatedAt = Timestamp{Timestamp: o.CreatedAt}
	r.UpdatedAt = Timestamp{Timestamp: o.UpdatedAt}
}

func (r *clipRow) resolve() *models.Clip {
	return &models.Clip{
		ID:           r.ID,
		Title:        r.Title.String,
		Details:      r.Details.String,
		Date:         r.Date.DatePtr(r.DatePrecision),
		Rating:       nullIntPtr(r.Rating),
		Organized:    r.Organized,
		StudioID:     nullIntPtr(r.StudioID),
		SceneID:      r.SceneID,
		StartSeconds: r.StartSeconds,
		EndSeconds:   r.EndSeconds,
		ResumeTime:   r.ResumeTime,
		PlayDuration: r.PlayDuration,
		CreatedAt:    r.CreatedAt.Timestamp,
		UpdatedAt:    r.UpdatedAt.Timestamp,
	}
}

type clipRowRecord struct {
	updateRecord
}

func (r *clipRowRecord) fromPartial(o models.ClipPartial) {
	r.setNullString("title", o.Title)
	r.setNullString("details", o.Details)
	r.setNullDate("date", "date_precision", o.Date)
	r.setNullInt("rating", o.Rating)
	r.setBool("organized", o.Organized)
	r.setNullInt("studio_id", o.StudioID)
	r.setInt("scene_id", o.SceneID)
	r.setFloat64("start_seconds", o.StartSeconds)
	r.setFloat64("end_seconds", o.EndSeconds)
	r.setFloat64("resume_time", o.ResumeTime)
	r.setFloat64("play_duration", o.PlayDuration)
	r.setTimestamp("created_at", o.CreatedAt)
	r.setTimestamp("updated_at", o.UpdatedAt)
}

type clipRepositoryType struct {
	repository
	tags       joinRepository
	performers joinRepository
}

var (
	clipRepository = clipRepositoryType{
		repository: repository{
			tableName: clipTable,
			idColumn:  idColumn,
		},
		tags: joinRepository{
			repository: repository{
				tableName: clipsTagsTable,
				idColumn:  clipIDColumn,
			},
			fkColumn:     tagIDColumn,
			foreignTable: tagTable,
			orderBy:      tagTableSortSQL,
		},
		performers: joinRepository{
			repository: repository{
				tableName: performersClipsTable,
				idColumn:  clipIDColumn,
			},
			fkColumn: performerIDColumn,
		},
	}
)

type ClipStore struct {
	tableMgr *table
	oDateManager
	viewDateManager

	repo *storeRepository
}

func NewClipStore(r *storeRepository) *ClipStore {
	return &ClipStore{
		tableMgr:        clipTableMgr,
		viewDateManager: viewDateManager{clipsViewTableMgr},
		oDateManager:    oDateManager{clipsOTableMgr},
		repo:            r,
	}
}

func (qb *ClipStore) table() exp.IdentifierExpression {
	return qb.tableMgr.table
}

func (qb *ClipStore) selectDataset() *goqu.SelectDataset {
	return dialect.From(qb.table()).Select(qb.table().All())
}

func (qb *ClipStore) Create(ctx context.Context, newObject *models.Clip) error {
	var r clipRow
	r.fromClip(*newObject)

	id, err := qb.tableMgr.insertID(ctx, r)
	if err != nil {
		return err
	}

	if newObject.PerformerIDs.Loaded() {
		if err := clipsPerformersTableMgr.insertJoins(ctx, id, newObject.PerformerIDs.List()); err != nil {
			return err
		}
	}
	if newObject.TagIDs.Loaded() {
		if err := clipsTagsTableMgr.insertJoins(ctx, id, newObject.TagIDs.List()); err != nil {
			return err
		}
	}

	updated, err := qb.find(ctx, id)
	if err != nil {
		return fmt.Errorf("finding after create: %w", err)
	}

	*newObject = *updated

	return nil
}

func (qb *ClipStore) UpdatePartial(ctx context.Context, id int, partial models.ClipPartial) (*models.Clip, error) {
	r := clipRowRecord{
		updateRecord{
			Record: make(exp.Record),
		},
	}

	r.fromPartial(partial)

	if len(r.Record) > 0 {
		if err := qb.tableMgr.updateByID(ctx, id, r.Record); err != nil {
			return nil, err
		}
	}

	if partial.PerformerIDs != nil {
		if err := clipsPerformersTableMgr.modifyJoins(ctx, id, partial.PerformerIDs.IDs, partial.PerformerIDs.Mode); err != nil {
			return nil, err
		}
	}
	if partial.TagIDs != nil {
		if err := clipsTagsTableMgr.modifyJoins(ctx, id, partial.TagIDs.IDs, partial.TagIDs.Mode); err != nil {
			return nil, err
		}
	}

	return qb.find(ctx, id)
}

func (qb *ClipStore) Update(ctx context.Context, updatedObject *models.Clip) error {
	var r clipRow
	r.fromClip(*updatedObject)

	if err := qb.tableMgr.updateByID(ctx, updatedObject.ID, r); err != nil {
		return err
	}

	if updatedObject.PerformerIDs.Loaded() {
		if err := clipsPerformersTableMgr.replaceJoins(ctx, updatedObject.ID, updatedObject.PerformerIDs.List()); err != nil {
			return err
		}
	}
	if updatedObject.TagIDs.Loaded() {
		if err := clipsTagsTableMgr.replaceJoins(ctx, updatedObject.ID, updatedObject.TagIDs.List()); err != nil {
			return err
		}
	}

	return nil
}

func (qb *ClipStore) Destroy(ctx context.Context, id int) error {
	return qb.tableMgr.destroyExisting(ctx, []int{id})
}

// returns nil, nil if not found
func (qb *ClipStore) Find(ctx context.Context, id int) (*models.Clip, error) {
	ret, err := qb.find(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return ret, err
}

func (qb *ClipStore) FindMany(ctx context.Context, ids []int) ([]*models.Clip, error) {
	clips := make([]*models.Clip, len(ids))

	if err := batchExec(ids, defaultBatchSize, func(batch []int) error {
		q := qb.selectDataset().Prepared(true).Where(qb.table().Col(idColumn).In(batch))
		unsorted, err := qb.getMany(ctx, q)
		if err != nil {
			return err
		}

		for _, s := range unsorted {
			i := slices.Index(ids, s.ID)
			clips[i] = s
		}

		return nil
	}); err != nil {
		return nil, err
	}

	for i := range clips {
		if clips[i] == nil {
			return nil, fmt.Errorf("clip with id %d not found", ids[i])
		}
	}

	return clips, nil
}

// returns nil, sql.ErrNoRows if not found
func (qb *ClipStore) find(ctx context.Context, id int) (*models.Clip, error) {
	q := qb.selectDataset().Where(qb.tableMgr.byID(id))

	ret, err := qb.get(ctx, q)
	if err != nil {
		return nil, err
	}

	return ret, nil
}

// returns nil, sql.ErrNoRows if not found
func (qb *ClipStore) get(ctx context.Context, q *goqu.SelectDataset) (*models.Clip, error) {
	ret, err := qb.getMany(ctx, q)
	if err != nil {
		return nil, err
	}

	if len(ret) == 0 {
		return nil, sql.ErrNoRows
	}

	return ret[0], nil
}

func (qb *ClipStore) getMany(ctx context.Context, q *goqu.SelectDataset) ([]*models.Clip, error) {
	const single = false
	var ret []*models.Clip
	var lastID int
	if err := queryFunc(ctx, q, single, func(r *sqlx.Rows) error {
		var f clipRow
		if err := r.StructScan(&f); err != nil {
			return err
		}

		s := f.resolve()

		if s.ID == lastID {
			return fmt.Errorf("internal error: multiple rows returned for single clip id %d", s.ID)
		}
		lastID = s.ID

		ret = append(ret, s)
		return nil
	}); err != nil {
		return nil, err
	}

	return ret, nil
}

func (qb *ClipStore) FindBySceneID(ctx context.Context, sceneID int) ([]*models.Clip, error) {
	table := qb.table()
	q := qb.selectDataset().Where(table.Col(sceneIDColumn).Eq(sceneID)).Order(table.Col("start_seconds").Asc())
	return qb.getMany(ctx, q)
}

func (qb *ClipStore) Count(ctx context.Context) (int, error) {
	q := dialect.Select(goqu.COUNT("*")).From(qb.table())
	return count(ctx, q)
}

func (qb *ClipStore) All(ctx context.Context) ([]*models.Clip, error) {
	return qb.getMany(ctx, qb.selectDataset())
}

func (qb *ClipStore) makeQuery(ctx context.Context, clipFilter *models.ClipFilterType, findFilter *models.FindFilterType) (*queryBuilder, error) {
	if clipFilter == nil {
		clipFilter = &models.ClipFilterType{}
	}
	if findFilter == nil {
		findFilter = &models.FindFilterType{}
	}

	query := clipRepository.newQuery()
	distinctIDs(&query, clipTable)

	if q := findFilter.Q; q != nil && *q != "" {
		searchColumns := []string{"clips.title", "clips.details"}
		query.parseQueryString(searchColumns, *q)
	}

	filter := filterBuilderFromHandler(ctx, &clipFilterHandler{
		clipFilter: clipFilter,
	})

	if err := query.addFilter(filter); err != nil {
		return nil, err
	}

	if err := qb.setClipSort(&query, findFilter); err != nil {
		return nil, err
	}
	query.sortAndPagination += getPagination(findFilter)

	return &query, nil
}

func (qb *ClipStore) Query(ctx context.Context, clipFilter *models.ClipFilterType, findFilter *models.FindFilterType) ([]*models.Clip, int, error) {
	query, err := qb.makeQuery(ctx, clipFilter, findFilter)
	if err != nil {
		return nil, 0, err
	}

	idsResult, countResult, err := query.executeFind(ctx)
	if err != nil {
		return nil, 0, err
	}

	clips, err := qb.FindMany(ctx, idsResult)
	if err != nil {
		return nil, 0, err
	}

	return clips, countResult, nil
}

func (qb *ClipStore) QueryCount(ctx context.Context, clipFilter *models.ClipFilterType, findFilter *models.FindFilterType) (int, error) {
	query, err := qb.makeQuery(ctx, clipFilter, findFilter)
	if err != nil {
		return 0, err
	}

	return query.executeCount(ctx)
}

var clipSortOptions = sortOptions{
	"created_at",
	"date",
	"duration",
	"id",
	"o_counter",
	"performer_count",
	"play_count",
	"play_duration",
	"random",
	"rating",
	"resume_time",
	"start_seconds",
	"tag_count",
	"title",
	"updated_at",
}

func (qb *ClipStore) setClipSort(query *queryBuilder, findFilter *models.FindFilterType) error {
	if findFilter == nil || findFilter.Sort == nil || *findFilter.Sort == "" {
		return nil
	}

	sort := findFilter.GetSort("created_at")
	direction := findFilter.GetDirection()

	// CVE-2024-32231 - ensure sort is in the list of allowed sorts
	if err := clipSortOptions.validateSort(sort); err != nil {
		return err
	}

	switch sort {
	case "tag_count":
		query.sortAndPagination += getCountSort(clipTable, clipsTagsTable, clipIDColumn, direction)
	case "performer_count":
		query.sortAndPagination += getCountSort(clipTable, performersClipsTable, clipIDColumn, direction)
	case "play_count":
		query.sortAndPagination += getCountSort(clipTable, clipsViewDatesTable, clipIDColumn, direction)
	case "o_counter":
		query.sortAndPagination += getCountSort(clipTable, clipsODatesTable, clipIDColumn, direction)
	case "duration":
		query.sortAndPagination += fmt.Sprintf(" ORDER BY (clips.end_seconds - clips.start_seconds) %s", direction)
	default:
		query.sortAndPagination += getSort(sort, direction, "clips")
	}

	// Whatever the sorting, always use title/id as a final sort
	query.sortAndPagination += ", COALESCE(clips.title, clips.id) COLLATE NATURAL_CI ASC"

	return nil
}

func (qb *ClipStore) GetPerformerIDs(ctx context.Context, id int) ([]int, error) {
	return clipRepository.performers.getIDs(ctx, id)
}

func (qb *ClipStore) GetTagIDs(ctx context.Context, id int) ([]int, error) {
	return clipRepository.tags.getIDs(ctx, id)
}

func (qb *ClipStore) SaveActivity(ctx context.Context, id int, resumeTime *float64, playDuration *float64) (bool, error) {
	if err := qb.tableMgr.checkIDExists(ctx, id); err != nil {
		return false, err
	}

	record := goqu.Record{}

	if resumeTime != nil {
		record["resume_time"] = resumeTime
	}

	if playDuration != nil {
		record["play_duration"] = goqu.L("play_duration + ?", playDuration)
	}

	if len(record) > 0 {
		if err := qb.tableMgr.updateByID(ctx, id, record); err != nil {
			return false, err
		}
	}

	return true, nil
}

func (qb *ClipStore) ResetActivity(ctx context.Context, id int, resetResume bool, resetDuration bool) (bool, error) {
	if err := qb.tableMgr.checkIDExists(ctx, id); err != nil {
		return false, err
	}

	record := goqu.Record{}

	if resetResume {
		record["resume_time"] = 0.0
	}

	if resetDuration {
		record["play_duration"] = 0.0
	}

	if len(record) > 0 {
		if err := qb.tableMgr.updateByID(ctx, id, record); err != nil {
			return false, err
		}
	}

	return true, nil
}
