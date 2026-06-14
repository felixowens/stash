import React from "react";
import { FormattedMessage } from "react-intl";
import { faEye } from "@fortawesome/free-solid-svg-icons";
import * as GQL from "src/core/generated-graphql";
import { Icon } from "../../Shared/Icon";
import { SweatDrops } from "../../Shared/SweatDrops";
import TextUtils from "src/utils/text";

interface IClipStatChipsProps {
  clip: GQL.ClipDataFragment;
}

// At-a-glance engagement: plays / o-count / length / date.
export const ClipStatChips: React.FC<IClipStatChipsProps> = ({ clip }) => {
  const length = clip.end_seconds - clip.start_seconds;

  return (
    <div className="clip-stat-chips">
      <div className="clip-stat">
        <div className="clip-stat__n">
          <Icon icon={faEye} />
          {clip.play_count ?? 0}
        </div>
        <div className="clip-stat__l">
          <FormattedMessage id="play_count" />
        </div>
      </div>

      <div className="clip-stat">
        <div className="clip-stat__n">
          <SweatDrops />
          {clip.o_counter ?? 0}
        </div>
        <div className="clip-stat__l">
          <FormattedMessage id="o_count" />
        </div>
      </div>

      <div className="clip-stat">
        <div className="clip-stat__n">
          {TextUtils.secondsToTimestamp(length)}
        </div>
        <div className="clip-stat__l">
          <FormattedMessage id="duration" />
        </div>
      </div>

      {clip.date && (
        <div className="clip-stat">
          <div className="clip-stat__n">{clip.date}</div>
          <div className="clip-stat__l">
            <FormattedMessage id="date" />
          </div>
        </div>
      )}
    </div>
  );
};

export default ClipStatChips;
