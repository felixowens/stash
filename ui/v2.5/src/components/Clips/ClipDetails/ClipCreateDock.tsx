import React, { useState } from "react";
import { Button, Collapse, Form } from "react-bootstrap";
import { FormattedMessage, useIntl } from "react-intl";
import {
  faChevronDown,
  faScissors,
  faSliders,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import * as GQL from "src/core/generated-graphql";
import { useClipCreate } from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import { Icon } from "../../Shared/Icon";
import { RatingSystem } from "../../Shared/Rating/RatingSystem";
import { PerformerSelect, StudioSelect, TagSelect } from "../../Shared/Select";
import { getAbLoopPlugin, getPlayerPosition } from "../../ScenePlayer/util";
import { ClipTrimmer } from "../ClipTrimmer";
import { useSceneClock } from "../useSceneClock";

interface IClipCreateDockProps {
  scene: GQL.SceneDataFragment;
  onClose: () => void;
}

// seed the trim range from the live playhead, preferring an AB-loop if one is set
function seedRange(scene: GQL.SceneDataFragment) {
  const duration = scene.files[0]?.duration ?? 0;
  const pos = getPlayerPosition() ?? 0;
  let start = pos;
  let end = duration > 0 ? Math.min(pos + 10, duration) : pos + 10;

  const ab = getAbLoopPlugin()?.getOptions();
  if (ab && typeof ab.end === "number" && ab.end > ab.start) {
    // values are numeric at runtime; coerce to satisfy the loose plugin typing
    start = Number(ab.start);
    end = Number(ab.end);
  }
  return { in: start, out: end };
}

// The in-tab "theater + bottom dock" create flow: a trim track that drives the
// live scene player, plus an inline create bar (title + optional details).
// Nothing covers the video — the player stays in its own column.
export const ClipCreateDock: React.FC<IClipCreateDockProps> = ({
  scene,
  onClose,
}) => {
  const intl = useIntl();
  const Toast = useToast();
  const [createClip] = useClipCreate();

  const duration = scene.files[0]?.duration ?? 0;
  const frameRate = scene.files[0]?.frame_rate ?? 30;
  const clock = useSceneClock(duration);

  const [range, setRange] = useState(() => seedRange(scene));
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [rating100, setRating100] = useState<number | undefined>();
  const [studioId, setStudioId] = useState<string | undefined>(
    scene.studio?.id
  );
  const [performerIds, setPerformerIds] = useState<string[]>(
    scene.performers.map((p) => p.id)
  );
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const rangeValid = range.out > range.in;

  function close() {
    clock.clearLoop();
    onClose();
  }

  async function onCreate() {
    if (!rangeValid) return;
    setIsCreating(true);
    try {
      await createClip({
        variables: {
          input: {
            scene_id: scene.id,
            start_seconds: range.in,
            end_seconds: range.out,
            title: title || null,
            date: date || null,
            rating100: rating100 ?? null,
            studio_id: studioId ?? null,
            performer_ids: performerIds,
            tag_ids: tagIds,
          },
        },
      });
      Toast.success(
        intl.formatMessage(
          { id: "toast.created_entity" },
          { entity: intl.formatMessage({ id: "clip" }).toLocaleLowerCase() }
        )
      );
      // the new clip appears in the panel below via cache eviction
      close();
    } catch (e) {
      Toast.error(e);
      setIsCreating(false);
    }
  }

  return (
    <div className="clip-create-dock">
      <div className="clip-create-dock__head">
        <span className="clip-create-dock__title">
          <Icon icon={faScissors} />
          <FormattedMessage id="actions.create_clip" />
        </span>
        <Button
          variant="secondary"
          className="minimal clip-create-dock__close"
          onClick={close}
          title={intl.formatMessage({ id: "actions.cancel" })}
        >
          <Icon icon={faXmark} />
        </Button>
      </div>

      <ClipTrimmer
        vttPath={scene.paths.vtt ?? undefined}
        duration={duration}
        frameRate={frameRate}
        inSeconds={range.in}
        outSeconds={range.out}
        onChange={(i, o) => setRange({ in: i, out: o })}
        clock={clock}
      />

      <div className="clip-create-dock__bar">
        <Form.Control
          className="text-input clip-create-dock__name"
          placeholder="Name this clip (optional)"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        <Button
          variant="secondary"
          className={`clip-create-dock__more ${showDetails ? "is-open" : ""}`}
          onClick={() => setShowDetails((v) => !v)}
        >
          <Icon icon={faSliders} />
          Add details
          <Icon icon={faChevronDown} className="clip-create-dock__chev" />
        </Button>
        <Button
          variant="primary"
          className="clip-create-dock__cta"
          onClick={onCreate}
          disabled={isCreating || !rangeValid}
        >
          <Icon icon={faScissors} />
          <FormattedMessage id="actions.create" />
        </Button>
      </div>

      <Collapse in={showDetails}>
        <div>
          <div className="clip-create-dock__details">
            <Form.Group className="clip-create-dock__field">
              <Form.Label>
                <FormattedMessage id="rating" />
              </Form.Label>
              <RatingSystem
                value={rating100}
                onSetRating={(v) => setRating100(v ?? undefined)}
                disabled={isCreating}
              />
            </Form.Group>

            <Form.Group className="clip-create-dock__field">
              <Form.Label>
                <FormattedMessage id="studio" />
              </Form.Label>
              <StudioSelect
                ids={studioId ? [studioId] : []}
                onSelect={(items) =>
                  setStudioId(items.length ? items[0].id : undefined)
                }
                isClearable
                isDisabled={isCreating}
                menuPortalTarget={document.body}
              />
            </Form.Group>

            <Form.Group className="clip-create-dock__field clip-create-dock__field--wide">
              <Form.Label>
                <FormattedMessage id="performers" />
              </Form.Label>
              <PerformerSelect
                isMulti
                ids={performerIds}
                onSelect={(items) => setPerformerIds(items.map((i) => i.id))}
                isDisabled={isCreating}
                menuPortalTarget={document.body}
              />
            </Form.Group>

            <Form.Group className="clip-create-dock__field clip-create-dock__field--wide">
              <Form.Label>
                <FormattedMessage id="tags" />
              </Form.Label>
              <TagSelect
                isMulti
                ids={tagIds}
                onSelect={(items) => setTagIds(items.map((i) => i.id))}
                isDisabled={isCreating}
                menuPortalTarget={document.body}
              />
            </Form.Group>

            <Form.Group className="clip-create-dock__field">
              <Form.Label>
                <FormattedMessage id="date" />
              </Form.Label>
              <Form.Control
                className="text-input"
                placeholder="YYYY-MM-DD"
                value={date}
                onChange={(e) => setDate(e.currentTarget.value)}
              />
            </Form.Group>
          </div>
        </div>
      </Collapse>
    </div>
  );
};

export default ClipCreateDock;
