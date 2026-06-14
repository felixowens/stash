import { Button, ButtonGroup } from "react-bootstrap";
import { Link } from "react-router-dom";
import * as GQL from "src/core/generated-graphql";
import { Icon } from "../Shared/Icon";
import { TagLink } from "../Shared/TagLink";
import { HoverPopover } from "../Shared/HoverPopover";
import { GridCard } from "../Shared/GridCard/GridCard";
import { RatingBanner } from "../Shared/RatingBanner";
import { OCounterButton, ViewCountButton } from "../Shared/CountButton";
import { PerformerPopoverButton } from "../Shared/PerformerPopoverButton";
import { TruncatedText } from "../Shared/TruncatedText";
import { ScenePreview } from "../Scenes/SceneCard";
import { useConfigurationContext } from "src/hooks/Config";
import { PatchComponent } from "src/patch";
import { faTag } from "@fortawesome/free-solid-svg-icons";
import TextUtils from "src/utils/text";
import { clipTitle } from "src/core/clips";

interface IClipCardProps {
  clip: GQL.SlimClipDataFragment;
  cardWidth?: number;
  selecting?: boolean;
  selected?: boolean | undefined;
  zoomIndex?: number;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
}

const ClipCardImage = PatchComponent(
  "ClipCard.Image",
  (props: IClipCardProps) => {
    const { configuration } = useConfigurationContext();
    const duration = props.clip.end_seconds - props.clip.start_seconds;

    return (
      <>
        <ScenePreview
          image={props.clip.paths.screenshot ?? undefined}
          video={props.clip.paths.preview ?? undefined}
          soundActive={configuration?.interface?.soundOnPreview ?? false}
          isPortrait={false}
        />
        <div className="scene-specs-overlay">
          {duration > 0 && (
            <span className="overlay-duration">
              {TextUtils.secondsToTimestamp(duration)}
            </span>
          )}
        </div>
        <RatingBanner rating={props.clip.rating100} />
      </>
    );
  }
);

const ClipCardDetails = PatchComponent(
  "ClipCard.Details",
  (props: IClipCardProps) => {
    return (
      <div className="scene-marker-card__details">
        <span className="scene-marker-card__time">
          {TextUtils.formatTimestampRange(
            props.clip.start_seconds,
            props.clip.end_seconds
          )}
        </span>
        {props.clip.scene && (
          <TruncatedText
            className="scene-marker-card__scene"
            lineCount={2}
            text={
              <Link to={`/scenes/${props.clip.scene.id}`}>
                {props.clip.scene.title || `Scene ${props.clip.scene.id}`}
              </Link>
            }
          />
        )}
      </div>
    );
  }
);

const ClipCardPopovers = PatchComponent(
  "ClipCard.Popovers",
  (props: IClipCardProps) => {
    function maybeRenderPerformerPopoverButton() {
      if (props.clip.performers.length <= 0) return;
      return <PerformerPopoverButton performers={props.clip.performers} />;
    }

    function maybeRenderTagPopoverButton() {
      if (props.clip.tags.length <= 0) return;

      const popoverContent = props.clip.tags.map((tag) => (
        <TagLink key={tag.id} tag={tag} linkType="scene" />
      ));

      return (
        <HoverPopover
          className="tag-count"
          placement="bottom"
          content={popoverContent}
        >
          <Button className="minimal">
            <Icon icon={faTag} />
            <span>{props.clip.tags.length}</span>
          </Button>
        </HoverPopover>
      );
    }

    function maybeRenderOCounter() {
      if (!props.clip.o_counter) return;
      return <OCounterButton value={props.clip.o_counter} />;
    }

    function maybeRenderPlayCount() {
      if (!props.clip.play_count) return;
      return <ViewCountButton value={props.clip.play_count} />;
    }

    const hasPopovers =
      props.clip.performers.length > 0 ||
      props.clip.tags.length > 0 ||
      !!props.clip.o_counter ||
      !!props.clip.play_count;

    if (!hasPopovers) return null;

    return (
      <>
        <hr />
        <ButtonGroup className="card-popovers">
          {maybeRenderPerformerPopoverButton()}
          {maybeRenderTagPopoverButton()}
          {maybeRenderOCounter()}
          {maybeRenderPlayCount()}
        </ButtonGroup>
      </>
    );
  }
);

export const ClipCard = PatchComponent("ClipCard", (props: IClipCardProps) => {
  function zoomIndex() {
    if (props.zoomIndex !== undefined) {
      return `zoom-${props.zoomIndex}`;
    }
    return "";
  }

  return (
    <GridCard
      className={`scene-marker-card clip-card ${zoomIndex()}`}
      url={`/clips/${props.clip.id}`}
      title={clipTitle(props.clip)}
      width={props.cardWidth}
      linkClassName="scene-marker-card-link"
      thumbnailSectionClassName="video-section"
      image={<ClipCardImage {...props} />}
      details={<ClipCardDetails {...props} />}
      popovers={<ClipCardPopovers {...props} />}
      selected={props.selected}
      selecting={props.selecting}
      onSelectedChanged={props.onSelectedChanged}
    />
  );
});
