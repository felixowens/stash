import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  useClipIncrementPlayCount,
  useClipSaveActivity,
} from "src/core/StashService";
import { useToast } from "src/hooks/Toast";

const MUTED_KEY = "clip-feed-muted";

type PlaybackStatus = "loading" | "playing" | "paused" | "blocked" | "error";

interface IPlaybackSession {
  id: string;
  source: string;
  watched: number;
  lastTime: number;
  resumeTime: number;
  playing: boolean;
}

/** Owns one media element for the entire feed, including across queue resets. */
export function useClipFeedPlayer(
  id: string | undefined,
  stream: string | null | undefined,
  queueGeneration: number
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<IPlaybackSession>();
  const playedIds = useRef(new Set<string>());
  const playRequest = useRef(0);
  const resumeOnVisible = useRef(false);
  const [incrementPlayCount] = useClipIncrementPlayCount();
  const [saveActivity] = useClipSaveActivity();
  const Toast = useToast();
  const operations = useRef({ incrementPlayCount, saveActivity, Toast });
  operations.current = { incrementPlayCount, saveActivity, Toast };

  const [muted, setMuted] = useState(
    () => localStorage.getItem(MUTED_KEY) !== "0"
  );
  const mutedRef = useRef(muted);
  const [status, setStatus] = useState<PlaybackStatus>("loading");
  const statusRef = useRef(status);
  const [progress, setProgress] = useState(0);

  const updateStatus = useCallback((value: PlaybackStatus) => {
    statusRef.current = value;
    setStatus(value);
  }, []);

  const currentMedia = useCallback(() => {
    const video = videoRef.current;
    const session = sessionRef.current;
    return video && session && video.currentSrc === session.source
      ? { video, session }
      : undefined;
  }, []);

  const sampleTime = useCallback(() => {
    const media = currentMedia();
    if (!media) return;
    const { video, session } = media;
    const time = video.currentTime;
    const delta = time - session.lastTime;
    if (session.playing && !video.seeking && delta > 0 && delta < 2) {
      session.watched += delta;
    }
    session.lastTime = time;
    session.resumeTime = time;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      setProgress(time / video.duration);
    }
  }, [currentMedia]);

  const flushActivity = useCallback(() => {
    sampleTime();
    const session = sessionRef.current;
    if (!session || session.watched <= 0) return;
    const playDuration = session.watched;
    session.watched = 0;
    operations.current
      .saveActivity({
        variables: {
          id: session.id,
          resume_time: session.resumeTime,
          playDuration,
        },
      })
      .catch(operations.current.Toast.error);
  }, [sampleTime]);

  const play = useCallback(() => {
    const video = videoRef.current;
    const session = sessionRef.current;
    if (!video || !session || document.hidden) return;
    const request = ++playRequest.current;
    sampleTime();
    updateStatus("loading");
    // Keep this call synchronous: taps must reach the media element while the
    // browser's user gesture is still active, not in a React effect or timer.
    video
      .play()
      .then(() => {
        if (
          session === sessionRef.current &&
          request === playRequest.current &&
          !video.paused
        ) {
          updateStatus("playing");
        }
      })
      .catch((error: unknown) => {
        if (session !== sessionRef.current || request !== playRequest.current) {
          return;
        }
        const name = error instanceof DOMException ? error.name : undefined;
        updateStatus(
          name === "NotAllowedError"
            ? "blocked"
            : name === "AbortError"
            ? "paused"
            : "error"
        );
      });
  }, [sampleTime, updateStatus]);

  const pause = useCallback(() => {
    ++playRequest.current;
    flushActivity();
    videoRef.current?.pause();
    if (sessionRef.current) sessionRef.current.playing = false;
    updateStatus("paused");
  }, [flushActivity, updateStatus]);

  const retry = useCallback(() => {
    if (statusRef.current === "error") {
      flushActivity();
      const session = sessionRef.current;
      if (session) {
        session.lastTime = 0;
        session.resumeTime = 0;
        session.playing = false;
      }
      videoRef.current?.load();
    }
    play();
  }, [flushActivity, play]);

  const togglePlay = useCallback(() => {
    resumeOnVisible.current = false;
    if (videoRef.current?.paused || statusRef.current === "error") retry();
    else pause();
  }, [pause, retry]);

  const setMutedPersistent = useCallback(
    (value: boolean) => {
      mutedRef.current = value;
      if (videoRef.current) videoRef.current.muted = value;
      setMuted(value);
      localStorage.setItem(MUTED_KEY, value ? "1" : "0");
      if (!videoRef.current?.paused || statusRef.current === "blocked") play();
    },
    [play]
  );

  const seek = useCallback(
    (time: number) => {
      const media = currentMedia();
      if (!media || !Number.isFinite(media.video.duration)) return;
      sampleTime();
      const target = Math.max(0, Math.min(time, media.video.duration));
      media.session.lastTime = target;
      media.session.resumeTime = target;
      media.video.currentTime = target;
      setProgress(media.video.duration > 0 ? target / media.video.duration : 0);
    },
    [currentMedia, sampleTime]
  );

  const releasePlayer = useCallback(
    (video: HTMLVideoElement | null) => {
      ++playRequest.current;
      flushActivity();
      video?.pause();
      sessionRef.current = undefined;
    },
    [flushActivity]
  );

  useLayoutEffect(() => {
    playedIds.current.clear();
  }, [queueGeneration]);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    releasePlayer(video);
    setProgress(0);
    resumeOnVisible.current = false;

    if (!id || !stream) {
      video.removeAttribute("src");
      video.load();
      updateStatus(id ? "error" : "loading");
      return;
    }

    video.muted = mutedRef.current;
    video.src = stream;
    sessionRef.current = {
      id,
      source: video.src,
      watched: 0,
      lastTime: 0,
      resumeTime: 0,
      playing: false,
    };
    video.load();
    if (document.hidden) {
      resumeOnVisible.current = true;
      updateStatus("paused");
    } else {
      play();
    }
  }, [id, stream, queueGeneration, releasePlayer, play, updateStatus]);

  useLayoutEffect(() => {
    const video = videoRef.current;
    return () => releasePlayer(video);
  }, [releasePlayer]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        resumeOnVisible.current =
          !!videoRef.current && !videoRef.current.paused;
        pause();
      } else if (resumeOnVisible.current) {
        resumeOnVisible.current = false;
        play();
      }
    };
    const onPageHide = () => {
      ++playRequest.current;
      flushActivity();
      videoRef.current?.pause();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [flushActivity, pause, play]);

  const onPlaying = useCallback(() => {
    const media = currentMedia();
    if (!media || media.video.paused) return;
    media.session.playing = true;
    media.session.lastTime = media.video.currentTime;
    updateStatus("playing");
    if (!playedIds.current.has(media.session.id)) {
      playedIds.current.add(media.session.id);
      operations.current
        .incrementPlayCount({ variables: { id: media.session.id } })
        .catch(operations.current.Toast.error);
    }
  }, [currentMedia, updateStatus]);

  const onPause = useCallback(() => {
    const media = currentMedia();
    if (!media || !media.video.paused) return;
    flushActivity();
    media.session.playing = false;
    if (statusRef.current === "playing") updateStatus("paused");
  }, [currentMedia, flushActivity, updateStatus]);

  const onWaiting = useCallback(() => {
    const media = currentMedia();
    if (media && !media.video.paused) {
      sampleTime();
      media.session.playing = false;
      updateStatus("loading");
    }
  }, [currentMedia, sampleTime, updateStatus]);

  const onError = useCallback(() => {
    if (currentMedia()?.video.error) updateStatus("error");
  }, [currentMedia, updateStatus]);

  return {
    videoRef,
    muted,
    status,
    progress,
    togglePlay,
    retry,
    setMutedPersistent,
    seek,
    events: {
      onPlaying,
      onPause,
      onWaiting,
      onError,
      onTimeUpdate: sampleTime,
    },
  };
}
