import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useHistory, useLocation } from "react-router-dom";
import { FormattedMessage, useIntl } from "react-intl";
import cx from "classnames";
import Mousetrap from "mousetrap";
import {
  faFilm,
  faTableCellsLarge,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import * as GQL from "src/core/generated-graphql";
import { useFindClipsForWall } from "src/core/StashService";
import { ListFilterModel } from "src/models/list-filter/filter";
import { Icon } from "../Shared/Icon";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import {
  ClipWallControls,
  MAX_SWAP_MS,
  MIN_SWAP_MS,
  WALL_ADVANCE_MODES,
  WALL_COUNTS,
  WALL_MODES,
  WallAdvanceMode,
} from "./ClipWallControls";
import { solveWallLayout, WallFitMode } from "./wallLayout";

type WallClip = GQL.WallClipDataFragment;

/** clips fetched up front and rotated through; the wall never paginates */
const POOL_SIZE = 200;
const DEFAULT_COUNT = 4;
const DEFAULT_MODE: WallFitMode = "blur";
const DEFAULT_ADVANCE: WallAdvanceMode = "end";
const DEFAULT_SWAP_MS = 8000;
/** matches the crossfade in the stylesheet */
const CROSSFADE_MS = 450;
/** a clip that hasn't reported playing by now is shown regardless */
const REVEAL_FALLBACK_MS = 5000;
/** how many clips ahead of the queue to buffer */
const WARM_AHEAD = 2;
/** a foreground clip that neither ends nor makes progress for this long is stuck */
const STALL_MS = 10000;
/** chrome (and the cursor) go away after this much of nothing happening */
const IDLE_MS = 3000;

const COUNT_KEY = "clip-wall-count";
const MODE_KEY = "clip-wall-mode";
const ADVANCE_KEY = "clip-wall-advance";
const SWAP_KEY = "clip-wall-swap-ms";

function newSeed() {
  return Math.floor(Math.random() * 10 ** 8);
}

function shuffle<T>(input: readonly T[]): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// settings live in localStorage, like the feed's mute / auto-advance
function usePersistedSetting<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T | undefined
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    return (raw !== null ? parse(raw) : undefined) ?? fallback;
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      localStorage.setItem(key, String(next));
    },
    [key]
  );

  return [value, set];
}

// the wall is something you leave running, so every bit of floating chrome —
// and the pointer itself — gets out of the way until you touch something
function useIdle(delay: number) {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    let timeout = 0;
    const wake = () => {
      // bail out of the render when we're already awake
      setIdle((prev) => (prev ? false : prev));
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => setIdle(true), delay);
    };

    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [delay]);

  return idle;
}

// nobody is watching a background tab, and four decodes carrying on in one is
// how a long session ends up out of media players
function usePageVisible() {
  const [visible, setVisible] = useState(
    () => document.visibilityState !== "hidden"
  );

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return visible;
}

// ------------------------------------------------------------
// the clip queue — shuffled once, handed out one at a time
// ------------------------------------------------------------

function useClipQueue(pool: readonly WallClip[]) {
  const queue = useRef({ order: [] as WallClip[], cursor: 0 });
  // bumped whenever the order is re-seeded, so the wall knows to refill
  const [generation, setGeneration] = useState(0);
  // mirrors queue.cursor into render, so what's coming up can be warmed
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    queue.current = { order: shuffle(pool), cursor: 0 };
    setCursor(0);
    setGeneration((g) => g + 1);
  }, [pool]);

  const reshuffle = useCallback(() => {
    queue.current = { order: shuffle(queue.current.order), cursor: 0 };
    setCursor(0);
    setGeneration((g) => g + 1);
  }, []);

  const take = useCallback(() => {
    const q = queue.current;
    if (q.order.length === 0) return undefined;
    if (q.cursor >= q.order.length) {
      // exhausted — go round again in a new order
      q.order = shuffle(q.order);
      q.cursor = 0;
    }
    const clip = q.order[q.cursor++];
    setCursor(q.cursor);
    return clip;
  }, []);

  /** the next n clips, without consuming them; short near the end of a lap */
  const peek = useCallback((n: number) => {
    const q = queue.current;
    return q.order.slice(q.cursor, q.cursor + n);
  }, []);

  return { take, peek, reshuffle, cursor, generation, size: pool.length };
}

// ------------------------------------------------------------
// cells
// ------------------------------------------------------------

// a clip parked in a cell. `token` changes on every (re)assignment, so the cell
// crossfades even when the same clip comes round again.
interface IWallCell {
  clip: WallClip;
  /** currentTime seed, so a clip on screen twice doesn't look cloned */
  offset: number;
  token: number;
}

let tokenSeq = 1;

/** pure: the token is minted by the caller so this is safe inside a setState */
function place(
  cells: readonly (IWallCell | null)[],
  index: number,
  clip: WallClip,
  token: number
): IWallCell {
  const duplicates = cells.filter(
    (c, i) => i !== index && c?.clip.id === clip.id
  ).length;
  return { clip, offset: duplicates * 1.3, token };
}

function fillCells(
  count: number,
  take: () => WallClip | undefined
): IWallCell[] {
  const out: (IWallCell | null)[] = new Array(count).fill(null);
  for (let i = 0; i < count; i++) {
    const clip = take();
    if (clip) out[i] = place(out, i, clip, tokenSeq++);
  }
  return out.filter((c): c is IWallCell => c !== null);
}

/** source dimensions decide the layout; fall back to what the video reports */
function aspectOf(clip: WallClip, measured: Record<string, number>): number {
  const file = clip.scene?.files?.[0];
  if (file && file.width > 0 && file.height > 0)
    return file.width / file.height;
  return measured[clip.id] ?? 16 / 9;
}

interface IWallVideoProps {
  cell: IWallCell;
  front: boolean;
  audible: boolean;
  /**
   * blur mode: put the clip's still behind the foreground, cover-filling the
   * cell and blurred, so a contained (uncropped) foreground never leaves dead
   * black space. A still, not a second video: `paths.stream` is a
   * source-resolution mp4, and a decode per cell just to blur it is how the
   * wall used to eat a renderer alive.
   */
  backdrop: boolean;
  /** timer mode holds a clip on screen past its end, so it has to repeat */
  loop: boolean;
  /** the tab is in the background — stop decoding until it comes back */
  suspended: boolean;
  /** this layer is the one on show; the other side of a swap sits at zero */
  revealed: boolean;
  /**
   * on-end mode only, and only for the layer in front: this clip is finished
   * with (played out, or broken) and the cell should take the next one. Fires
   * at most once per mounted clip.
   */
  onDone?: () => void;
  /** frames are actually rendering — fires once per mounted clip */
  onPlaying?: () => void;
  onMetadata: (clipId: string, width: number, height: number) => void;
}

const WallVideo: React.FC<IWallVideoProps> = ({
  cell,
  front,
  audible,
  backdrop,
  loop,
  suspended,
  revealed,
  onDone,
  onPlaying,
  onMetadata,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playedRef = useRef(false);

  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  const stallRef = useRef(0);
  const suspendedRef = useRef(suspended);
  const armed = onDone !== undefined;

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  // read by the fuse, which is armed from an event handler and so can't see
  // the prop: a pause queues one last timeupdate that lands after the effects
  useEffect(() => {
    suspendedRef.current = suspended;
  }, [suspended]);

  // exactly one hand-off per mounted clip, whichever trigger gets there first:
  // two cells ending on the same frame each advance their own cell, and a clip
  // that both errors and times out still only takes one from the queue
  const finish = useCallback(() => {
    if (doneRef.current || !onDoneRef.current) return;
    doneRef.current = true;
    window.clearTimeout(stallRef.current);
    onDoneRef.current();
  }, []);

  // wedge guard: on-end advancement trusts the video to say when it's done, so
  // a source that dies quietly — never loads, stalls forever — would park the
  // cell for good. Any playback progress rearms the fuse, so a long clip that
  // is simply still playing is never cut short.
  const rearm = useCallback(() => {
    if (doneRef.current || suspendedRef.current) return;
    window.clearTimeout(stallRef.current);
    stallRef.current = window.setTimeout(finish, STALL_MS);
  }, [finish]);

  // a suspended clip is paused, so it stops reporting progress — the fuse has
  // to go on hold with it or it would advance the cell 10s into a hidden tab
  useEffect(() => {
    if (!armed || suspended) {
      window.clearTimeout(stallRef.current);
      return;
    }
    rearm();
    return () => window.clearTimeout(stallRef.current);
  }, [armed, rearm, suspended]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (suspended) {
      video.pause();
      return;
    }
    video.muted = !audible;
    // a clip that has already played out is the outgoing half of a swap: it is
    // holding its last frame, and restarting it on resume would be a glitch
    if (video.ended) return;
    const attempt = video.play();
    if (attempt) {
      attempt.catch(() => {
        // unmuted autoplay refused — a muted cell beats a dead cell
        video.muted = true;
        video.play().catch(() => {});
      });
    }
  }, [audible, suspended]);

  // Chrome hangs on to the decoder for a detached, un-paused media element
  // until GC gets round to it, and a renderer only gets so many. Every swap
  // mints a new element, so the cell hands its own back on the way out.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (!video) return;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, []);

  function onLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    if (cell.offset > 0 && video.duration > cell.offset + 0.2) {
      video.currentTime = cell.offset;
    }
    onMetadata(cell.clip.id, video.videoWidth, video.videoHeight);
  }

  function handlePlaying() {
    if (playedRef.current) return;
    playedRef.current = true;
    onPlaying?.();
  }

  const src = cell.clip.paths.stream ?? undefined;
  const layerClass = cx(
    "clip-wall__layer",
    front ? "clip-wall__layer--front" : "clip-wall__layer--back",
    revealed && "is-revealed"
  );

  // only the foreground drives the cell, and only when it is the layer in
  // front — the copy fading out behind it has already handed over
  const advanceProps = armed
    ? {
        onEnded: finish,
        onError: finish,
        onTimeUpdate: rearm,
      }
    : {};

  if (!backdrop) {
    return (
      <video
        ref={videoRef}
        className={layerClass}
        src={src}
        poster={cell.clip.paths.screenshot ?? undefined}
        muted={!audible}
        autoPlay
        loop={loop}
        playsInline
        preload="auto"
        onLoadedMetadata={onLoadedMetadata}
        onPlaying={handlePlaying}
        {...advanceProps}
      />
    );
  }

  // the pair crossfades as one unit, so the wrapper carries the layer class
  return (
    <div className={layerClass}>
      {cell.clip.paths.screenshot && (
        <img
          className="clip-wall__media clip-wall__media--backdrop"
          src={cell.clip.paths.screenshot}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      )}
      <video
        ref={videoRef}
        className="clip-wall__media clip-wall__media--foreground"
        src={src}
        poster={cell.clip.paths.screenshot ?? undefined}
        muted={!audible}
        autoPlay
        loop={loop}
        playsInline
        preload="auto"
        onLoadedMetadata={onLoadedMetadata}
        onPlaying={handlePlaying}
        {...advanceProps}
      />
    </div>
  );
};

/**
 * An upcoming clip, loading quietly off-screen. It is never played — it exists
 * so Chrome's media cache already holds the first chunk when the clip is
 * promoted into a cell, which is what makes the swap look instant.
 */
const WarmVideo: React.FC<{ src?: string }> = ({ src }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (!video) return;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, []);

  return (
    <video
      ref={videoRef}
      className="clip-wall__warmer"
      src={src}
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
};

interface IWallCellProps {
  cell: IWallCell;
  blur: boolean;
  loop: boolean;
  suspended: boolean;
  /** on-end mode: this cell's clip finished, give it the next one */
  onDone?: () => void;
  onMetadata: (clipId: string, width: number, height: number) => void;
}

const WallCellView: React.FC<IWallCellProps> = ({
  cell,
  blur,
  loop,
  suspended,
  onDone,
  onMetadata,
}) => {
  const [hovered, setHovered] = useState(false);
  // the outgoing clip stays mounted for one crossfade
  const [layers, setLayers] = useState<IWallCell[]>([cell]);
  // the incoming clip is invisible until it is genuinely rendering frames:
  // these streams are source-resolution, and revealing on mount meant staring
  // at a poster (or black) for a second or two while it buffered
  const [readyToken, setReadyToken] = useState(0);

  const front = layers[layers.length - 1];
  const ready = readyToken === front.token;

  useEffect(() => {
    setLayers((prev) =>
      prev[prev.length - 1].token === cell.token
        ? prev
        : [...prev.slice(-1), cell]
    );
  }, [cell]);

  // the old clip only goes once the new one has taken over on screen
  useEffect(() => {
    if (layers.length < 2 || !ready) return;
    const timeout = window.setTimeout(
      () => setLayers((prev) => prev.slice(-1)),
      CROSSFADE_MS
    );
    return () => window.clearTimeout(timeout);
  }, [layers, ready]);

  // ...but a clip that never reports playing can't hold the cell hostage. A
  // suspended tab isn't a failure, so the fallback waits for it to come back.
  useEffect(() => {
    if (ready || suspended) return;
    const timeout = window.setTimeout(
      () => setReadyToken(front.token),
      REVEAL_FALLBACK_MS
    );
    return () => window.clearTimeout(timeout);
  }, [ready, suspended, front.token]);

  return (
    <div
      className={cx("clip-wall__cell", { "is-live": hovered })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {layers.map((layer, i) => {
        const isFront = i === layers.length - 1;
        return (
          <WallVideo
            key={layer.token}
            cell={layer}
            front={isFront}
            audible={hovered && isFront}
            backdrop={blur}
            loop={loop}
            suspended={suspended}
            // the outgoing clip holds the cell until the incoming one is up
            revealed={isFront ? ready : !ready}
            onDone={isFront ? onDone : undefined}
            onPlaying={isFront ? () => setReadyToken(layer.token) : undefined}
            onMetadata={onMetadata}
          />
        );
      })}
    </div>
  );
};

// ------------------------------------------------------------
// page
// ------------------------------------------------------------

export const ClipWall: React.FC = () => {
  const history = useHistory();
  const location = useLocation();
  const intl = useIntl();

  const [count, setCount] = usePersistedSetting(
    COUNT_KEY,
    DEFAULT_COUNT,
    (raw) => (WALL_COUNTS.includes(Number(raw)) ? Number(raw) : undefined)
  );
  const [mode, setMode] = usePersistedSetting(MODE_KEY, DEFAULT_MODE, (raw) =>
    WALL_MODES.find((m) => m === raw)
  );
  const [advance, setAdvance] = usePersistedSetting(
    ADVANCE_KEY,
    DEFAULT_ADVANCE,
    (raw) => WALL_ADVANCE_MODES.find((a) => a === raw)
  );
  const [swapMs, setSwapMs] = usePersistedSetting(
    SWAP_KEY,
    DEFAULT_SWAP_MS,
    (raw) => {
      const value = Number(raw);
      if (!Number.isFinite(value)) return undefined;
      return Math.min(MAX_SWAP_MS, Math.max(MIN_SWAP_MS, value));
    }
  );

  // a random slice of the library per visit; reshuffling reorders that slice
  const [seed] = useState(newSeed);
  const filter = useMemo(() => {
    // carry any criteria the clips page was showing
    const model = new ListFilterModel(GQL.FilterMode.Clips);
    model.configureFromQueryString(location.search);
    model.itemsPerPage = POOL_SIZE;
    model.currentPage = 1;
    model.sortBy = "random";
    model.randomSeed = seed;
    return model;
  }, [location.search, seed]);

  const { data, loading } = useFindClipsForWall(filter);
  const pool = useMemo(() => data?.findClips.clips ?? [], [data]);

  const { take, peek, reshuffle, cursor, generation, size } =
    useClipQueue(pool);
  // a pool smaller than the chosen count shows what exists rather than clones
  const cellCount = Math.min(count, size);

  // shortcuts and hover-unmute carry on working while the chrome is away
  const idle = useIdle(IDLE_MS);
  const visible = usePageVisible();

  const [cells, setCells] = useState<IWallCell[]>([]);
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const [containerAspect, setContainerAspect] = useState(0);
  const rotation = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setContainerAspect(rect.height > 0 ? rect.width / rect.height : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    rotation.current = 0;
    setCells(fillCells(cellCount, take));
  }, [cellCount, take, generation]);

  // hand one cell the next clip off the queue. Both triggers come through
  // here, and the clip is taken before the state update so a cell can't
  // consume two, nor two cells the same one, whatever order they land in
  const advanceCell = useCallback(
    (index: number) => {
      const clip = take();
      if (!clip) return;
      const token = tokenSeq++;
      setCells((prev) =>
        index < prev.length
          ? prev.map((cell, i) =>
              i === index ? place(prev, index, clip, token) : cell
            )
          : prev
      );
    },
    [take]
  );

  // timer mode: one cell at a time, round-robin, so a cell holds for a full lap
  // of the wall and the changes land staggered rather than in lockstep. It
  // stops with the tab, like the clips do; on-end mode has no timer at all.
  useEffect(() => {
    if (advance !== "timer" || cellCount === 0 || !visible) return;
    const id = window.setInterval(() => {
      const i = rotation.current % cellCount;
      rotation.current = i + 1;
      advanceCell(i);
    }, swapMs);
    return () => window.clearInterval(id);
  }, [advance, advanceCell, cellCount, swapMs, visible]);

  const onMetadata = useCallback(
    (clipId: string, width: number, height: number) => {
      if (!width || !height) return;
      setMeasured((prev) =>
        prev[clipId] ? prev : { ...prev, [clipId]: width / height }
      );
    },
    []
  );

  const exitWall = useCallback(() => {
    history.push(`/clips${location.search}`);
  }, [history, location.search]);

  useEffect(() => {
    Mousetrap.bind("esc", () => exitWall());
    Mousetrap.bind("s", () => reshuffle());
    return () => {
      Mousetrap.unbind("esc");
      Mousetrap.unbind("s");
    };
  }, [exitWall, reshuffle]);

  const aspects = cells.map((cell) => aspectOf(cell.clip, measured));
  // a few hundred evaluations — cheap enough to redo on every render
  const layout = solveWallLayout(aspects, containerAspect, mode);

  const empty = !loading && pool.length === 0;
  // recomputed every time the queue moves; keyed by clip id below, so a clip
  // still coming up keeps the element it has already been buffering into
  const upcoming = useMemo(
    () => peek(WARM_AHEAD),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [peek, cursor, generation]
  );

  return (
    <div className={cx("clip-wall", { "is-idle": idle })}>
      <div className="clip-wall__topbar">
        <div className="clip-wall__topbar-side">
          <button
            type="button"
            className="clip-wall__top-btn"
            onClick={exitWall}
            title={intl.formatMessage({ id: "actions.close" })}
          >
            <Icon icon={faXmark} />
          </button>
          <span className="clip-wall__brand">
            <Icon icon={faTableCellsLarge} />
            <span>
              <FormattedMessage id="clips_wall" />
            </span>
          </span>
        </div>

        <div className="clip-wall__topbar-side">
          <ClipWallControls
            count={count}
            onSetCount={setCount}
            mode={mode}
            onSetMode={setMode}
            advance={advance}
            onSetAdvance={setAdvance}
            swapMs={swapMs}
            onSetSwapMs={setSwapMs}
            onReshuffle={reshuffle}
          />
        </div>
      </div>

      <div className="clip-wall__stage" ref={stageRef}>
        {cells.map((cell, i) => {
          const rect = layout?.placement[i];
          return (
            <div
              key={i}
              className="clip-wall__slot"
              style={
                rect
                  ? {
                      left: `${rect.x * 100}%`,
                      top: `${rect.y * 100}%`,
                      width: `${rect.w * 100}%`,
                      height: `${rect.h * 100}%`,
                    }
                  : { opacity: 0 }
              }
            >
              <WallCellView
                cell={cell}
                blur={mode === "blur"}
                loop={advance === "timer"}
                suspended={!visible}
                onDone={advance === "end" ? () => advanceCell(i) : undefined}
                onMetadata={onMetadata}
              />
            </div>
          );
        })}

        {loading && cells.length === 0 && (
          <div className="clip-wall__message">
            <LoadingIndicator />
          </div>
        )}

        <div className="clip-wall__warmers" aria-hidden="true">
          {upcoming.map((clip) => (
            <WarmVideo key={clip.id} src={clip.paths.stream ?? undefined} />
          ))}
        </div>

        {empty && (
          <div className="clip-wall__message">
            <Icon icon={faFilm} />
            <p>
              <FormattedMessage id="clips_wall_empty" />
            </p>
            <button
              type="button"
              className="clip-wall__message-btn"
              onClick={exitWall}
            >
              <FormattedMessage id="clips_wall_back_to_clips" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ClipWall;
