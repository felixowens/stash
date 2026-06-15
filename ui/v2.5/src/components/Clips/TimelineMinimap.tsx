import React, { useMemo, useRef } from "react";
import { ISceneSpriteInfo } from "src/hooks/sprite";
import { IViewport } from "./useTimelineViewport";
import { spriteCropStyleFill, spriteSheetExtent } from "./spriteCrop";

const MIN_WIN = 2; // smallest viewport window the minimap can resize to (seconds)

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

interface ITimelineMinimapProps {
  duration: number;
  view: IViewport;
  inSeconds: number;
  outSeconds: number;
  // shared with the filmstrip/hover preview — drawn faintly as an overview backdrop
  sprites: ISceneSpriteInfo[] | null | undefined;
  onSetView: (v: IViewport) => void;
}

// A full-scene overview rail under the trim track: the whole [0,dur] at a glance,
// with the selection marked and the current viewport drawn as a draggable window.
// Drag the window to pan, its edges to zoom, or click the rail to jump there — the
// orientation aid that keeps you from getting lost when zoomed into a long scene.
const TimelineMinimapImpl: React.FC<ITimelineMinimapProps> = ({
  duration,
  view,
  inSeconds,
  outSeconds,
  sprites,
  onSetView,
}) => {
  const railRef = useRef<HTMLDivElement>(null);
  const dur = duration > 0 ? duration : 1;

  const sheet = useMemo(
    () => (sprites && sprites.length ? spriteSheetExtent(sprites) : null),
    [sprites]
  );

  const pct = (t: number) => clamp((t / dur) * 100, 0, 100);
  const winLeft = pct(view.start);
  const winWidth = Math.max(0, pct(view.end) - winLeft);
  const selLeft = pct(inSeconds);
  const selWidth = Math.max(0, pct(outSeconds) - selLeft);

  function timeFromClientX(clientX: number) {
    const el = railRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return 0;
    return clamp(((clientX - r.left) / r.width) * dur, 0, dur);
  }

  function bindDrag(move: (ev: PointerEvent) => void) {
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  // pan: keep the grabbed point under the cursor, span fixed
  function startMove(grabOffset: number) {
    const span = view.end - view.start;
    bindDrag((ev) => {
      const start = clamp(
        timeFromClientX(ev.clientX) - grabOffset,
        0,
        dur - span
      );
      onSetView({ start, end: start + span });
    });
  }

  function onWindowPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    startMove(timeFromClientX(e.clientX) - view.start);
  }

  // resize one edge (= zoom), the opposite edge stays fixed at its grab value
  function onEdgePointerDown(e: React.PointerEvent, edge: "start" | "end") {
    e.preventDefault();
    e.stopPropagation();
    const fixedStart = view.start;
    const fixedEnd = view.end;
    bindDrag((ev) => {
      const t = timeFromClientX(ev.clientX);
      if (edge === "start") {
        onSetView({ start: clamp(t, 0, fixedEnd - MIN_WIN), end: fixedEnd });
      } else {
        onSetView({
          start: fixedStart,
          end: clamp(t, fixedStart + MIN_WIN, dur),
        });
      }
    });
  }

  // clicking the bare rail jumps the window's center there, then pans with the drag
  function onRailPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest(".clip-trim__minimap-window")) return;
    e.preventDefault();
    const span = view.end - view.start;
    const start = clamp(timeFromClientX(e.clientX) - span / 2, 0, dur - span);
    onSetView({ start, end: start + span });
    startMove(span / 2);
  }

  return (
    <div
      className="clip-trim__minimap"
      ref={railRef}
      onPointerDown={onRailPointerDown}
    >
      {sheet &&
        sprites &&
        sprites.map((s) => {
          const left = pct(s.start);
          const width = Math.max(0, pct(s.end) - left);
          return (
            <div
              className="clip-trim__minimap-frame"
              key={s.start}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                ...spriteCropStyleFill(s, sheet),
              }}
            />
          );
        })}
      <div
        className="clip-trim__minimap-sel"
        style={{ left: `${selLeft}%`, width: `${selWidth}%` }}
      />
      <div
        className="clip-trim__minimap-window"
        style={{ left: `${winLeft}%`, width: `${winWidth}%` }}
        onPointerDown={onWindowPointerDown}
      >
        <span
          className="clip-trim__minimap-edge clip-trim__minimap-edge--start"
          onPointerDown={(e) => onEdgePointerDown(e, "start")}
        />
        <span
          className="clip-trim__minimap-edge clip-trim__minimap-edge--end"
          onPointerDown={(e) => onEdgePointerDown(e, "end")}
        />
      </div>
    </div>
  );
};

export const TimelineMinimap = React.memo(TimelineMinimapImpl);
