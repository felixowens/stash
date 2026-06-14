import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import { ISceneClock } from "./useSceneClock";

// Drives a plain <video> element as an ISceneClock for the create-clip theater.
// Unlike useSceneClock (which reaches into the videojs scene player), this owns
// its own element — so looping is a timeupdate guard rather than the AB-loop
// plugin, and there's no poll-until-ready dance. Same interface, so ClipTrimmer
// and SceneFilmstrip consume it unchanged.
export function useVideoClock(
  videoRef: RefObject<HTMLVideoElement>,
  fallbackDuration = 0
): ISceneClock {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(fallbackDuration);
  const [playing, setPlaying] = useState(false);
  const loopRef = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTime = () => {
      const loop = loopRef.current;
      if (loop && v.currentTime >= loop.end) {
        v.currentTime = loop.start;
        setCurrentTime(loop.start);
        return;
      }
      setCurrentTime(v.currentTime);
    };
    const onDur = () => {
      if (isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    // if the out-point is the very end of the source, the element fires 'ended'
    // before timeupdate can wrap it — keep a preview loop alive across that edge
    const onEnded = () => {
      const loop = loopRef.current;
      if (loop) {
        v.currentTime = loop.start;
        const p = v.play();
        if (p) p.catch(() => {});
      }
    };

    v.addEventListener("timeupdate", onTime);
    // 'seeked' keeps currentTime correct for seeks that don't go through this
    // clock (e.g. a paused scrub) — 'timeupdate' alone can miss those.
    v.addEventListener("seeked", onTime);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("loadedmetadata", onDur);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    onDur();

    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("seeked", onTime);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("loadedmetadata", onDur);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
    };
  }, [videoRef]);

  const seek = useCallback(
    (t: number) => {
      const v = videoRef.current;
      if (v) v.currentTime = t;
      setCurrentTime(t);
    },
    [videoRef]
  );

  const play = useCallback(() => {
    const p = videoRef.current?.play();
    if (p) p.catch(() => {});
  }, [videoRef]);

  const pause = useCallback(() => {
    videoRef.current?.pause();
  }, [videoRef]);

  const setLoop = useCallback((start: number, end: number) => {
    loopRef.current = { start, end };
  }, []);

  const clearLoop = useCallback(() => {
    loopRef.current = null;
  }, []);

  return {
    currentTime,
    duration,
    playing,
    seek,
    play,
    pause,
    setLoop,
    clearLoop,
  };
}
