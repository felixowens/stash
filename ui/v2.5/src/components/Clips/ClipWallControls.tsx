import React from "react";
import { Button, ButtonGroup, Form } from "react-bootstrap";
import { useIntl } from "react-intl";
import { faShuffle } from "@fortawesome/free-solid-svg-icons";
import { Icon } from "../Shared/Icon";
import { WallFitMode } from "./wallLayout";

/** how many clips can be on the wall at once */
export const WALL_COUNTS = [2, 3, 4];
export const WALL_MODES: WallFitMode[] = ["fill", "fit", "blur"];
export const MIN_SWAP_MS = 3000;
export const MAX_SWAP_MS = 20000;

const MODE_LABELS: Record<WallFitMode, string> = {
  fill: "clips_wall_fill",
  fit: "clips_wall_fit",
  blur: "clips_wall_blur",
};

interface IClipWallControlsProps {
  count: number;
  onSetCount: (count: number) => void;
  mode: WallFitMode;
  onSetMode: (mode: WallFitMode) => void;
  swapMs: number;
  onSetSwapMs: (swapMs: number) => void;
  onReshuffle: () => void;
}

export const ClipWallControls: React.FC<IClipWallControlsProps> = ({
  count,
  onSetCount,
  mode,
  onSetMode,
  swapMs,
  onSetSwapMs,
  onReshuffle,
}) => {
  const intl = useIntl();
  const seconds = Math.round(swapMs / 1000);

  return (
    <div className="clip-wall__controls">
      <ButtonGroup
        size="sm"
        aria-label={intl.formatMessage({ id: "clips_wall_count" })}
      >
        {WALL_COUNTS.map((n) => (
          <Button
            key={n}
            variant={n === count ? "primary" : "secondary"}
            onClick={() => onSetCount(n)}
            title={intl.formatMessage({ id: "clips_wall_count" })}
          >
            {n}
          </Button>
        ))}
      </ButtonGroup>

      <ButtonGroup
        size="sm"
        aria-label={intl.formatMessage({ id: "clips_wall_framing" })}
      >
        {WALL_MODES.map((m) => (
          <Button
            key={m}
            variant={m === mode ? "primary" : "secondary"}
            onClick={() => onSetMode(m)}
            title={intl.formatMessage({ id: "clips_wall_framing" })}
          >
            {intl.formatMessage({ id: MODE_LABELS[m] })}
          </Button>
        ))}
      </ButtonGroup>

      <label className="clip-wall__interval">
        <span className="clip-wall__interval-value">
          {intl.formatMessage({ id: "clips_wall_swap_seconds" }, { seconds })}
        </span>
        <Form.Control
          type="range"
          className="clip-wall__interval-range"
          min={MIN_SWAP_MS}
          max={MAX_SWAP_MS}
          step={500}
          value={swapMs}
          onChange={(e) => onSetSwapMs(Number(e.currentTarget.value))}
          title={intl.formatMessage({ id: "clips_wall_swap_interval" })}
        />
      </label>

      <Button
        size="sm"
        variant="secondary"
        onClick={onReshuffle}
        title={intl.formatMessage({ id: "clips_wall_reshuffle" })}
      >
        <Icon icon={faShuffle} />
      </Button>
    </div>
  );
};

export default ClipWallControls;
