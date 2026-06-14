import React, { useMemo } from "react";
import { FormattedMessage } from "react-intl";
import { faFilm } from "@fortawesome/free-solid-svg-icons";
import * as GQL from "src/core/generated-graphql";
import { Icon } from "../../Shared/Icon";
import { ClipCard } from "../ClipCard";

interface IClipRelatedStripProps {
  clip: GQL.ClipDataFragment;
}

// "More from this scene" — other clips carved from the same source scene,
// ordered by their position in the scene.
export const ClipRelatedStrip: React.FC<IClipRelatedStripProps> = ({
  clip,
}) => {
  const sceneId = clip.scene?.id;

  const { data } = GQL.useFindClipsQuery({
    skip: !sceneId,
    variables: {
      filter: { per_page: 25 },
      clip_filter: sceneId
        ? {
            scenes: {
              modifier: GQL.CriterionModifier.Includes,
              value: [sceneId],
            },
          }
        : undefined,
    },
  });

  const related = useMemo(() => {
    return (data?.findClips.clips ?? [])
      .filter((c) => c.id !== clip.id)
      .slice()
      .sort((a, b) => a.start_seconds - b.start_seconds);
  }, [data, clip.id]);

  if (!sceneId || related.length === 0) return null;

  return (
    <div className="clip-related">
      <h3 className="clip-related__head">
        <Icon icon={faFilm} />
        <FormattedMessage id="clips_more_from_scene" />
      </h3>
      <div className="clip-related__strip">
        {related.map((c) => (
          <div className="clip-related__item" key={c.id}>
            <ClipCard clip={c} />
          </div>
        ))}
      </div>
    </div>
  );
};

export default ClipRelatedStrip;
