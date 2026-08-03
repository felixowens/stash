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
  WALL_COUNTS,
  WALL_MODES,
} from "./ClipWallControls";
import { solveWallLayout, WallFitMode } from "./wallLayout";

type WallClip = GQL.WallClipDataFragment;

/** clips fetched up front and rotated through; the wall never paginates */
const POOL_SIZE = 200;
const DEFAULT_COUNT = 4;
const DEFAULT_MODE: WallFitMode = "blur";
const DEFAULT_SWAP_MS = 8000;
/** matches the crossfade in the stylesheet */
const CROSSFADE_MS = 450;

const COUNT_KEY = "clip-wall-count";
const MODE_KEY = "clip-wall-mode";
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

// ------------------------------------------------------------
// the clip queue — shuffled once, handed out one at a time
// ------------------------------------------------------------

function useClipQueue(pool: readonly WallClip[]) {
  const queue = useRef({ order: [] as WallClip[], cursor: 0 });
  // bumped whenever the order is re-seeded, so the wall knows to refill
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    queue.current = { order: shuffle(pool), cursor: 0 };
    setGeneration((g) => g + 1);
  }, [pool]);

  const reshuffle = useCallback(() => {
    queue.current = { order: shuffle(queue.current.order), cursor: 0 };
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
    return q.order[q.cursor++];
  }, []);

  return { take, reshuffle, generation, size: pool.length };
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

function assign(
  cells: readonly (IWallCell | null)[],
  index: number,
  clip: WallClip | undefined
): IWallCell | null {
  if (!clip) return cells[index] ?? null;
  const duplicates = cells.filter(
    (c, i) => i !== index && c?.clip.id === clip.id
  ).length;
  return { clip, offset: duplicates * 1.3, token: tokenSeq++ };
}

function fillCells(
  count: number,
  take: () => WallClip | undefined
): IWallCell[] {
  const out: (IWallCell | null)[] = new Array(count).fill(null);
  for (let i = 0; i < count; i++) {
    out[i] = assign(out, i, take());
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
   * blur mode: render a second, always-muted copy of the clip behind the
   * foreground, cover-filling the cell and blurred, so a contained (uncropped)
   * foreground never leaves dead black space
   */
  backdrop: boolean;
  onMetadata: (clipId: string, width: number, height: number) => void;
}

const WallVideo: React.FC<IWallVideoProps> = ({
  cell,
  front,
  audible,
  backdrop,
  onMetadata,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const backdropRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !audible;
    const attempt = video.play();
    if (attempt) {
      attempt.catch(() => {
        // unmuted autoplay refused — a muted cell beats a dead cell
        video.muted = true;
        video.play().catch(() => {});
      });
    }
  }, [audible]);

  // the backdrop is decoration: muted forever, never asked for audio even when
  // the cell is hover-unmuted
  useEffect(() => {
    const video = backdropRef.current;
    if (!video) return;
    video.muted = true;
    video.play().catch(() => {});
  }, [backdrop]);

  function onLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    if (cell.offset > 0 && video.duration > cell.offset + 0.2) {
      video.currentTime = cell.offset;
    }
    onMetadata(cell.clip.id, video.videoWidth, video.videoHeight);
  }

  function onBackdropLoadedMetadata() {
    const video = backdropRef.current;
    if (!video) return;
    // roughly in step with the foreground is plenty behind 32px of blur
    video.currentTime = videoRef.current?.currentTime ?? cell.offset;
    video.muted = true;
    video.play().catch(() => {});
  }

  const src = cell.clip.paths.stream ?? undefined;
  const layerClass = cx(
    "clip-wall__layer",
    front ? "clip-wall__layer--front" : "clip-wall__layer--back"
  );

  if (!backdrop) {
    return (
      <video
        ref={videoRef}
        className={layerClass}
        src={src}
        poster={cell.clip.paths.screenshot ?? undefined}
        muted={!audible}
        autoPlay
        loop
        playsInline
        preload="auto"
        onLoadedMetadata={onLoadedMetadata}
      />
    );
  }

  // the pair crossfades as one unit, so the wrapper carries the layer class
  return (
    <div className={layerClass}>
      <video
        ref={backdropRef}
        className="clip-wall__media clip-wall__media--backdrop"
        src={src}
        muted
        autoPlay
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
        onLoadedMetadata={onBackdropLoadedMetadata}
      />
      <video
        ref={videoRef}
        className="clip-wall__media clip-wall__media--foreground"
        src={src}
        poster={cell.clip.paths.screenshot ?? undefined}
        muted={!audible}
        autoPlay
        loop
        playsInline
        preload="auto"
        onLoadedMetadata={onLoadedMetadata}
      />
    </div>
  );
};

interface IWallCellProps {
  cell: IWallCell;
  blur: boolean;
  onMetadata: (clipId: string, width: number, height: number) => void;
}

const WallCellView: React.FC<IWallCellProps> = ({ cell, blur, onMetadata }) => {
  const [hovered, setHovered] = useState(false);
  // the outgoing clip stays mounted for one crossfade
  const [layers, setLayers] = useState<IWallCell[]>([cell]);

  useEffect(() => {
    setLayers((prev) =>
      prev[prev.length - 1].token === cell.token
        ? prev
        : [...prev.slice(-1), cell]
    );
  }, [cell]);

  useEffect(() => {
    if (layers.length < 2) return;
    const timeout = window.setTimeout(
      () => setLayers((prev) => prev.slice(-1)),
      CROSSFADE_MS
    );
    return () => window.clearTimeout(timeout);
  }, [layers]);

  return (
    <div
      className={cx("clip-wall__cell", { "is-live": hovered })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {layers.map((layer, i) => (
        <WallVideo
          key={layer.token}
          cell={layer}
          front={i === layers.length - 1}
          audible={hovered && i === layers.length - 1}
          backdrop={blur}
          onMetadata={onMetadata}
        />
      ))}
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

  const { take, reshuffle, generation, size } = useClipQueue(pool);
  // a pool smaller than the chosen count shows what exists rather than clones
  const cellCount = Math.min(count, size);

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

  // one cell at a time, round-robin: a cell holds for a full lap of the wall,
  // and the changes land staggered rather than in lockstep
  useEffect(() => {
    const id = window.setInterval(() => {
      setCells((prev) => {
        if (prev.length === 0) return prev;
        const i = rotation.current % prev.length;
        rotation.current = i + 1;
        const next = [...prev];
        next[i] = assign(next, i, take()) ?? next[i];
        return next;
      });
    }, swapMs);
    return () => window.clearInterval(id);
  }, [take, swapMs]);

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

  return (
    <div className="clip-wall">
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
