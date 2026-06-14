import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useHistory, useParams } from "react-router-dom";
import { Button, Tab, Tabs } from "react-bootstrap";
import { FormattedMessage, useIntl } from "react-intl";
import { faTrash } from "@fortawesome/free-solid-svg-icons";
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
import { LoadingIndicator } from "../../Shared/LoadingIndicator";
import { ErrorMessage } from "../../Shared/ErrorMessage";
import { Icon } from "../../Shared/Icon";
import { RatingSystem } from "../../Shared/Rating/RatingSystem";
import { OrganizedButton } from "../../Scenes/SceneDetails/OrganizedButton";
import { OCounterButton, ViewCountButton } from "../../Shared/CountButton";
import { ClipDetailPanel } from "./ClipDetailPanel";
import { ClipEditPanel } from "./ClipEditPanel";

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

  return (
    <div className="clip-page row">
      <div className="clip-player-container col-xl-7 col-lg-6">
        <video
          ref={videoRef}
          className="clip-player w-100"
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

      <div className="clip-info col-xl-5 col-lg-6">
        <div className="clip-header">
          <h3 className="clip-header-title">{clipTitle(clip)}</h3>
          <div className="clip-header-controls">
            <RatingSystem value={clip.rating100} onSetRating={onSetRating} />
            <OrganizedButton
              loading={organizedLoading}
              organized={clip.organized}
              onClick={onToggleOrganized}
            />
            <OCounterButton
              value={clip.o_counter ?? 0}
              onIncrement={() => incrementO()}
            />
            <ViewCountButton value={clip.play_count ?? 0} />
            <Button variant="danger" className="ml-auto" onClick={onDelete}>
              <Icon icon={faTrash} />
            </Button>
          </div>
          {clip.scene && (
            <div className="clip-source-scene">
              <FormattedMessage id="scene" />:{" "}
              <Link to={`/scenes/${clip.scene.id}`}>
                {clip.scene.title || `Scene ${clip.scene.id}`}
              </Link>
            </div>
          )}
        </div>

        <Tabs id="clip-tabs" defaultActiveKey="clip-details" mountOnEnter>
          <Tab
            eventKey="clip-details"
            title={intl.formatMessage({ id: "details" })}
          >
            <ClipDetailPanel clip={clip} />
          </Tab>
          <Tab
            eventKey="clip-edit"
            title={intl.formatMessage({ id: "actions.edit" })}
          >
            <ClipEditPanel clip={clip} />
          </Tab>
        </Tabs>
      </div>
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
