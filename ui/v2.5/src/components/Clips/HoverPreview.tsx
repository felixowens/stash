import React, { useMemo } from "react";
import TextUtils from "src/utils/text";
import { ISceneSpriteInfo } from "src/hooks/sprite";
import { spriteAtTime, spriteCropStyle, spriteSheetExtent } from "./spriteCrop";

// height the hovered sprite frame is rendered at in the floating preview
const PREVIEW_H = 90;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

interface IHoverPreviewProps {
  sprites: ISceneSpriteInfo[] | null | undefined;
  time: number; // seconds under the cursor
  xPct: number; // 0..100 across the track, for horizontal placement
}

// A floating thumbnail + timestamp that tracks the cursor over the trim track —
// instant visual feedback while scrubbing, without waiting on the heavy stream
// seek. Renders just the timestamp when sprites are unavailable.
const HoverPreviewImpl: React.FC<IHoverPreviewProps> = ({
  sprites,
  time,
  xPct,
}) => {
  const sheet = useMemo(
    () => (sprites && sprites.length ? spriteSheetExtent(sprites) : null),
    [sprites]
  );
  const sprite = useMemo(
    () => (sprites && sprites.length ? spriteAtTime(sprites, time) : undefined),
    [sprites, time]
  );

  return (
    <div
      className="clip-trim__hoverpreview"
      style={{ left: `${clamp(xPct, 2, 98)}%` }}
    >
      {sprite && sheet && (
        <div
          className="clip-trim__hoverpreview-thumb"
          style={spriteCropStyle(sprite, sheet, PREVIEW_H)}
        />
      )}
      <span className="clip-trim__hoverpreview-time">
        {TextUtils.secondsToTimestamp(time)}
      </span>
    </div>
  );
};

export const HoverPreview = React.memo(HoverPreviewImpl);
