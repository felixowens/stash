import { RefObject, useCallback, useEffect, useRef, useState } from "react";

const MIN_SPAN_SECONDS = 2; // smallest visible window when zoomed all the way in
const ZOOM_STEP = 0.85; // span multiplier per wheel notch (zooming in)
const ZOOM_BTN = 0.6; // span multiplier per button / key zoom (zooming in)
const SEL_PAD = 0.15; // breathing room around the selection for "zoom to selection"
const EPS = 0.01;

// how close (px) to a track edge a drag must get to start auto-panning the view
export const EDGE_PX = 24;
// wheel-notch zoom factors, exported so the wheel handler stays in one vocabulary
export const ZOOM_IN_STEP = ZOOM_STEP;
export const ZOOM_OUT_STEP = 1 / ZOOM_STEP;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export interface IViewport {
  start: number;
  end: number;
}

// Pure: percent position of a time within a viewport window. May be <0 or >100
// when the time falls outside the visible window — callers clamp where needed.
export function pctOf(t: number, view: IViewport): number {
  const span = view.end - view.start;
  return span > 0 ? ((t - view.start) / span) * 100 : 0;
}

export interface ITimelineViewport {
  view: IViewport;
  span: number;
  trackWidth: number;
  pxPerSecond: number;
  minSpan: number;
  atFullSpan: boolean;
  atMinSpan: boolean;

  // client-x (mouse) -> seconds, clamped to [0,dur]; ...Raw is unclamped (hover)
  timeFromClientX: (clientX: number) => number;
  timeFromClientXRaw: (clientX: number) => number;

  setView: (v: IViewport) => void;
  zoomAtClientX: (clientX: number, factor: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  zoomToSelection: (inS: number, outS: number) => void;
  panBy: (deltaSeconds: number) => void;
  ensureVisible: (t: number) => void;
}

// The px<->time engine + zoom/pan state behind the clip trim timeline. The track
// no longer maps the whole scene onto its width; it shows a movable window
// [view.start, view.end] (seconds), so long scenes can be zoomed for precision.
// Document-level handlers read the live view/dur via refs to dodge stale closures
// (same pattern ClipTrimmer uses for its in/out refs), so the commands keep stable
// identities and don't churn native listeners.
export function useTimelineViewport(
  dur: number,
  trackRef: RefObject<HTMLElement>
): ITimelineViewport {
  const [view, setViewState] = useState<IViewport>(() => ({
    start: 0,
    end: dur,
  }));
  const [trackWidth, setTrackWidth] = useState(0);

  const viewRef = useRef(view);
  viewRef.current = view;
  const durRef = useRef(dur);
  durRef.current = dur;
  // once the user zooms/pans, a late durationchange must not reset their view
  const touchedRef = useRef(false);

  // clamp a desired (start, span) into a valid window and commit it
  const commit = useCallback((start: number, span: number) => {
    const d = durRef.current;
    if (d <= 0) return;
    const lo = Math.min(MIN_SPAN_SECONDS, d);
    const s = clamp(span, lo, d);
    const st = clamp(start, 0, d - s);
    setViewState({ start: st, end: st + s });
    touchedRef.current = true;
  }, []);

  const timeFromClientXRaw = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      const v = viewRef.current;
      if (!el) return v.start;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return v.start;
      return v.start + ((clientX - r.left) / r.width) * (v.end - v.start);
    },
    [trackRef]
  );

  const timeFromClientX = useCallback(
    (clientX: number) => clamp(timeFromClientXRaw(clientX), 0, durRef.current),
    [timeFromClientXRaw]
  );

  // zoom keeping the time under the cursor fixed (the cursor fraction is held)
  const zoomAtClientX = useCallback(
    (clientX: number, factor: number) => {
      const el = trackRef.current;
      const v = viewRef.current;
      const curSpan = v.end - v.start;
      let frac = 0.5;
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0) frac = clamp((clientX - r.left) / r.width, 0, 1);
      }
      const anchorTime = v.start + frac * curSpan;
      const newSpan = curSpan * factor;
      commit(anchorTime - frac * newSpan, newSpan);
    },
    [trackRef, commit]
  );

  const zoomIn = useCallback(() => {
    const v = viewRef.current;
    const c = (v.start + v.end) / 2;
    const s = (v.end - v.start) * ZOOM_BTN;
    commit(c - s / 2, s);
  }, [commit]);

  const zoomOut = useCallback(() => {
    const v = viewRef.current;
    const c = (v.start + v.end) / 2;
    const s = (v.end - v.start) / ZOOM_BTN;
    commit(c - s / 2, s);
  }, [commit]);

  const fit = useCallback(() => commit(0, durRef.current), [commit]);

  const zoomToSelection = useCallback(
    (inS: number, outS: number) => {
      const d = durRef.current;
      if (d <= 0) return;
      const lo = Math.min(MIN_SPAN_SECONDS, d);
      const selLen = Math.max(outS - inS, lo);
      const newSpan = selLen * (1 + 2 * SEL_PAD);
      const center = (inS + outS) / 2;
      commit(center - newSpan / 2, newSpan);
    },
    [commit]
  );

  const panBy = useCallback(
    (ds: number) => {
      const v = viewRef.current;
      commit(v.start + ds, v.end - v.start);
    },
    [commit]
  );

  const ensureVisible = useCallback(
    (t: number) => {
      const v = viewRef.current;
      const span = v.end - v.start;
      if (t < v.start || t > v.end) commit(t - span / 2, span);
    },
    [commit]
  );

  const setView = useCallback(
    (v: IViewport) => commit(v.start, v.end - v.start),
    [commit]
  );

  // late duration (0 -> real on metadata load) refits, unless the user has zoomed
  useEffect(() => {
    if (!touchedRef.current && dur > 0) {
      setViewState({ start: 0, end: dur });
    }
  }, [dur]);

  // track width drives px math; the details Collapse / window resize can change it
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const update = () => setTrackWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [trackRef]);

  const span = view.end - view.start;
  const pxPerSecond = span > 0 && trackWidth > 0 ? trackWidth / span : 0;
  const minSpan = dur > 0 ? Math.min(MIN_SPAN_SECONDS, dur) : MIN_SPAN_SECONDS;
  const atFullSpan = dur <= 0 || span >= dur - EPS;
  const atMinSpan = span <= minSpan + EPS;

  return {
    view,
    span,
    trackWidth,
    pxPerSecond,
    minSpan,
    atFullSpan,
    atMinSpan,
    timeFromClientX,
    timeFromClientXRaw,
    setView,
    zoomAtClientX,
    zoomIn,
    zoomOut,
    fit,
    zoomToSelection,
    panBy,
    ensureVisible,
  };
}
