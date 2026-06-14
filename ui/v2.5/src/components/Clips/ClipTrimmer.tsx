import React, { useEffect, useRef, useState } from "react";
import cx from "classnames";
import {
  faAngleLeft,
  faAngleRight,
  faArrowRightFromBracket,
  faArrowRightToBracket,
  faPlay,
  faRepeat,
} from "@fortawesome/free-solid-svg-icons";
import TextUtils from "src/utils/text";
import { Icon } from "../Shared/Icon";
import { SceneFilmstrip } from "./SceneFilmstrip";
import { ISceneClock } from "./useVideoClock";

const MIN_LEN = 0.2;

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

// The bottom-dock trim track: filmstrip + draggable in/out handles + live
// playhead, driving the real scene player (seek + AB-loop preview).
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

  // latest range, read by the drag listener to avoid stale closures
  const inRef = useRef(inSeconds);
  inRef.current = inSeconds;
  const outRef = useRef(outSeconds);
  outRef.current = outSeconds;
  const lastSeek = useRef(0);

  const dur = duration > 0 ? duration : Math.max(outSeconds, 1);
  const head = clamp(clock.currentTime, 0, dur);
  const inPct = (clamp(inSeconds, 0, dur) / dur) * 100;
  const outPct = (clamp(outSeconds, 0, dur) / dur) * 100;
  const headPct = (head / dur) * 100;
  const len = Math.max(0, outSeconds - inSeconds);

  // keep the preview loop in sync with the range while looping
  useEffect(() => {
    if (looping) clock.setLoop(inSeconds, outSeconds);
  }, [looping, inSeconds, outSeconds, clock]);

  function timeFromClientX(clientX: number) {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return clamp(((clientX - r.left) / r.width) * dur, 0, dur);
  }

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

    const move = (ev: PointerEvent) => {
      const t = timeFromClientX(ev.clientX);
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
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  // clicking the track (off a handle) scrubs the player
  function onTrackPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest(".clip-trim__handle")) return;
    clock.seek(timeFromClientX(e.clientX));
  }

  function setIn() {
    onChange(clamp(Math.min(head, outSeconds - MIN_LEN), 0, dur), outSeconds);
  }
  function setOut() {
    onChange(inSeconds, clamp(Math.max(head, inSeconds + MIN_LEN), 0, dur));
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

  return (
    <div className="clip-trim">
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

      <div
        className="clip-trim__track"
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
      >
        <SceneFilmstrip vttPath={vttPath} />
        <div
          className="clip-trim__mask"
          style={{ left: 0, width: `${inPct}%` }}
        />
        <div
          className="clip-trim__mask"
          style={{ right: 0, width: `${100 - outPct}%` }}
        />
        <div
          className="clip-trim__sel"
          style={{
            left: `${inPct}%`,
            width: `${Math.max(0, outPct - inPct)}%`,
          }}
        >
          <span className="clip-trim__selbadge">{len.toFixed(1)}s</span>
        </div>
        <div
          className="clip-trim__handle clip-trim__handle--in"
          style={{ left: `${inPct}%` }}
          onPointerDown={(e) => startHandleDrag(e, "in")}
        >
          <span className="clip-trim__grip" />
        </div>
        <div
          className="clip-trim__handle clip-trim__handle--out"
          style={{ left: `${outPct}%` }}
          onPointerDown={(e) => startHandleDrag(e, "out")}
        >
          <span className="clip-trim__grip" />
        </div>
        <div className="clip-trim__playhead" style={{ left: `${headPct}%` }} />
      </div>

      {ticks && (
        <div className="clip-trim__axis">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i}>{TextUtils.secondsToTimestamp((dur * i) / 5)}</span>
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
