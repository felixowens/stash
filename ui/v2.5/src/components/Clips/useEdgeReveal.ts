import { RefObject, useEffect, useState } from "react";

/**
 * True while chrome parked against the top edge should be showing.
 *
 * The wall is something you leave running, so the topbar gets out of the way
 * until you go looking for it: bringing the cursor within `edgePx` of the top
 * of the window — or anywhere over `zoneRef`, so interacting with the revealed
 * bar counts as being in the zone — shows it, and leaving hides it again after
 * `graceMs` so it isn't twitchy. Movement anywhere else on screen (over cells,
 * hover-unmuting) never reveals.
 *
 * A keypress, or a tap in that same band, has nowhere to hover from, so it
 * gets a timed peek of `holdMs` instead. The tap is only ever observed — never
 * swallowed — because it also lands on whatever cell is underneath.
 */
export function useEdgeReveal(
  edgePx: number,
  graceMs: number,
  holdMs: number,
  zoneRef?: RefObject<HTMLElement>
) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let hideTimer = 0;
    let holdTimer = 0;
    // only the crossing matters — rescheduling the hide on every pointermove
    // would keep the bar up for as long as the mouse kept moving anywhere
    let inside = false;

    function inZone(x: number, y: number) {
      if (y <= edgePx) return true;
      const rect = zoneRef?.current?.getBoundingClientRect();
      if (!rect) return false;
      return (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      );
    }

    function clearTimers() {
      window.clearTimeout(hideTimer);
      window.clearTimeout(holdTimer);
    }

    function onMove(e: PointerEvent) {
      // a touch drags the pointer around; only hovering reveals
      if (e.pointerType === "touch") return;
      const nowInside = inZone(e.clientX, e.clientY);
      if (nowInside === inside) return;
      inside = nowInside;
      clearTimers();
      if (nowInside) {
        setRevealed(true);
      } else {
        hideTimer = window.setTimeout(() => setRevealed(false), graceMs);
      }
    }

    function peek() {
      clearTimers();
      setRevealed(true);
      holdTimer = window.setTimeout(() => {
        if (!inside) setRevealed(false);
      }, holdMs);
    }

    function onPointerDown(e: PointerEvent) {
      if (e.pointerType !== "touch") return;
      if (inZone(e.clientX, e.clientY)) peek();
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("keydown", peek);
    return () => {
      clearTimers();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", peek);
    };
  }, [edgePx, graceMs, holdMs, zoneRef]);

  return revealed;
}
