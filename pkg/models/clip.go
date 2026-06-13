package models

// ClipFilterType mirrors the GraphQL ClipFilterType input. Field names and json
// tags must stay in sync with graphql/schema/types/filters.graphql.
type ClipFilterType struct {
	OperatorFilter[ClipFilterType]
	ID      *IntCriterionInput    `json:"id"`
	Title   *StringCriterionInput `json:"title"`
	Details *StringCriterionInput `json:"details"`
	// Filter by rating expressed as 1-100
	Rating100 *IntCriterionInput `json:"rating100"`
	// Filter by organized
	Organized *bool `json:"organized"`
	// Filter by clip duration (end_seconds - start_seconds) in seconds
	Duration *IntCriterionInput `json:"duration"`
	// Filter to only include clips with this studio
	Studios *HierarchicalMultiCriterionInput `json:"studios"`
	// Filter to only include clips with these tags
	Tags *HierarchicalMultiCriterionInput `json:"tags"`
	// Filter by tag count
	TagCount *IntCriterionInput `json:"tag_count"`
	// Filter to only include clips with these performers
	Performers *MultiCriterionInput `json:"performers"`
	// Filter by performer count
	PerformerCount *IntCriterionInput `json:"performer_count"`
	// Filter to only include clips carved from these scenes
	Scenes *MultiCriterionInput `json:"scenes"`
	// Filter by o counter
	OCounter *IntCriterionInput `json:"o_counter"`
	// Filter by play count
	PlayCount *IntCriterionInput `json:"play_count"`
	// Filter by date
	Date *DateCriterionInput `json:"date"`
	// Filter by created at
	CreatedAt *TimestampCriterionInput `json:"created_at"`
	// Filter by updated at
	UpdatedAt *TimestampCriterionInput `json:"updated_at"`
	// Filter by related scenes that meet this criteria
	ScenesFilter *SceneFilterType `json:"scenes_filter"`
	// Filter by related studios that meet this criteria
	StudiosFilter *StudioFilterType `json:"studios_filter"`
	// Filter by related tags that meet this criteria
	TagsFilter *TagFilterType `json:"tags_filter"`
}
