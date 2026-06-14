import React, { useMemo } from "react";
import { useSpriteInfo } from "src/hooks/sprite";

// fixed track height the sprite frames are scaled to
const TRACK_H = 64;

interface ISceneFilmstripProps {
  vttPath?: string;
}

// Lays the scene's VTT sprite sheet out as a horizontal strip across the trim
// track. Falls back to a plain dark track when no sprites are available
// (minimal seed / ungenerated scene) — the trim handles still work on time.
const SceneFilmstripImpl: React.FC<ISceneFilmstripProps> = ({ vttPath }) => {
  const sprites = useSpriteInfo(vttPath);

  // total sprite-sheet extents, for scaling a single frame out of the sheet
  const sheet = useMemo(() => {
    if (!sprites || sprites.length === 0) return null;
    const x = Math.max(...sprites.map((s) => s.x + s.w));
    const y = Math.max(...sprites.map((s) => s.y + s.h));
    return { x, y };
  }, [sprites]);

  // null = missing/404, undefined = loading/no path → plain fallback track
  if (!sprites || sprites.length === 0 || !sheet) {
    return <div className="clip-filmstrip clip-filmstrip--empty" />;
  }

  return (
    <div className="clip-filmstrip">
      {sprites.map((s, i) => {
        const scale = TRACK_H / s.h;
        return (
          <div className="clip-filmstrip__cell" key={i}>
            <div
              className="clip-filmstrip__frame"
              style={{
                backgroundImage: `url(${s.url})`,
                backgroundPosition: `${-s.x * scale}px ${-s.y * scale}px`,
                backgroundSize: `${sheet.x * scale}px ${sheet.y * scale}px`,
                width: `${s.w * scale}px`,
                height: `${s.h * scale}px`,
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

export const SceneFilmstrip = React.memo(SceneFilmstripImpl);
