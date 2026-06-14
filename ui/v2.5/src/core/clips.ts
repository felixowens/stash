import TextUtils from "src/utils/text";
import * as GQL from "src/core/generated-graphql";

interface IClip {
  title?: GQL.Maybe<string>;
  start_seconds: number;
  end_seconds: number;
  scene?: GQL.Maybe<{ title?: GQL.Maybe<string> }>;
}

// Returns a display title for a clip: its own title if set, otherwise the
// source scene title (when present) with the trimmed time range appended.
export function clipTitle(clip: Partial<IClip>) {
  if (clip.title) {
    return clip.title;
  }

  const range =
    clip.start_seconds !== undefined && clip.end_seconds !== undefined
      ? TextUtils.formatTimestampRange(clip.start_seconds, clip.end_seconds)
      : "";
  const sceneTitle = clip.scene?.title ?? "";

  if (sceneTitle && range) {
    return `${sceneTitle} (${range})`;
  }
  return range || sceneTitle;
}
