import React, { useState } from "react";
import { Button } from "react-bootstrap";
import { FormattedMessage } from "react-intl";
import { faScissors } from "@fortawesome/free-solid-svg-icons";
import * as GQL from "src/core/generated-graphql";
import { Icon } from "../../Shared/Icon";
import { ClipCardGrid } from "../../Clips/ClipCardGrid";
import { ClipCreate } from "../../Clips/ClipDetails/ClipCreate";
import { getPlayer, getPlayerPosition } from "../../ScenePlayer/util";

interface ISceneClipsPanelProps {
  scene: GQL.SceneDataFragment;
  isVisible: boolean;
}

const noopSelect = () => {};

export const SceneClipsPanel: React.FC<ISceneClipsPanelProps> = ({ scene }) => {
  const [createRange, setCreateRange] = useState<{
    start: number;
    end: number;
  } | null>(null);

  function onCreateClip() {
    const duration = scene.files.length > 0 ? scene.files[0].duration ?? 0 : 0;
    const pos = getPlayerPosition() ?? 0;

    let start = pos;
    let end = duration > 0 ? Math.min(pos + 10, duration) : pos + 10;

    // prefer the AB-loop range if one is set
    const player = getPlayer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ab = (player as any)?.abLoopPlugin?.getOptions?.();
    if (ab && typeof ab.end === "number" && ab.end > ab.start) {
      start = ab.start;
      end = ab.end;
    }

    setCreateRange({ start, end });
  }

  return (
    <div className="scene-clips-panel">
      <div className="clips-panel-header">
        <Button variant="secondary" onClick={onCreateClip}>
          <Icon icon={faScissors} className="mr-2" />
          <FormattedMessage id="actions.create_clip" />
        </Button>
      </div>

      {scene.clips.length === 0 ? (
        <div className="no-clips-message">
          <FormattedMessage id="clips" />: 0
        </div>
      ) : (
        <ClipCardGrid
          clips={scene.clips}
          zoomIndex={0}
          selectedIds={new Set()}
          onSelectChange={noopSelect}
        />
      )}

      {createRange && (
        <ClipCreate
          sceneId={scene.id}
          start={createRange.start}
          end={createRange.end}
          defaultStudioId={scene.studio?.id}
          defaultPerformerIds={scene.performers.map((p) => p.id)}
          onClose={() => setCreateRange(null)}
        />
      )}
    </div>
  );
};

export default SceneClipsPanel;
