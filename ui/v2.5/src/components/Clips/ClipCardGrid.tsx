import React from "react";
import * as GQL from "src/core/generated-graphql";
import { ClipCard } from "./ClipCard";
import { PatchComponent } from "src/patch";

interface IClipCardGrid {
  clips: GQL.SlimClipDataFragment[];
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
}

// zoomIndex (0..3) → minimum mosaic tile width; the CSS grid auto-fills columns.
const tileMins = [148, 178, 220, 280];

export const ClipCardGrid: React.FC<IClipCardGrid> = PatchComponent(
  "ClipCardGrid",
  ({ clips, selectedIds, zoomIndex, onSelectChange }) => {
    const tileMin = tileMins[zoomIndex] ?? tileMins[1];

    return (
      <div
        className="clip-card-grid"
        style={{ "--clip-tile-min": `${tileMin}px` } as React.CSSProperties}
      >
        {clips.map((clip) => (
          <ClipCard
            key={clip.id}
            clip={clip}
            selecting={selectedIds.size > 0}
            selected={selectedIds.has(clip.id)}
            onSelectedChanged={(selected: boolean, shiftKey: boolean) =>
              onSelectChange(clip.id, selected, shiftKey)
            }
          />
        ))}
      </div>
    );
  }
);
