import React, { useEffect, useRef, useState } from "react";
import cx from "classnames";
import {
  faAngleLeft,
  faAngleRight,
  faArrowRightFromBracket,
  faArrowRightToBracket,
  faCrop,
  faExpand,
  faMagnifyingGlassMinus,
  faMagnifyingGlassPlus,
  faPlay,
  faRepeat,
} from "@fortawesome/free-solid-svg-icons";
import TextUtils from "src/utils/text";
import { useSpriteInfo } from "src/hooks/sprite";
import { Icon } from "../Shared/Icon";
import { SceneFilmstrip } from "./SceneFilmstrip";
import { TimelineMinimap } from "./TimelineMinimap";
import { HoverPreview } from "./HoverPreview";
import { ISceneClock } from "./useVideoClock";
import {
  EDGE_PX,
  ZOOM_IN_STEP,
  ZOOM_OUT_STEP,
  pctOf,
  useTimelineViewport,
} from "./useTimelineViewport";

const MIN_LEN = 0.2;
// below this the whole scene fits the track comfortably — keep the simple case
// clean and hide the zoom toolbar + minimap
const ZOOM_UI_MIN_DURATION = 60;
const AUTO_PAN_PER_FRAME = 0.015; // fraction of the view panned per frame at an edge
const SHIFT_PAN_FRAC = 0.15; // fraction of the view panned per shift-wheel notch

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

interface IClipTrimmerProps {
  vttPath?: string;
  duration: number;
  frameRate?: number;
  inSeconds: number;
  outSeconds: number;
  onChange: (inS: number, outS: number) => void;
  clock: ISceneClock;
  // render an evenly-spaced time axis under the track (worth it on a wide track)
  ticks?: boolean;
}

// The bottom-dock trim track: a zoomable filmstrip + draggable in/out handles +
// live playhead, driving the real scene player (seek + AB-loop preview). The track
// shows a movable [view] window rather than the whole scene, so long scenes can be
// zoomed for frame-level precision; a minimap gives whole-scene orientation.
export const ClipTrimmer: React.FC<IClipTrimmerProps> = ({
  vttPath,
  duration,
  frameRate = 30,
  inSeconds,
  outSeconds,
  onChange,
  clock,
  ticks = false,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [looping, setLooping] = useState(false);
  const [hover, setHover] = useState<{ time: number; xPct: number } | null>(
    null
  );

  // latest range, read by the drag/key listeners to avoid stale closures
  const inRef = useRef(inSeconds);
  inRef.current = inSeconds;
  const outRef = useRef(outSeconds);
  outRef.current = outSeconds;
  const lastSeek = useRef(0);
  const draggingRef = useRef(false);

  const dur = duration > 0 ? duration : Math.max(outSeconds, 1);
  const sprites = useSpriteInfo(vttPath);
  const vp = useTimelineViewport(dur, trackRef);
  const { view } = vp;
  // live viewport for native (non-React) wheel + document key handlers
  const vpRef = useRef(vp);
  vpRef.current = vp;

  const head = clamp(clock.currentTime, 0, dur);
  const inPct = pctOf(inSeconds, view);
  const outPct = pctOf(outSeconds, view);
  const headPct = pctOf(head, view);
  const len = Math.max(0, outSeconds - inSeconds);

  const showZoom = dur > ZOOM_UI_MIN_DURATION;
  const showZoomRef = useRef(showZoom);
  showZoomRef.current = showZoom;

  // visible selection width in px, to decide whether the length badge fits
  const selPctW = Math.max(0, clamp(outPct, 0, 100) - clamp(inPct, 0, 100));
  const selWide = (selPctW / 100) * vp.trackWidth > 44;

  // keep the preview loop in sync with the range while looping
  useEffect(() => {
    if (looping) clock.setLoop(inSeconds, outSeconds);
  }, [looping, inSeconds, outSeconds, clock]);

  // while previewing, keep the playhead in view as the loop plays past the edge
  useEffect(() => {
    if (looping) vpRef.current.ensureVisible(clock.currentTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock.currentTime, looping]);

  // wheel over the track zooms (anchored at the cursor) / shift+wheel pans. Native
  // + non-passive so preventDefault actually stops the modal from scrolling.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!showZoomRef.current) return;
      e.preventDefault();
      const v = vpRef.current;
      if (e.shiftKey) {
        v.panBy(Math.sign(e.deltaY) * v.span * SHIFT_PAN_FRAC);
      } else {
        v.zoomAtClientX(e.clientX, e.deltaY < 0 ? ZOOM_IN_STEP : ZOOM_OUT_STEP);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // zoom keyboard: + / - zoom, f fit, z zoom-to-selection. Capture phase +
  // stopImmediatePropagation so they don't leak to the scene page underneath
  // (matches the modal's I/O/Space handler). Owned here so the modal needn't.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!showZoomRef.current) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      const v = vpRef.current;
      let handled = true;
      switch (e.key) {
        case "+":
        case "=":
          v.zoomIn();
          break;
        case "-":
        case "_":
          v.zoomOut();
          break;
        case "f":
        case "F":
          v.fit();
          break;
        case "z":
        case "Z":
          v.zoomToSelection(inRef.current, outRef.current);
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  // cancel any pending hover frame on unmount
  const hoverRaf = useRef(0);
  const pendingHover = useRef<{ time: number; xPct: number } | null>(null);
  useEffect(
    () => () => {
      if (hoverRaf.current) cancelAnimationFrame(hoverRaf.current);
    },
    []
  );

  // seeking a transcoded stream on every move is heavy — throttle it
  function throttledSeek(t: number) {
    const now = performance.now();
    if (now - lastSeek.current > 90) {
      lastSeek.current = now;
      clock.seek(t);
    }
  }

  function startHandleDrag(e: React.PointerEvent, which: "in" | "out") {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    setHover(null);
    let lastClientX = e.clientX;

    const apply = (t: number) => {
      if (which === "in") {
        const ni = clamp(Math.min(t, outRef.current - MIN_LEN), 0, dur);
        onChange(ni, outRef.current);
        throttledSeek(ni);
      } else {
        const no = clamp(Math.max(t, inRef.current + MIN_LEN), 0, dur);
        onChange(inRef.current, no);
        throttledSeek(no);
      }
    };

    const move = (ev: PointerEvent) => {
      lastClientX = ev.clientX;
      apply(vp.timeFromClientX(ev.clientX));
    };

    // while a handle is held near a track edge, auto-pan the view so the endpoint
    // can be pulled across a long scene without zooming out first
    let raf = 0;
    const tick = () => {
      const el = trackRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const left = lastClientX < r.left + EDGE_PX;
        const right = lastClientX > r.right - EDGE_PX;
        if (left || right) {
          vp.panBy((left ? -1 : 1) * vp.span * AUTO_PAN_PER_FRAME);
          apply(vp.timeFromClientX(lastClientX));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      cancelAnimationFrame(raf);
      draggingRef.current = false;
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  // press / drag on the track (off a handle) scrubs the player
  function onTrackPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest(".clip-trim__handle")) return;
    e.preventDefault();
    draggingRef.current = true;
    setHover(null);
    clock.seek(vp.timeFromClientX(e.clientX));
    const move = (ev: PointerEvent) =>
      throttledSeek(vp.timeFromClientX(ev.clientX));
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      draggingRef.current = false;
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  // hover the track → floating thumbnail + timestamp (RAF-coalesced)
  function onTrackPointerMove(e: React.PointerEvent) {
    if (draggingRef.current) return;
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    pendingHover.current = {
      time: vp.timeFromClientX(e.clientX),
      xPct: clamp(((e.clientX - r.left) / r.width) * 100, 0, 100),
    };
    if (!hoverRaf.current) {
      hoverRaf.current = requestAnimationFrame(() => {
        hoverRaf.current = 0;
        setHover(pendingHover.current);
      });
    }
  }

  function onTrackPointerLeave() {
    if (hoverRaf.current) {
      cancelAnimationFrame(hoverRaf.current);
      hoverRaf.current = 0;
    }
    setHover(null);
  }

  // "Set in" plants the in at the playhead; if that lands at/past the out, the out
  // is pushed along to keep a valid range — rather than pinning the in to just
  // before the old out (which dropped a stray sliver at the wrong spot). "Set out"
  // is symmetric: a too-early out drags the in back with it.
  function setIn() {
    const ni = clamp(head, 0, dur);
    const no =
      ni > outSeconds - MIN_LEN ? Math.min(ni + MIN_LEN, dur) : outSeconds;
    onChange(Math.min(ni, no - MIN_LEN), no);
  }
  function setOut() {
    const no = clamp(head, 0, dur);
    const ni = no < inSeconds + MIN_LEN ? Math.max(no - MIN_LEN, 0) : inSeconds;
    onChange(ni, Math.max(no, ni + MIN_LEN));
  }

  function nudge(dir: number) {
    const step = dir / (frameRate || 30);
    const ni = clamp(inSeconds + step, 0, Math.max(0, dur - len));
    onChange(ni, ni + len);
    clock.seek(ni);
  }

  function togglePreview() {
    if (looping) {
      setLooping(false);
      clock.clearLoop();
    } else {
      setLooping(true);
      clock.setLoop(inSeconds, outSeconds);
      clock.seek(inSeconds);
      clock.play();
    }
  }

  // in/out handle, or a pinned chevron to jump back to it when it's off-screen
  function renderHandle(which: "in" | "out", pct: number) {
    if (pct >= 0 && pct <= 100) {
      // keep the grip fully on-track even when the endpoint sits at the very edge
      // (e.g. the default in=0:00) — otherwise translateX(-50%) clips half of it off
      const halfPct = vp.trackWidth > 0 ? (6 / vp.trackWidth) * 100 : 0;
      const left = clamp(pct, halfPct, 100 - halfPct);
      return (
        <div
          className={cx("clip-trim__handle", `clip-trim__handle--${which}`)}
          style={{ left: `${left}%` }}
          onPointerDown={(e) => startHandleDrag(e, which)}
        >
          <span className="clip-trim__grip" />
        </div>
      );
    }
    const offLeft = pct < 0;
    return (
      <button
        type="button"
        className={cx(
          "clip-trim__offhandle",
          offLeft ? "clip-trim__offhandle--left" : "clip-trim__offhandle--right"
        )}
        onClick={() =>
          vp.ensureVisible(which === "in" ? inSeconds : outSeconds)
        }
        title={`Jump to ${which} point`}
      >
        <Icon icon={offLeft ? faAngleLeft : faAngleRight} />
      </button>
    );
  }

  return (
    <div className="clip-trim">
      <div className="clip-trim__topbar">
        <div className="clip-trim__readout">
          <div>
            <span>In</span>
            <b>{TextUtils.secondsToTimestamp(inSeconds)}</b>
          </div>
          <div>
            <span>Out</span>
            <b>{TextUtils.secondsToTimestamp(outSeconds)}</b>
          </div>
          <div className="clip-trim__len">
            <span>Length</span>
            <b>{len.toFixed(1)}s</b>
          </div>
        </div>

        {showZoom && (
          <div className="clip-trim__zoombar">
            <button
              type="button"
              onClick={vp.fit}
              disabled={vp.atFullSpan}
              title="Fit whole scene (F)"
            >
              <Icon icon={faExpand} />
            </button>
            <button
              type="button"
              onClick={vp.zoomOut}
              disabled={vp.atFullSpan}
              title="Zoom out (−)"
            >
              <Icon icon={faMagnifyingGlassMinus} />
            </button>
            <span className="clip-trim__zoomreadout">
              {TextUtils.secondsToTimestamp(vp.span)}
            </span>
            <button
              type="button"
              onClick={vp.zoomIn}
              disabled={vp.atMinSpan}
              title="Zoom in (+)"
            >
              <Icon icon={faMagnifyingGlassPlus} />
            </button>
            <button
              type="button"
              onClick={() => vp.zoomToSelection(inSeconds, outSeconds)}
              title="Zoom to selection (Z)"
            >
              <Icon icon={faCrop} />
            </button>
          </div>
        )}
      </div>

      <div className="clip-trim__trackwrap">
        {hover && (
          <HoverPreview sprites={sprites} time={hover.time} xPct={hover.xPct} />
        )}
        <div
          className="clip-trim__track"
          ref={trackRef}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerLeave={onTrackPointerLeave}
        >
          <SceneFilmstrip sprites={sprites} view={view} />
          <div
            className="clip-trim__mask"
            style={{ left: 0, width: `${clamp(inPct, 0, 100)}%` }}
          />
          <div
            className="clip-trim__mask"
            style={{ right: 0, width: `${100 - clamp(outPct, 0, 100)}%` }}
          />
          <div
            className="clip-trim__sel"
            style={{
              left: `${clamp(inPct, 0, 100)}%`,
              width: `${selPctW}%`,
            }}
          >
            {selWide && (
              <span className="clip-trim__selbadge">{len.toFixed(1)}s</span>
            )}
          </div>
          {renderHandle("in", inPct)}
          {renderHandle("out", outPct)}
          {headPct >= 0 && headPct <= 100 && (
            <div
              className="clip-trim__playhead"
              style={{ left: `${headPct}%` }}
            />
          )}
        </div>
      </div>

      {showZoom && (
        <TimelineMinimap
          duration={dur}
          view={view}
          inSeconds={inSeconds}
          outSeconds={outSeconds}
          sprites={sprites}
          onSetView={vp.setView}
        />
      )}

      {ticks && (
        <div className="clip-trim__axis">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i}>
              {TextUtils.secondsToTimestamp(view.start + vp.span * (i / 5))}
            </span>
          ))}
        </div>
      )}

      <div className="clip-trim__controls">
        <button className="clip-trim__btn" onClick={setIn} type="button">
          <Icon icon={faArrowRightToBracket} />
          Set in
        </button>
        <button className="clip-trim__btn" onClick={setOut} type="button">
          <Icon icon={faArrowRightFromBracket} />
          Set out
        </button>
        <span className="clip-trim__nudge">
          <button
            onClick={() => nudge(-1)}
            type="button"
            title="Nudge back one frame"
          >
            <Icon icon={faAngleLeft} />
          </button>
          <button
            onClick={() => nudge(1)}
            type="button"
            title="Nudge forward one frame"
          >
            <Icon icon={faAngleRight} />
          </button>
        </span>
        <button
          className={cx("clip-trim__btn", "clip-trim__btn--preview", {
            "is-active": looping,
          })}
          onClick={togglePreview}
          type="button"
        >
          <Icon icon={looping ? faRepeat : faPlay} />
          Preview
        </button>
      </div>
    </div>
  );
};
