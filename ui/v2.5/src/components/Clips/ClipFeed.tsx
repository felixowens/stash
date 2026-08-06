import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useHistory, useLocation } from "react-router-dom";
import { FormattedMessage, useIntl } from "react-intl";
import cx from "classnames";
import Mousetrap from "mousetrap";
import {
  faBox,
  faClock,
  faEye,
  faEyeSlash,
  faFilm,
  faForwardStep,
  faPlay,
  faRepeat,
  faShuffle,
  faUpRightFromSquare,
  faVolumeHigh,
  faVolumeXmark,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import * as GQL from "src/core/generated-graphql";
import {
  queryFindClips,
  useClipIncrementO,
  useClipIncrementPlayCount,
  useClipSaveActivity,
  useClipUpdate,
} from "src/core/StashService";
import { ListFilterModel } from "src/models/list-filter/filter";
import { clipTitle } from "src/core/clips";
import TextUtils from "src/utils/text";
import { Icon } from "../Shared/Icon";
import { SweatDrops } from "../Shared/SweatDrops";
import { RatingSystem } from "../Shared/Rating/RatingSystem";
import { LoadingIndicator } from "../Shared/LoadingIndicator";

const PER_PAGE = 40;
// fetch the next page when the user is this many clips from the end
const PREFETCH_AHEAD = 5;
// items within this distance of the active one render their full content
const MOUNT_RADIUS = 3;
// items within this distance mount a real <video> (preloaded, gapless swipes)
const VIDEO_RADIUS = 1;
const DOUBLE_TAP_MS = 280;
/** how long "press h or tap the eye" lingers after entering clean mode */
const CLEAN_HINT_MS = 2000;

const MUTED_KEY = "clip-feed-muted";
const AUTO_ADVANCE_KEY = "clip-feed-auto-advance";
const CLEAN_KEY = "clip-feed-clean";

type FeedOrder = "shuffle" | "newest";

function newSeed() {
  return Math.floor(Math.random() * 10 ** 8);
}

interface IFeedItemProps {
  clip: GQL.SlimClipDataFragment;
  index: number;
  active: boolean;
  mounted: boolean;
  withVideo: boolean;
  muted: boolean;
  autoAdvance: boolean;
  onUnmute: () => void;
  // called when this clip finishes and autoplay-next is on; the parent
  // ignores calls from items that are no longer active
  onEnded: (index: number) => void;
  registerVideo: (index: number, el: HTMLVideoElement | null) => void;
}

const FeedItem: React.FC<IFeedItemProps> = ({
  clip,
  index,
  active,
  mounted,
  withVideo,
  muted,
  autoAdvance,
  onUnmute,
  onEnded,
  registerVideo,
}) => {
  const intl = useIntl();

  const [updateClip] = useClipUpdate();
  const [incrementO] = useClipIncrementO(clip.id);
  const [incrementPlayCount] = useClipIncrementPlayCount();
  const [saveActivity] = useClipSaveActivity();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hasIncrementedPlay = useRef(false);
  const watched = useRef(0);
  const lastTime = useRef(0);
  const tapTimer = useRef<number>();

  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [oBurst, setOBurst] = useState(0);

  // the queue is a detached snapshot (client.query into state), so Apollo
  // cache updates don't reach it — mirror the mutable bits locally
  const [oCount, setOCount] = useState(clip.o_counter ?? 0);
  const [organized, setOrganized] = useState(clip.organized);
  const [rating, setRating] = useState<number | null>(clip.rating100 ?? null);

  const setVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      registerVideo(index, el);
    },
    [index, registerVideo]
  );

  const flushActivity = useCallback(() => {
    if (watched.current <= 0.5) return;
    saveActivity({
      variables: {
        id: clip.id,
        resume_time: videoRef.current?.currentTime ?? 0,
        playDuration: watched.current,
      },
    });
    watched.current = 0;
  }, [saveActivity, clip.id]);

  // play/pause with the active state; flush watch time when scrolled away
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (active) {
      const attempt = video.play();
      if (attempt) {
        attempt.catch(() => {
          // autoplay with sound blocked — retry muted
          video.muted = true;
          video.play().catch(() => setPaused(true));
        });
      }
    } else {
      video.pause();
      flushActivity();
      setPaused(false);
    }
  }, [active, withVideo, flushActivity]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
    }
  }, [muted, withVideo]);

  // flush any remaining watch time on unmount
  useEffect(() => {
    return () => flushActivity();
  }, [flushActivity]);

  useEffect(() => {
    return () => window.clearTimeout(tapTimer.current);
  }, []);

  function onPlay() {
    setPaused(false);
    if (!hasIncrementedPlay.current) {
      hasIncrementedPlay.current = true;
      incrementPlayCount({ variables: { id: clip.id } });
    }
    lastTime.current = videoRef.current?.currentTime ?? 0;
  }

  function onTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    const t = video.currentTime;
    const delta = t - lastTime.current;
    if (delta > 0 && delta < 2) {
      // accumulate forward playback only (ignore seeks)
      watched.current += delta;
    }
    lastTime.current = t;
    if (video.duration > 0) {
      setProgress(t / video.duration);
    }
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
      setPaused(true);
    }
  }

  function doIncrementO() {
    setOBurst(Date.now());
    setOCount((v) => v + 1);
    incrementO().then((result) => {
      const count = result.data?.clipAddO.count;
      if (typeof count === "number") setOCount(count);
    });
  }

  // single tap toggles play; double tap increments the O counter
  function onSurfaceClick() {
    if (tapTimer.current) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = undefined;
      doIncrementO();
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = undefined;
      togglePlay();
    }, DOUBLE_TAP_MS);
  }

  function seekToFraction(e: React.PointerEvent<HTMLDivElement>) {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.min(
      1,
      Math.max(0, (e.clientX - rect.left) / rect.width)
    );
    video.currentTime = fraction * video.duration;
    setProgress(fraction);
  }

  function onSeekPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    seekToFraction(e);
  }

  function onSeekPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.buttons > 0) seekToFraction(e);
  }

  const onToggleOrganized = () => {
    const value = !organized;
    setOrganized(value);
    updateClip({
      variables: { input: { id: clip.id, organized: value } },
    }).catch(() => setOrganized(!value));
  };

  const onSetRating = (value: number | null) => {
    const previous = rating;
    setRating(value);
    updateClip({
      variables: { input: { id: clip.id, rating100: value } },
    }).catch(() => setRating(previous));
  };

  const duration = clip.end_seconds - clip.start_seconds;
  const sceneTitle = clip.scene?.title || `Scene ${clip.scene?.id}`;

  return (
    <section className="clip-feed__item" data-index={index}>
      {mounted && (
        <>
          {clip.paths.screenshot && (
            <div
              className="clip-feed__backdrop"
              style={{ backgroundImage: `url("${clip.paths.screenshot}")` }}
            />
          )}

          <div className="clip-feed__stage" onClick={onSurfaceClick}>
            {withVideo ? (
              <video
                ref={setVideoRef}
                className="clip-feed__video"
                src={clip.paths.stream ?? undefined}
                poster={clip.paths.screenshot ?? undefined}
                preload="auto"
                playsInline
                loop={!autoAdvance}
                muted={muted}
                onPlay={onPlay}
                onPause={() => setPaused(true)}
                onTimeUpdate={onTimeUpdate}
                onWaiting={() => setBuffering(true)}
                onPlaying={() => setBuffering(false)}
                onCanPlay={() => setBuffering(false)}
                onEnded={() => {
                  flushActivity();
                  onEnded(index);
                }}
              />
            ) : (
              clip.paths.screenshot && (
                <img
                  className="clip-feed__poster"
                  src={clip.paths.screenshot}
                  alt=""
                />
              )
            )}

            {active && paused && (
              <div className="clip-feed__state-badge">
                <Icon icon={faPlay} />
              </div>
            )}
            {active && buffering && !paused && (
              <div className="clip-feed__buffering">
                <LoadingIndicator inline small message="" />
              </div>
            )}
            {oBurst > 0 && (
              <div key={oBurst} className="clip-feed__o-burst">
                <SweatDrops />
              </div>
            )}
          </div>

          {active && muted && (
            <button
              type="button"
              className="clip-feed__unmute-pill"
              onClick={onUnmute}
            >
              <Icon icon={faVolumeXmark} />
              <FormattedMessage id="clips_feed_unmute" />
            </button>
          )}

          {/* the one piece of chrome that survives clean mode */}
          <div className="clip-feed__clean-title">{clipTitle(clip)}</div>

          <div className="clip-feed__info">
            <Link className="clip-feed__title" to={`/clips/${clip.id}`}>
              {clipTitle(clip)}
            </Link>

            <div className="clip-feed__meta">
              {clip.studio && (
                <Link
                  className="clip-feed__studio"
                  to={`/studios/${clip.studio.id}`}
                >
                  {clip.studio.name}
                </Link>
              )}
              <span className="clip-feed__chip">
                <Icon icon={faClock} />
                {TextUtils.secondsToTimestamp(duration)}
              </span>
              {clip.scene && (
                <Link
                  className="clip-feed__chip clip-feed__chip--link"
                  to={`/scenes/${clip.scene.id}?t=${Math.floor(
                    clip.start_seconds
                  )}`}
                  title={sceneTitle}
                >
                  <Icon icon={faFilm} />
                  <span className="clip-feed__chip-label">{sceneTitle}</span>
                </Link>
              )}
            </div>

            {clip.performers.length > 0 && (
              <div className="clip-feed__performers">
                {clip.performers.slice(0, 3).map((p) => (
                  <Link
                    key={p.id}
                    className="clip-feed__performer"
                    to={`/performers/${p.id}`}
                  >
                    {p.image_path && <img src={p.image_path} alt="" />}
                    <span>{p.name}</span>
                  </Link>
                ))}
                {clip.performers.length > 3 && (
                  <span className="clip-feed__performer-more">
                    +{clip.performers.length - 3}
                  </span>
                )}
              </div>
            )}

            {clip.tags.length > 0 && (
              <div className="clip-feed__tags">
                {clip.tags.slice(0, 4).map((tag) => (
                  <span key={tag.id} className="clip-feed__tag">
                    {tag.name}
                  </span>
                ))}
                {clip.tags.length > 4 && (
                  <span className="clip-feed__tag clip-feed__tag--more">
                    +{clip.tags.length - 4}
                  </span>
                )}
              </div>
            )}

            <div className="clip-feed__rating">
              <RatingSystem value={rating} onSetRating={onSetRating} />
            </div>
          </div>

          <div className="clip-feed__rail">
            <button
              type="button"
              className="clip-feed__rail-btn clip-feed__rail-btn--o"
              onClick={doIncrementO}
              title={intl.formatMessage({ id: "o_count" })}
            >
              <SweatDrops />
              <span className="clip-feed__rail-count">{oCount}</span>
            </button>
            <button
              type="button"
              className={cx("clip-feed__rail-btn", {
                "is-active": organized,
              })}
              onClick={onToggleOrganized}
              title={intl.formatMessage({ id: "organized" })}
            >
              <Icon icon={faBox} />
            </button>
            <Link
              className="clip-feed__rail-btn"
              to={`/clips/${clip.id}`}
              title={intl.formatMessage({ id: "clips_feed_open_clip" })}
            >
              <Icon icon={faUpRightFromSquare} />
            </Link>
          </div>

          <div
            className="clip-feed__progress"
            onPointerDown={onSeekPointerDown}
            onPointerMove={onSeekPointerMove}
          >
            <div
              className="clip-feed__progress-fill"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </>
      )}
    </section>
  );
};

export const ClipFeed: React.FC = () => {
  const history = useHistory();
  const location = useLocation();
  const intl = useIntl();

  const [order, setOrder] = useState<FeedOrder>("shuffle");
  const [seed, setSeed] = useState(newSeed);
  const [clips, setClips] = useState<GQL.SlimClipDataFragment[]>([]);
  const [total, setTotal] = useState<number>();
  const [activeIndex, setActiveIndexState] = useState(0);
  // mirror of activeIndex for event handlers that must not act on a stale
  // value (e.g. an ended event from a clip the user just scrolled away from)
  const activeIndexRef = useRef(0);
  const setActiveIndex = useCallback((index: number) => {
    activeIndexRef.current = index;
    setActiveIndexState(index);
  }, []);
  const [muted, setMuted] = useState(
    () => localStorage.getItem(MUTED_KEY) !== "0"
  );
  const [autoAdvance, setAutoAdvance] = useState(
    () => localStorage.getItem(AUTO_ADVANCE_KEY) !== "0"
  );

  // clean mode is only ever asked for — nothing times out into it, and nothing
  // but `h` or the eye buttons takes it away, so scrolling and tapping the
  // video keep working with the chrome gone
  const [clean, setClean] = useState(
    () => localStorage.getItem(CLEAN_KEY) === "1"
  );

  const [cleanHint, setCleanHint] = useState(false);
  useEffect(() => {
    if (!clean) {
      setCleanHint(false);
      return;
    }
    setCleanHint(true);
    const timeout = window.setTimeout(() => setCleanHint(false), CLEAN_HINT_MS);
    return () => window.clearTimeout(timeout);
  }, [clean]);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRegistry = useRef(new Map<number, HTMLVideoElement>());
  const pageRef = useRef(0);
  const loadingRef = useRef(false);
  const exhaustedRef = useRef(false);
  // bumped on every queue reset so stale in-flight fetches are dropped
  const generationRef = useRef(0);

  const setMutedPersistent = useCallback((value: boolean) => {
    setMuted(value);
    localStorage.setItem(MUTED_KEY, value ? "1" : "0");
  }, []);

  const setAutoAdvancePersistent = useCallback((value: boolean) => {
    setAutoAdvance(value);
    localStorage.setItem(AUTO_ADVANCE_KEY, value ? "1" : "0");
  }, []);

  const setCleanPersistent = useCallback((value: boolean) => {
    setClean(value);
    localStorage.setItem(CLEAN_KEY, value ? "1" : "0");
  }, []);

  const makeFilter = useCallback(
    (page: number) => {
      const filter = new ListFilterModel(GQL.FilterMode.Clips);
      filter.configureFromQueryString(location.search);
      filter.itemsPerPage = PER_PAGE;
      filter.currentPage = page;
      if (order === "shuffle") {
        filter.sortBy = "random";
        filter.randomSeed = seed;
      } else {
        filter.sortBy = "created_at";
        filter.sortDirection = GQL.SortDirectionEnum.Desc;
      }
      return filter;
    },
    [location.search, order, seed]
  );

  const fetchPage = useCallback(async () => {
    if (loadingRef.current || exhaustedRef.current) return;
    loadingRef.current = true;
    const generation = generationRef.current;
    const page = pageRef.current + 1;
    try {
      const result = await queryFindClips(makeFilter(page));
      if (generation !== generationRef.current) return;
      const { clips: pageClips, count } = result.data.findClips;
      pageRef.current = page;
      setTotal(count);
      setClips((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        const merged = [...prev, ...pageClips.filter((c) => !seen.has(c.id))];
        if (merged.length >= count || pageClips.length === 0) {
          exhaustedRef.current = true;
        }
        return merged;
      });
    } finally {
      if (generation === generationRef.current) {
        loadingRef.current = false;
      }
    }
  }, [makeFilter]);

  // reset the queue whenever the ordering or underlying filter changes
  useEffect(() => {
    generationRef.current++;
    pageRef.current = 0;
    loadingRef.current = false;
    exhaustedRef.current = false;
    setClips([]);
    setTotal(undefined);
    setActiveIndex(0);
    containerRef.current?.scrollTo({ top: 0 });
    fetchPage();
  }, [fetchPage, setActiveIndex]);

  // keep the queue topped up as the user approaches the end
  useEffect(() => {
    if (clips.length > 0 && activeIndex >= clips.length - PREFETCH_AHEAD) {
      fetchPage();
    }
  }, [activeIndex, clips.length, fetchPage]);

  // the item occupying most of the viewport is the active one
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveIndex(Number((entry.target as HTMLElement).dataset.index));
          }
        }
      },
      { root: container, threshold: 0.6 }
    );
    container
      .querySelectorAll(".clip-feed__item")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [clips.length, setActiveIndex]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const container = containerRef.current;
      if (!container || clips.length === 0) return;
      const clamped = Math.max(0, Math.min(index, clips.length - 1));
      // switch the active item immediately so the outgoing clip can't fire a
      // competing auto-advance while the smooth scroll is in flight
      setActiveIndex(clamped);
      container.scrollTo({
        top: clamped * container.clientHeight,
        behavior: "smooth",
      });
    },
    [clips.length, setActiveIndex]
  );

  const registerVideo = useCallback(
    (index: number, el: HTMLVideoElement | null) => {
      if (el) {
        videoRegistry.current.set(index, el);
      } else {
        videoRegistry.current.delete(index);
      }
    },
    []
  );

  const onClipEnded = useCallback(
    (index: number) => {
      // an item that finished after the user scrolled away must not advance
      if (index !== activeIndexRef.current) return;
      if (index < clips.length - 1) {
        scrollToIndex(index + 1);
      } else {
        // end of the queue — replay the current clip
        const video = videoRegistry.current.get(index);
        if (video) {
          video.currentTime = 0;
          video.play().catch(() => {});
        }
      }
    },
    [clips.length, scrollToIndex]
  );

  const exitFeed = useCallback(() => {
    history.push(`/clips${location.search}`);
  }, [history, location.search]);

  const reshuffle = useCallback(() => {
    setOrder("shuffle");
    setSeed(newSeed());
  }, []);

  // keyboard driving
  useEffect(() => {
    Mousetrap.bind(["down", "j"], () => {
      scrollToIndex(activeIndex + 1);
      return false;
    });
    Mousetrap.bind(["up", "k"], () => {
      scrollToIndex(activeIndex - 1);
      return false;
    });
    Mousetrap.bind("space", () => {
      const video = videoRegistry.current.get(activeIndex);
      if (video) {
        if (video.paused) video.play().catch(() => {});
        else video.pause();
      }
      return false;
    });
    Mousetrap.bind(["left", "right"], (e, combo) => {
      const video = videoRegistry.current.get(activeIndex);
      if (video) {
        video.currentTime += combo === "left" ? -5 : 5;
      }
      return false;
    });
    Mousetrap.bind("m", () => setMutedPersistent(!muted));
    Mousetrap.bind("s", () => reshuffle());
    Mousetrap.bind("esc", () => exitFeed());
    Mousetrap.bind("h", () => {
      setCleanPersistent(!clean);
      return false;
    });

    return () => {
      Mousetrap.unbind(["down", "j"]);
      Mousetrap.unbind(["up", "k"]);
      Mousetrap.unbind("space");
      Mousetrap.unbind(["left", "right"]);
      Mousetrap.unbind("m");
      Mousetrap.unbind("s");
      Mousetrap.unbind("esc");
      Mousetrap.unbind("h");
    };
  }, [
    activeIndex,
    muted,
    scrollToIndex,
    setMutedPersistent,
    reshuffle,
    exitFeed,
    clean,
    setCleanPersistent,
  ]);

  const loadedInitial = total !== undefined;
  const empty = loadedInitial && clips.length === 0;

  const positionLabel = useMemo(() => {
    if (!loadedInitial || clips.length === 0) return null;
    return `${Math.min(activeIndex + 1, clips.length)} / ${total}`;
  }, [loadedInitial, clips.length, activeIndex, total]);

  return (
    <div className={cx("clip-feed", { "is-clean": clean })}>
      <div className="clip-feed__topbar">
        <div className="clip-feed__topbar-side">
          <button
            type="button"
            className="clip-feed__top-btn"
            onClick={exitFeed}
            title={intl.formatMessage({ id: "actions.close" })}
          >
            <Icon icon={faXmark} />
          </button>
          <span className="clip-feed__brand">
            <Icon icon={faShuffle} />
            <span>
              <FormattedMessage id="clips_feed" />
            </span>
          </span>
          {positionLabel && (
            <span className="clip-feed__position">{positionLabel}</span>
          )}
        </div>

        <div className="clip-feed__topbar-side">
          <button
            type="button"
            className={cx("clip-feed__top-btn", {
              "is-active": order === "shuffle",
            })}
            onClick={() =>
              order === "shuffle" ? reshuffle() : setOrder("shuffle")
            }
            title={intl.formatMessage({
              id:
                order === "shuffle"
                  ? "clips_feed_reshuffle"
                  : "clips_feed_shuffle",
            })}
          >
            <Icon icon={faShuffle} />
          </button>
          <button
            type="button"
            className={cx("clip-feed__top-btn", {
              "is-active": order === "newest",
            })}
            onClick={() => setOrder("newest")}
            title={intl.formatMessage({ id: "clips_feed_newest" })}
          >
            <Icon icon={faClock} />
          </button>
          <span className="clip-feed__top-divider" />
          {/* discoverable twin of the `h` shortcut */}
          <button
            type="button"
            className="clip-feed__top-btn"
            onClick={() => setCleanPersistent(true)}
            title={intl.formatMessage({ id: "clips_feed_hide_ui" })}
          >
            <Icon icon={faEyeSlash} />
          </button>
          <button
            type="button"
            className={cx("clip-feed__top-btn", { "is-active": autoAdvance })}
            onClick={() => setAutoAdvancePersistent(!autoAdvance)}
            title={intl.formatMessage({
              id: autoAdvance ? "clips_feed_autoplay" : "clips_feed_loop",
            })}
          >
            <Icon icon={autoAdvance ? faForwardStep : faRepeat} />
          </button>
          <button
            type="button"
            className="clip-feed__top-btn"
            onClick={() => setMutedPersistent(!muted)}
            title={intl.formatMessage({
              id: muted ? "clips_feed_unmute" : "clips_feed_mute",
            })}
          >
            <Icon icon={muted ? faVolumeXmark : faVolumeHigh} />
          </button>
        </div>
      </div>

      <div className="clip-feed__scroller" ref={containerRef}>
        {clips.map((clip, i) => (
          <FeedItem
            key={clip.id}
            clip={clip}
            index={i}
            active={i === activeIndex}
            mounted={Math.abs(i - activeIndex) <= MOUNT_RADIUS}
            withVideo={Math.abs(i - activeIndex) <= VIDEO_RADIUS}
            muted={muted}
            autoAdvance={autoAdvance}
            onUnmute={() => setMutedPersistent(false)}
            onEnded={onClipEnded}
            registerVideo={registerVideo}
          />
        ))}

        {!loadedInitial && (
          <div className="clip-feed__loading">
            <LoadingIndicator />
          </div>
        )}

        {empty && (
          <div className="clip-feed__empty">
            <Icon icon={faFilm} />
            <p>
              <FormattedMessage id="clips_feed_empty" />
            </p>
            <button
              type="button"
              className="clip-feed__empty-btn"
              onClick={exitFeed}
            >
              <FormattedMessage id="clips_feed_back_to_clips" />
            </button>
          </div>
        )}
      </div>

      {/* the only way back out of clean mode without a keyboard */}
      {clean && (
        <button
          type="button"
          className="clip-feed__clean-eye"
          onClick={() => setCleanPersistent(false)}
          title={intl.formatMessage({ id: "clips_feed_show_ui" })}
        >
          <Icon icon={faEye} />
        </button>
      )}

      {cleanHint && (
        <div className="clip-feed__clean-hint">
          <FormattedMessage id="clips_feed_clean_hint" />
        </div>
      )}
    </div>
  );
};

export default ClipFeed;
