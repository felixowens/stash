import React, { useMemo } from "react";
import { ISceneSpriteInfo } from "src/hooks/sprite";
import { IViewport, pctOf } from "./useTimelineViewport";
import { spriteCropStyleFill, spriteSheetExtent } from "./spriteCrop";

interface ISceneFilmstripProps {
  // sprites are fetched once by ClipTrimmer and shared (filmstrip + hover + minimap)
  sprites: ISceneSpriteInfo[] | null | undefined;
  view: IViewport;
}

// Lays the scene's VTT sprite frames across the trim track, positioned by their
// real time through the current viewport — so zooming in spreads the relevant
// frames out instead of squashing the whole scene to the track width. Falls back
// to a plain dark track when no sprites are available (minimal seed / ungenerated
// scene); the trim handles still work on time.
//
// Each frame is held at its natural aspect ratio and never widened past its slot:
// zoomed out, many frames pack the track edge-to-edge; zoomed in past the sprite
// density a frame caps at its natural width and the dark track shows through the
// rest of its slot — coarse zoom reads as empty gaps, not a stretched smear.
const SceneFilmstripImpl: React.FC<ISceneFilmstripProps> = ({
  sprites,
  view,
}) => {
  const sheet = useMemo(
    () => (sprites && sprites.length ? spriteSheetExtent(sprites) : null),
    [sprites]
  );

  const visible = useMemo(
    () =>
      sprites
        ? sprites.filter((s) => s.end > view.start && s.start < view.end)
        : [],
    [sprites, view.start, view.end]
  );

  // null = missing/404, undefined = loading/no path → plain fallback track
  if (!sprites || sprites.length === 0 || !sheet) {
    return <div className="clip-filmstrip clip-filmstrip--empty" />;
  }

  return (
    <div className="clip-filmstrip">
      {visible.map((s) => {
        const left = pctOf(s.start, view);
        const width = pctOf(s.end, view) - left;
        return (
          <div
            className="clip-filmstrip__cell"
            key={s.start}
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            <div
              className="clip-filmstrip__frame"
              style={{
                aspectRatio: `${s.w} / ${s.h}`,
                ...spriteCropStyleFill(s, sheet),
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

export const SceneFilmstrip = React.memo(SceneFilmstripImpl);
