import React, { useEffect, useRef, useState } from "react";
import { Button, Collapse, Form, Modal } from "react-bootstrap";
import { FormattedMessage, useIntl } from "react-intl";
import {
  faChevronDown,
  faFilm,
  faPlay,
  faScissors,
  faSliders,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import * as GQL from "src/core/generated-graphql";
import { useClipCreate } from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import { objectTitle } from "src/core/files";
import { Icon } from "../../Shared/Icon";
import { RatingSystem } from "../../Shared/Rating/RatingSystem";
import { PerformerSelect, StudioSelect, TagSelect } from "../../Shared/Select";
import { getPlayerPosition } from "../../ScenePlayer/util";
import { ClipTrimmer } from "../ClipTrimmer";
import { useVideoClock } from "../useVideoClock";

const MIN_LEN = 0.2;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

interface IClipCreateModalProps {
  scene: GQL.SceneDataFragment;
  onClose: () => void;
}

// seed the trim range from where the user was in the scene player when they
// hit "Create Clip" — so the theater opens on the moment they cared about
function seedRange(scene: GQL.SceneDataFragment) {
  const duration = scene.files[0]?.duration ?? 0;
  const pos = getPlayerPosition() ?? 0;
  const start = clamp(pos, 0, Math.max(0, duration - MIN_LEN));
  const end = duration > 0 ? Math.min(start + 10, duration) : start + 10;
  return { in: start, out: end };
}

// The full-screen "theater + bottom dock" create flow: the source scene streams
// into a centered stage, and a full-width trim dock drives it (seek + preview
// loop) before committing the clip. Opens over the scene page as a modal, so the
// trim timeline gets the whole viewport width instead of the narrow tab column.
export const ClipCreateModal: React.FC<IClipCreateModalProps> = ({
  scene,
  onClose,
}) => {
  const intl = useIntl();
  const Toast = useToast();
  const [createClip] = useClipCreate();

  const duration = scene.files[0]?.duration ?? 0;
  const frameRate = scene.files[0]?.frame_rate ?? 30;
  const sceneTitle = objectTitle(scene);

  const videoRef = useRef<HTMLVideoElement>(null);
  const clock = useVideoClock(videoRef, duration);

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

  // latest clock for the document-level key handler (no per-frame rebinds)
  const clockRef = useRef(clock);
  clockRef.current = clock;

  // seek the stage video to the seeded in-point as soon as it has metadata
  const seekedOnce = useRef(false);
  function onLoadedMetadata() {
    if (seekedOnce.current) return;
    seekedOnce.current = true;
    clock.seek(range.in);
  }

  function togglePlay() {
    if (clockRef.current.playing) clockRef.current.pause();
    else clockRef.current.play();
  }

  function setInAtPlayhead() {
    const head = clockRef.current.currentTime;
    setRange((r) => ({
      ...r,
      in: clamp(Math.min(head, r.out - MIN_LEN), 0, duration),
    }));
  }
  function setOutAtPlayhead() {
    const head = clockRef.current.currentTime;
    setRange((r) => ({
      ...r,
      out: clamp(Math.max(head, r.in + MIN_LEN), 0, duration),
    }));
  }

  // I / O set in & out at the playhead, Space toggles play. Intercept in the
  // capture phase + stopImmediatePropagation so they don't also fire the scene
  // page's Mousetrap binds sitting underneath the modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k !== "i" && k !== "o" && k !== " ") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (k === " ") togglePlay();
      else if (k === "i") setInAtPlayhead();
      else setOutAtPlayhead();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close() {
    clock.pause();
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
    <Modal
      show
      onHide={close}
      className="clip-create-modal"
      dialogClassName="clip-create-modal__dialog"
      contentClassName="clip-create-modal__content"
    >
      <div className="clip-theater">
        <header className="clip-theater__head">
          <div className="clip-theater__titles">
            <h2 className="clip-theater__title">
              <Icon icon={faScissors} />
              <FormattedMessage id="actions.create_clip" />
              <span className="clip-theater__from"> — {sceneTitle}</span>
            </h2>
            <span className="clip-theater__hint">
              <kbd>I</kbd> / <kbd>O</kbd> set in &amp; out · <kbd>Space</kbd>{" "}
              play
            </span>
          </div>
          <Button
            variant="secondary"
            className="minimal clip-theater__close"
            onClick={close}
            title={intl.formatMessage({ id: "actions.cancel" })}
          >
            <Icon icon={faXmark} />
          </Button>
        </header>

        <div className="clip-theater__stage">
          <span className="clip-theater__badge">
            <i className="clip-theater__livedot" />
            Trimming
          </span>
          <span className="clip-theater__source">
            <Icon icon={faFilm} />
            {sceneTitle}
          </span>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            className="clip-theater__video"
            src={scene.paths.stream ?? undefined}
            playsInline
            preload="auto"
            onClick={togglePlay}
            onLoadedMetadata={onLoadedMetadata}
          />
          {!clock.playing && (
            <button
              type="button"
              className="clip-theater__play"
              onClick={togglePlay}
              aria-label={intl.formatMessage({ id: "actions.play" })}
            >
              <Icon icon={faPlay} />
            </button>
          )}
        </div>

        <div className="clip-create-dock clip-create-dock--theater">
          <ClipTrimmer
            vttPath={scene.paths.vtt ?? undefined}
            duration={duration}
            frameRate={frameRate}
            inSeconds={range.in}
            outSeconds={range.out}
            onChange={(i, o) => setRange({ in: i, out: o })}
            clock={clock}
            ticks
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
              className={`clip-create-dock__more ${
                showDetails ? "is-open" : ""
              }`}
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
                    onSelect={(items) =>
                      setPerformerIds(items.map((i) => i.id))
                    }
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
      </div>
    </Modal>
  );
};

export default ClipCreateModal;
