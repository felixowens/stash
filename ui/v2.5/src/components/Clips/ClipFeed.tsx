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
  faPlay,
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
  useClipUpdate,
} from "src/core/StashService";
import { ListFilterModel } from "src/models/list-filter/filter";
import { clipTitle } from "src/core/clips";
import TextUtils from "src/utils/text";
import { Icon } from "../Shared/Icon";
import { SweatDrops } from "../Shared/SweatDrops";
import { RatingSystem } from "../Shared/Rating/RatingSystem";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { useClipFeedPlayer } from "./useClipFeedPlayer";

const PER_PAGE = 40;
// fetch the next page when the user is this many clips from the end
const PREFETCH_AHEAD = 5;
// items within this distance of the active one render their full content
const MOUNT_RADIUS = 3;
/** how long "press h or tap the eye" lingers after entering clean mode */
const CLEAN_HINT_MS = 2000;

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
  muted: boolean;
  progress: number;
  onUnmute: () => void;
  onTogglePlay: () => void;
  onSeek: (fraction: number) => void;
}

const FeedItem: React.FC<IFeedItemProps> = ({
  clip,
  index,
  active,
  mounted,
  muted,
  progress,
  onUnmute,
  onTogglePlay,
  onSeek,
}) => {
  const intl = useIntl();

  const [updateClip] = useClipUpdate();
  const [incrementO] = useClipIncrementO(clip.id);
  const [oBurst, setOBurst] = useState(0);

  // the queue is a detached snapshot (client.query into state), so Apollo
  // cache updates don't reach it — mirror the mutable bits locally
  const [oCount, setOCount] = useState(clip.o_counter ?? 0);
  const [organized, setOrganized] = useState(clip.organized);
  const [rating, setRating] = useState<number | null>(clip.rating100 ?? null);

  function doIncrementO() {
    setOBurst(Date.now());
    setOCount((v) => v + 1);
    incrementO().then((result) => {
      const count = result.data?.clipAddO.count;
      if (typeof count === "number") setOCount(count);
    });
  }

  function seekToFraction(e: React.PointerEvent<HTMLDivElement>) {
    if (!active) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.min(
      1,
      Math.max(0, (e.clientX - rect.left) / rect.width)
    );
    onSeek(fraction);
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
    <section
      className={cx("clip-feed__item", { "is-active": active })}
      data-index={index}
    >
      {mounted && (
        <>
          {clip.paths.screenshot && (
            <div
              className="clip-feed__backdrop"
              style={{ backgroundImage: `url("${clip.paths.screenshot}")` }}
            />
          )}

          <div
            className="clip-feed__stage"
            onClick={() => {
              if (active) onTogglePlay();
            }}
          >
            {clip.paths.screenshot && (
              <img
                className="clip-feed__poster"
                src={clip.paths.screenshot}
                alt=""
              />
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
  const [queueGeneration, setQueueGeneration] = useState(0);
  const [activeIndex, setActiveIndexState] = useState(0);
  // Resize callbacks need the latest index without recreating their observer.
  const activeIndexRef = useRef(0);
  const setActiveIndex = useCallback((index: number) => {
    activeIndexRef.current = index;
    setActiveIndexState(index);
  }, []);
  const activeClip = clips[activeIndex];
  const {
    videoRef,
    muted,
    status,
    progress,
    togglePlay,
    retry,
    setMutedPersistent,
    seek,
    events,
  } = useClipFeedPlayer(
    activeClip?.id,
    activeClip?.paths.stream,
    queueGeneration
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
  const pageRef = useRef(0);
  const loadingRef = useRef(false);
  const exhaustedRef = useRef(false);
  // bumped on every queue reset so stale in-flight fetches are dropped
  const generationRef = useRef(0);

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
    setQueueGeneration(generationRef.current);
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
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      container.scrollTo({
        top: activeIndexRef.current * container.clientHeight,
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const scrollToIndex = useCallback(
    (index: number) => {
      const container = containerRef.current;
      if (!container || clips.length === 0) return;
      const clamped = Math.max(0, Math.min(index, clips.length - 1));
      container.scrollTo({
        top: clamped * container.clientHeight,
        behavior: "smooth",
      });
    },
    [clips.length]
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
      togglePlay();
      return false;
    });
    Mousetrap.bind(["left", "right"], (e, combo) => {
      const video = videoRef.current;
      if (video) {
        seek(video.currentTime + (combo === "left" ? -5 : 5));
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
    videoRef,
    togglePlay,
    seek,
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
        <div
          className="clip-feed__player"
          hidden={!activeClip}
          style={{ transform: `translateY(${activeIndex * 100}%)` }}
        >
          <video
            ref={videoRef}
            className="clip-feed__video"
            data-clip-id={activeClip?.id}
            poster={activeClip?.paths.screenshot ?? undefined}
            preload="auto"
            playsInline
            loop
            muted={muted}
            {...events}
          />
          {status === "paused" && (
            <div className="clip-feed__state-badge">
              <Icon icon={faPlay} />
            </div>
          )}
          {status === "loading" && (
            <div className="clip-feed__buffering">
              <LoadingIndicator inline small message="" />
            </div>
          )}
          {(status === "blocked" || status === "error") && (
            <button
              type="button"
              className="clip-feed__recovery"
              onClick={retry}
            >
              <Icon icon={faPlay} />
              <FormattedMessage
                id={
                  status === "error"
                    ? "clips_feed_retry"
                    : muted
                    ? "clips_feed_tap_to_play"
                    : "clips_feed_tap_to_play_sound"
                }
              />
            </button>
          )}
        </div>
        {clips.map((clip, i) => (
          <FeedItem
            key={clip.id}
            clip={clip}
            index={i}
            active={i === activeIndex}
            mounted={Math.abs(i - activeIndex) <= MOUNT_RADIUS}
            muted={muted}
            progress={i === activeIndex ? progress : 0}
            onUnmute={() => setMutedPersistent(false)}
            onTogglePlay={togglePlay}
            onSeek={(fraction) =>
              seek(fraction * (videoRef.current?.duration ?? 0))
            }
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
