import React, { useState } from "react";
import { Button } from "react-bootstrap";
import { FormattedMessage } from "react-intl";
import { faScissors } from "@fortawesome/free-solid-svg-icons";
import * as GQL from "src/core/generated-graphql";
import { Icon } from "../../Shared/Icon";
import { ClipCardGrid } from "../../Clips/ClipCardGrid";
import { ClipCreateModal } from "../../Clips/ClipDetails/ClipCreateModal";

interface ISceneClipsPanelProps {
  scene: GQL.SceneDataFragment;
  isVisible: boolean;
}

const noopSelect = () => {};

export const SceneClipsPanel: React.FC<ISceneClipsPanelProps> = ({ scene }) => {
  const [creating, setCreating] = useState(false);

  return (
    <div className="scene-clips-panel">
      <div className="clips-panel-header">
        <Button
          className="clip-create-button"
          variant="secondary"
          onClick={() => setCreating(true)}
        >
          <Icon icon={faScissors} className="mr-2" />
          <FormattedMessage id="actions.create_clip" />
        </Button>
      </div>

      {creating && (
        <ClipCreateModal scene={scene} onClose={() => setCreating(false)} />
      )}

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
    </div>
  );
};

export default SceneClipsPanel;
