import { CSSProperties } from "react";
import { ISceneSpriteInfo } from "src/hooks/sprite";

export interface ISpriteSheet {
  x: number;
  y: number;
}

// The full pixel extent of the sprite sheet (max right/bottom of any frame),
// needed to scale a single frame's background crop out of the whole sheet.
export function spriteSheetExtent(
  sprites: ISceneSpriteInfo[]
): ISpriteSheet | null {
  if (!sprites.length) return null;
  const x = Math.max(...sprites.map((s) => s.x + s.w));
  const y = Math.max(...sprites.map((s) => s.y + s.h));
  return { x, y };
}

// CSS to crop a single frame out of the sprite sheet, scaled so the frame is
// `height` px tall (width follows the frame's aspect ratio). Shared by the
// filmstrip cells and the hover preview so the crop math lives in one place.
export function spriteCropStyle(
  s: ISceneSpriteInfo,
  sheet: ISpriteSheet,
  height: number
): CSSProperties {
  const scale = height / s.h;
  return {
    backgroundImage: `url(${s.url})`,
    backgroundPosition: `${-s.x * scale}px ${-s.y * scale}px`,
    backgroundSize: `${sheet.x * scale}px ${sheet.y * scale}px`,
    width: `${s.w * scale}px`,
    height: `${s.h * scale}px`,
  };
}

// CSS to crop a frame so it *fills* its container box (any width/height), via
// percentage background sizing. Unlike spriteCropStyle this stretches the frame
// to the element — used by the filmstrip where each cell is a time-proportional
// slot, so a frame widens to fill its slot when the timeline is zoomed in. Relies
// on the sheet being a uniform grid of equal frames (it always is).
export function spriteCropStyleFill(
  s: ISceneSpriteInfo,
  sheet: ISpriteSheet
): CSSProperties {
  const cols = sheet.x - s.w; // total travel of the bg-position window, x
  const rows = sheet.y - s.h; // ...and y
  return {
    backgroundImage: `url(${s.url})`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${(sheet.x / s.w) * 100}% ${(sheet.y / s.h) * 100}%`,
    backgroundPosition: `${cols > 0 ? (s.x / cols) * 100 : 0}% ${
      rows > 0 ? (s.y / rows) * 100 : 0
    }%`,
  };
}

// The sprite frame covering time `t` (seconds). Sprites are time-ordered, so
// fall back to the last frame starting at/before t (t past the end) or the first
// frame (t before the start) when no frame strictly covers it.
export function spriteAtTime(
  sprites: ISceneSpriteInfo[],
  t: number
): ISceneSpriteInfo | undefined {
  if (!sprites.length) return undefined;
  let candidate = sprites[0];
  for (const s of sprites) {
    if (t >= s.start && t < s.end) return s;
    if (s.start <= t) candidate = s;
  }
  return candidate;
}
