import { useCallback, useEffect, useState } from "react";
import { getAbLoopPlugin, getPlayer } from "../ScenePlayer/util";

export interface ISceneClock {
  currentTime: number;
  duration: number;
  playing: boolean;
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
  setLoop: (start: number, end: number) => void;
  clearLoop: () => void;
}

// Subscribes to the live scene ScenePlayer (videojs) and exposes a small clock
// the clip trimmer can drive: read the playhead, seek, and loop a range via the
// AB-loop plugin. The player lives in the scene detail's player column; this hook
// reaches it through the ScenePlayer util seam.
export function useSceneClock(fallbackDuration = 0): ISceneClock {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(fallbackDuration);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let detach: (() => void) | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;

    function attach() {
      const player = getPlayer();
      if (!player) return false;

      const onTime = () => setCurrentTime(player.currentTime() ?? 0);
      const onDur = () => {
        const d = player.duration();
        if (d && isFinite(d) && d > 0) setDuration(d);
      };
      const onPlay = () => setPlaying(true);
      const onPause = () => setPlaying(false);

      player.on("timeupdate", onTime);
      player.on("durationchange", onDur);
      player.on("play", onPlay);
      player.on("pause", onPause);
      onTime();
      onDur();

      detach = () => {
        player.off("timeupdate", onTime);
        player.off("durationchange", onDur);
        player.off("play", onPlay);
        player.off("pause", onPause);
      };
      return true;
    }

    // the player may not be initialised yet — retry briefly until it is
    if (!attach()) {
      poll = setInterval(() => {
        if (attach() && poll) {
          clearInterval(poll);
          poll = undefined;
        }
      }, 200);
    }

    return () => {
      if (poll) clearInterval(poll);
      detach?.();
    };
  }, []);

  const seek = useCallback((t: number) => {
    const player = getPlayer();
    if (player) player.currentTime(t);
    setCurrentTime(t);
  }, []);

  const play = useCallback(() => {
    const p = getPlayer()?.play();
    if (p) p.catch(() => {});
  }, []);

  const pause = useCallback(() => {
    getPlayer()?.pause();
  }, []);

  const setLoop = useCallback((start: number, end: number) => {
    getAbLoopPlugin()?.setOptions({ start, end, enabled: true });
  }, []);

  const clearLoop = useCallback(() => {
    const ab = getAbLoopPlugin();
    if (ab) {
      const opts = ab.getOptions();
      ab.setOptions({ ...opts, enabled: false });
    }
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
