package models

import (
	"context"
	"strconv"
	"time"
)

// Clip stores the metadata for a virtual clip: a [StartSeconds, EndSeconds]
// range of a source scene that is a first-class viewable asset with its own
// rating, tags, performers, studio, date and engagement history. Playback is
// non-destructive — the source scene is streamed on the fly — so a clip is
// cascade-deleted when its source scene is removed.
type Clip struct {
	ID int `json:"id"`

	Title   string `json:"title"`
	Details string `json:"details"`
	Date    *Date  `json:"date"`
	// Rating expressed in 1-100 scale
	Rating    *int `json:"rating"`
	Organized bool `json:"organized"`
	StudioID  *int `json:"studio_id"`

	// SceneID is the source scene this clip is carved from.
	SceneID      int     `json:"scene_id"`
	StartSeconds float64 `json:"start_seconds"`
	EndSeconds   float64 `json:"end_seconds"`

	ResumeTime   float64 `json:"resume_time"`
	PlayDuration float64 `json:"play_duration"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	TagIDs       RelatedIDs `json:"tag_ids"`
	PerformerIDs RelatedIDs `json:"performer_ids"`
}

func NewClip() Clip {
	currentTime := time.Now()
	return Clip{
		CreatedAt: currentTime,
		UpdatedAt: currentTime,
	}
}

// ClipPartial represents part of a Clip object. It is used to update the
// database entry. Only non-nil fields will be updated.
type ClipPartial struct {
	Title        OptionalString
	Details      OptionalString
	Date         OptionalDate
	Rating       OptionalInt
	Organized    OptionalBool
	StudioID     OptionalInt
	SceneID      OptionalInt
	StartSeconds OptionalFloat64
	EndSeconds   OptionalFloat64
	ResumeTime   OptionalFloat64
	PlayDuration OptionalFloat64
	CreatedAt    OptionalTime
	UpdatedAt    OptionalTime

	TagIDs       *UpdateIDs
	PerformerIDs *UpdateIDs
}

func NewClipPartial() ClipPartial {
	currentTime := time.Now()
	return ClipPartial{
		UpdatedAt: NewOptionalTime(currentTime),
	}
}

func (c *Clip) LoadTagIDs(ctx context.Context, l TagIDLoader) error {
	return c.TagIDs.load(func() ([]int, error) {
		return l.GetTagIDs(ctx, c.ID)
	})
}

func (c *Clip) LoadPerformerIDs(ctx context.Context, l PerformerIDLoader) error {
	return c.PerformerIDs.load(func() ([]int, error) {
		return l.GetPerformerIDs(ctx, c.ID)
	})
}

// GetTitle returns the title of the clip. If the Title field is empty, the ID
// is returned as a string.
func (c Clip) GetTitle() string {
	if c.Title != "" {
		return c.Title
	}

	return strconv.Itoa(c.ID)
}

// Duration returns the length of the clip in seconds.
func (c Clip) Duration() float64 {
	return c.EndSeconds - c.StartSeconds
}
