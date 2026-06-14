import { Link } from "react-router-dom";
import * as GQL from "src/core/generated-graphql";
import { Icon } from "../Shared/Icon";
import { GridCard } from "../Shared/GridCard/GridCard";
import { SweatDrops } from "../Shared/SweatDrops";
import { ScenePreview } from "../Scenes/SceneCard";
import { PerformerAvatarStack } from "./PerformerAvatarStack";
import { useConfigurationContext } from "src/hooks/Config";
import { PatchComponent } from "src/patch";
import {
  faEye,
  faFilm,
  faPlay,
  faStar,
} from "@fortawesome/free-solid-svg-icons";
import {
  convertToRatingFormat,
  defaultRatingSystemOptions,
} from "src/utils/rating";
import TextUtils from "src/utils/text";
import { clipTitle } from "src/core/clips";

interface IClipCardProps {
  clip: GQL.SlimClipDataFragment;
  selecting?: boolean;
  selected?: boolean | undefined;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
}

const ClipCardImage = PatchComponent(
  "ClipCard.Image",
  (props: IClipCardProps) => {
    const { configuration } = useConfigurationContext();

    return (
      <ScenePreview
        image={props.clip.paths.screenshot ?? undefined}
        video={props.clip.paths.preview ?? undefined}
        soundActive={configuration?.interface?.soundOnPreview ?? false}
        isPortrait={false}
      />
    );
  }
);

const ClipCardOverlay = PatchComponent(
  "ClipCard.Overlay",
  (props: IClipCardProps) => {
    const { clip } = props;
    const { configuration } = useConfigurationContext();
    const duration = clip.end_seconds - clip.start_seconds;

    const ratingSystemOptions =
      configuration?.ui.ratingSystemOptions ?? defaultRatingSystemOptions;
    const rating = clip.rating100
      ? convertToRatingFormat(clip.rating100, ratingSystemOptions)
      : undefined;

    return (
      <div className="clip-card__overlay">
        {rating !== undefined && (
          <span className="clip-pill clip-pill--star clip-card__rating">
            <Icon icon={faStar} />
            {rating}
          </span>
        )}
        {duration > 0 && (
          <span className="clip-pill clip-pill--dur clip-card__duration">
            {TextUtils.secondsToTimestamp(duration)}
          </span>
        )}

        <div className="clip-card__playcue">
          <span className="clip-card__playcue-circ">
            <Icon icon={faPlay} />
          </span>
        </div>

        <div className="clip-card__reveal">
          <div className="clip-card__title">{clipTitle(clip)}</div>
          {clip.scene && (
            <Link className="clip-card__source" to={`/scenes/${clip.scene.id}`}>
              <Icon icon={faFilm} />
              <span className="clip-card__source-text">
                {clip.scene.title || `Scene ${clip.scene.id}`}
              </span>
            </Link>
          )}
          <div className="clip-card__metafoot">
            <PerformerAvatarStack performers={clip.performers} />
            <div className="clip-card__stats">
              {!!clip.play_count && (
                <span>
                  <Icon icon={faEye} />
                  {clip.play_count}
                </span>
              )}
              {!!clip.o_counter && (
                <span>
                  <SweatDrops />
                  {clip.o_counter}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

export const ClipCard = PatchComponent("ClipCard", (props: IClipCardProps) => {
  return (
    <GridCard
      className="clip-card"
      url={`/clips/${props.clip.id}`}
      title={clipTitle(props.clip)}
      linkClassName="clip-card-link"
      thumbnailSectionClassName="clip-thumb"
      image={<ClipCardImage {...props} />}
      overlays={<ClipCardOverlay {...props} />}
      selected={props.selected}
      selecting={props.selecting}
      onSelectedChanged={props.onSelectedChanged}
    />
  );
});
