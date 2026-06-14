import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useHistory, useParams } from "react-router-dom";
import { FormattedMessage, useIntl } from "react-intl";
import cx from "classnames";
import {
  faBox,
  faFilm,
  faPencilAlt,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import * as GQL from "src/core/generated-graphql";
import {
  useClipDestroy,
  useClipIncrementO,
  useClipIncrementPlayCount,
  useClipSaveActivity,
  useClipUpdate,
  useFindClip,
} from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import { clipTitle } from "src/core/clips";
import TextUtils from "src/utils/text";
import { LoadingIndicator } from "../../Shared/LoadingIndicator";
import { ErrorMessage } from "../../Shared/ErrorMessage";
import { Icon } from "../../Shared/Icon";
import { SweatDrops } from "../../Shared/SweatDrops";
import { TagLink } from "../../Shared/TagLink";
import { RatingSystem } from "../../Shared/Rating/RatingSystem";
import { ClipEditPanel } from "./ClipEditPanel";
import { ClipStatChips } from "./ClipStatChips";
import { ClipRelatedStrip } from "./ClipRelatedStrip";

const ClipPage: React.FC<{ clip: GQL.ClipDataFragment }> = ({ clip }) => {
  const intl = useIntl();
  const Toast = useToast();
  const history = useHistory();

  const [updateClip] = useClipUpdate();
  const [incrementO] = useClipIncrementO(clip.id);
  const [incrementPlayCount] = useClipIncrementPlayCount();
  const [saveActivity] = useClipSaveActivity();
  const [destroyClip] = useClipDestroy({ id: clip.id, delete_generated: true });

  const [organizedLoading, setOrganizedLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // play tracking
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasIncrementedPlay = useRef(false);
  const watched = useRef(0);
  const lastTime = useRef(0);
  // once a delete is in flight, the clip is gone — suppress the unmount
  // flush so we don't fire saveActivity against a deleted clip.
  const deleted = useRef(false);

  const onSetRating = useCallback(
    (value: number | null) => {
      updateClip({ variables: { input: { id: clip.id, rating100: value } } });
    },
    [updateClip, clip.id]
  );

  const onToggleOrganized = useCallback(async () => {
    setOrganizedLoading(true);
    try {
      await updateClip({
        variables: { input: { id: clip.id, organized: !clip.organized } },
      });
    } catch (e) {
      Toast.error(e);
    }
    setOrganizedLoading(false);
  }, [updateClip, clip.id, clip.organized, Toast]);

  const onDelete = useCallback(async () => {
    try {
      deleted.current = true;
      await destroyClip();
      Toast.success(
        intl.formatMessage(
          { id: "toast.delete_past_tense" },
          {
            count: 1,
            singularEntity: intl.formatMessage({ id: "clip" }),
            pluralEntity: intl.formatMessage({ id: "clips" }),
          }
        )
      );
      history.push("/clips");
    } catch (e) {
      deleted.current = false; // delete failed, clip still exists
      Toast.error(e);
    }
  }, [destroyClip, Toast, intl, history]);

  function onPlay() {
    if (!hasIncrementedPlay.current) {
      hasIncrementedPlay.current = true;
      incrementPlayCount({ variables: { id: clip.id } });
    }
    lastTime.current = videoRef.current?.currentTime ?? 0;
  }

  function onTimeUpdate() {
    const t = videoRef.current?.currentTime ?? 0;
    const delta = t - lastTime.current;
    if (delta > 0 && delta < 2) {
      // accumulate forward playback only (ignore seeks)
      watched.current += delta;
    }
    lastTime.current = t;
  }

  const flushActivity = useCallback(() => {
    if (deleted.current) return;
    const t = videoRef.current?.currentTime ?? 0;
    if (watched.current <= 0) return;
    saveActivity({
      variables: { id: clip.id, resume_time: t, playDuration: watched.current },
    });
    watched.current = 0;
  }, [saveActivity, clip.id]);

  // flush remaining watch time on unmount
  useEffect(() => {
    return () => flushActivity();
  }, [flushActivity]);

  const sceneTitle = clip.scene?.title || `Scene ${clip.scene?.id}`;

  return (
    <div className="clip-detail">
      <div className="clip-detail__hero">
        <div
          className="clip-detail__backdrop"
          style={{
            backgroundImage: clip.paths.screenshot
              ? `url("${clip.paths.screenshot}")`
              : undefined,
          }}
        />

        <div className="clip-detail__grid">
          <div className="clip-detail__player">
            <video
              ref={videoRef}
              className="clip-detail__video"
              controls
              playsInline
              poster={clip.paths.screenshot ?? undefined}
              src={clip.paths.stream ?? undefined}
              onPlay={onPlay}
              onTimeUpdate={onTimeUpdate}
              onPause={flushActivity}
              onEnded={flushActivity}
            />
          </div>

          <div className="clip-detail__rail">
            {isEditing ? (
              <ClipEditPanel clip={clip} onClose={() => setIsEditing(false)} />
            ) : (
              <>
                {clip.scene && (
                  <div className="clip-detail__source">
                    <Icon icon={faFilm} />
                    <Link to={`/scenes/${clip.scene.id}`}>{sceneTitle}</Link>
                    <span className="clip-detail__source-sep">·</span>
                    <Link
                      to={`/scenes/${clip.scene.id}?t=${Math.floor(
                        clip.start_seconds
                      )}`}
                    >
                      <FormattedMessage
                        id="clips_jump_to_moment"
                        values={{
                          time: TextUtils.secondsToTimestamp(
                            clip.start_seconds
                          ),
                        }}
                      />
                    </Link>
                  </div>
                )}

                <h1 className="clip-detail__title">{clipTitle(clip)}</h1>

                <div className="clip-detail__rating">
                  <RatingSystem
                    value={clip.rating100}
                    onSetRating={onSetRating}
                  />
                </div>

                <ClipStatChips clip={clip} />

                <div className="clip-detail__actions">
                  <button
                    type="button"
                    className="clip-detail__act clip-detail__act--primary"
                    onClick={() => incrementO()}
                  >
                    <SweatDrops />
                    <FormattedMessage id="o_count" />
                  </button>
                  <button
                    type="button"
                    className={cx("clip-detail__act", {
                      "is-active": clip.organized,
                    })}
                    onClick={onToggleOrganized}
                    disabled={organizedLoading}
                  >
                    <Icon icon={faBox} />
                    <FormattedMessage id="organized" />
                  </button>
                  <button
                    type="button"
                    className="clip-detail__act"
                    onClick={() => setIsEditing(true)}
                  >
                    <Icon icon={faPencilAlt} />
                    <FormattedMessage id="actions.edit" />
                  </button>
                  <button
                    type="button"
                    className="clip-detail__act clip-detail__act--danger"
                    onClick={onDelete}
                  >
                    <Icon icon={faTrash} />
                    <FormattedMessage id="actions.delete" />
                  </button>
                </div>

                {clip.performers.length > 0 && (
                  <div className="clip-detail__block">
                    <div className="clip-detail__bh">
                      <FormattedMessage id="performers" />
                    </div>
                    <div className="clip-detail__perfrow">
                      {clip.performers.map((p) => (
                        <Link
                          key={p.id}
                          className="clip-detail__perf"
                          to={`/performers/${p.id}`}
                        >
                          <img
                            src={p.image_path ?? undefined}
                            alt={p.name}
                            loading="lazy"
                          />
                          <span className="clip-detail__perf-nm">{p.name}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {clip.tags.length > 0 && (
                  <div className="clip-detail__block">
                    <div className="clip-detail__bh">
                      <FormattedMessage id="tags" />
                    </div>
                    <div className="clip-detail__tags">
                      {clip.tags.map((tag) => (
                        <TagLink key={tag.id} tag={tag} linkType="scene" />
                      ))}
                    </div>
                  </div>
                )}

                {clip.details && (
                  <div className="clip-detail__block">
                    <div className="clip-detail__bh">
                      <FormattedMessage id="details" />
                    </div>
                    <div className="clip-detail__details-text">
                      {clip.details}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <ClipRelatedStrip clip={clip} />
    </div>
  );
};

const Clip: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error } = useFindClip(id);

  if (loading) return <LoadingIndicator />;
  if (error) return <ErrorMessage error={error.message} />;
  if (!data?.findClip)
    return <ErrorMessage error={`No clip found with id ${id}.`} />;

  return <ClipPage clip={data.findClip} />;
};

export default Clip;
