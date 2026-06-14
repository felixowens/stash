import React from "react";
import * as GQL from "src/core/generated-graphql";
import { ClipCard } from "./ClipCard";
import {
  useCardWidth,
  useContainerDimensions,
} from "../Shared/GridCard/GridCard";
import { PatchComponent } from "src/patch";

interface IClipCardGrid {
  clips: GQL.SlimClipDataFragment[];
  selectedIds: Set<string>;
  zoomIndex: number;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
}

const zoomWidths = [240, 340, 480, 640];

export const ClipCardGrid: React.FC<IClipCardGrid> = PatchComponent(
  "ClipCardGrid",
  ({ clips, selectedIds, zoomIndex, onSelectChange }) => {
    const [componentRef, { width: containerWidth }] = useContainerDimensions();
    const cardWidth = useCardWidth(containerWidth, zoomIndex, zoomWidths);

    return (
      <div className="row justify-content-center" ref={componentRef}>
        {clips.map((clip) => (
          <ClipCard
            key={clip.id}
            cardWidth={cardWidth}
            clip={clip}
            zoomIndex={zoomIndex}
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
