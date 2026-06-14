package urlbuilders

import (
	"fmt"
	"net/url"
	"strconv"

	"github.com/stashapp/stash/pkg/models"
)

type ClipURLBuilder struct {
	BaseURL   string
	ClipID    string
	UpdatedAt string
}

func NewClipURLBuilder(baseURL string, clip *models.Clip) ClipURLBuilder {
	return ClipURLBuilder{
		BaseURL:   baseURL,
		ClipID:    strconv.Itoa(clip.ID),
		UpdatedAt: strconv.FormatInt(clip.UpdatedAt.Unix(), 10),
	}
}

func (b ClipURLBuilder) GetStreamURL(apiKey string) *url.URL {
	u, err := url.Parse(fmt.Sprintf("%s/clip/%s/stream.mp4", b.BaseURL, b.ClipID))
	if err != nil {
		// shouldn't happen
		panic(err)
	}

	if apiKey != "" {
		v := u.Query()
		v.Set("apikey", apiKey)
		u.RawQuery = v.Encode()
	}
	return u
}

func (b ClipURLBuilder) GetStreamPreviewURL() string {
	return b.BaseURL + "/clip/" + b.ClipID + "/preview"
}

func (b ClipURLBuilder) GetScreenshotURL() string {
	return b.BaseURL + "/clip/" + b.ClipID + "/screenshot?t=" + b.UpdatedAt
}
