import React from "react";
import { Link } from "react-router-dom";
import { FormattedMessage } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import TextUtils from "src/utils/text";
import { TagLink } from "../../Shared/TagLink";

interface IClipDetailPanelProps {
  clip: GQL.ClipDataFragment;
}

export const ClipDetailPanel: React.FC<IClipDetailPanelProps> = ({ clip }) => {
  function renderField(labelId: string, value: React.ReactNode) {
    if (!value) return undefined;
    return (
      <div className="detail-item">
        <span className="detail-item-title">
          <FormattedMessage id={labelId} />
        </span>
        <span className="detail-item-value">{value}</span>
      </div>
    );
  }

  return (
    <div className="clip-detail-panel detail-group">
      {renderField(
        "scene",
        clip.scene ? (
          <Link to={`/scenes/${clip.scene.id}`}>
            {clip.scene.title || `Scene ${clip.scene.id}`}
          </Link>
        ) : undefined
      )}

      {renderField(
        "duration",
        TextUtils.formatTimestampRange(clip.start_seconds, clip.end_seconds)
      )}

      {renderField("date", clip.date)}

      {renderField(
        "studio",
        clip.studio ? (
          <Link to={`/studios/${clip.studio.id}`}>{clip.studio.name}</Link>
        ) : undefined
      )}

      {clip.performers.length > 0 &&
        renderField(
          "performers",
          <ul className="comma-list">
            {clip.performers.map((p) => (
              <li key={p.id}>
                <Link to={`/performers/${p.id}`}>{p.name}</Link>
              </li>
            ))}
          </ul>
        )}

      {clip.tags.length > 0 &&
        renderField(
          "tags",
          <ul className="comma-list">
            {clip.tags.map((tag) => (
              <TagLink key={tag.id} tag={tag} linkType="scene" />
            ))}
          </ul>
        )}

      {renderField("details", clip.details)}
    </div>
  );
};

export default ClipDetailPanel;
