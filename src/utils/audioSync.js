import { createWavBuffer } from "./audio";

export function createAudioSyncController(audioElement, bnsMetadata, fps = 60, { animationLoops = false } = {}) {
  if (!bnsMetadata?.pcm16?.length) return null;

  const wavBuffer = createWavBuffer(bnsMetadata);
  if (!wavBuffer) return null;

  const blob = new Blob([wavBuffer], { type: "audio/wav" });
  const objectUrl = URL.createObjectURL(blob);
  const audio = audioElement ?? new Audio();
  audio.preload = "auto";
  audio.src = objectUrl;
  audio.load();

  const sampleRate = bnsMetadata.sampleRate || 1;
  const loopFlag = Boolean(bnsMetadata.loopFlag);
  const totalDuration = Math.max(
    0,
    Number.isFinite(bnsMetadata.durationSeconds)
      ? bnsMetadata.durationSeconds
      : (bnsMetadata.sampleCount ?? 0) / sampleRate,
  );
  const rawLoopStartTime = loopFlag ? (bnsMetadata.loopStart || 0) / sampleRate : 0;
  const loopStartTime = Math.max(0, Math.min(rawLoopStartTime, totalDuration));
  const shouldLoop = loopFlag && animationLoops && loopStartTime < totalDuration;
  const loopAudioDuration = shouldLoop ? (totalDuration - loopStartTime) : 0;

  let readyPromise = null;
  let playToken = 0;
  let playing = false;
  let shouldBePlaying = false;
  let pausedOffset = 0;
  let disposed = false;

  function normalizePlaybackTime(rawTime) {
    const time = Number.isFinite(rawTime) ? Math.max(0, rawTime) : 0;
    if (!shouldLoop || loopAudioDuration <= 0) {
      return Math.min(time, totalDuration);
    }
    if (time <= totalDuration) {
      return time;
    }
    const overflow = time - totalDuration;
    return loopStartTime + (overflow % loopAudioDuration);
  }

  function isReady() {
    return audio.readyState >= 1;
  }

  function ensureReady() {
    if (isReady()) {
      return Promise.resolve();
    }
    if (!readyPromise) {
      readyPromise = new Promise((resolve, reject) => {
        const cleanup = () => {
          audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
          audio.removeEventListener("canplay", handleLoadedMetadata);
          audio.removeEventListener("error", handleError);
        };
        const handleLoadedMetadata = () => {
          cleanup();
          resolve();
        };
        const handleError = () => {
          cleanup();
          reject(audio.error ?? new Error("Failed to load audio"));
        };

        audio.addEventListener("loadedmetadata", handleLoadedMetadata, { once: true });
        audio.addEventListener("canplay", handleLoadedMetadata, { once: true });
        audio.addEventListener("error", handleError, { once: true });
        audio.load();
      });
    }
    return readyPromise;
  }

  function getCurrentTime() {
    if (playing && Number.isFinite(audio.currentTime)) {
      return normalizePlaybackTime(audio.currentTime);
    }
    return normalizePlaybackTime(pausedOffset);
  }

  function setCurrentTime(rawTime) {
    const nextTime = normalizePlaybackTime(rawTime);
    pausedOffset = nextTime;

    if (!isReady()) {
      return nextTime;
    }

    try {
      audio.currentTime = nextTime;
    } catch {
      // Some runtimes reject seeks before metadata is fully ready.
    }
    return nextTime;
  }

  function getExpectedAudioTime(globalFrame) {
    const frame = Number.isFinite(globalFrame) ? Math.max(0, globalFrame) : 0;
    const elapsed = frame / fps;
    if (!shouldLoop) return Math.min(elapsed, totalDuration);
    if (elapsed <= totalDuration) return elapsed;
    if (loopAudioDuration <= 0) return totalDuration;
    const overflow = elapsed - totalDuration;
    return loopStartTime + (overflow % loopAudioDuration);
  }

  async function play(offset) {
    if (disposed) return;

    const token = ++playToken;
    shouldBePlaying = true;
    const target = setCurrentTime(offset ?? pausedOffset);

    try {
      await ensureReady();
      if (disposed || token !== playToken || !shouldBePlaying) return;
      setCurrentTime(target);
      await audio.play();
      if (disposed || token !== playToken || !shouldBePlaying) {
        audio.pause();
        return;
      }
      playing = true;
    } catch {
      if (token === playToken) {
        playing = false;
        shouldBePlaying = false;
      }
    }
  }

  function pause() {
    playToken += 1;
    pausedOffset = getCurrentTime();
    shouldBePlaying = false;
    playing = false;
    audio.pause();
  }

  function stop() {
    playToken += 1;
    shouldBePlaying = false;
    playing = false;
    audio.pause();
    setCurrentTime(0);
  }

  function seekToFrame(globalFrame) {
    const target = getExpectedAudioTime(globalFrame);
    setCurrentTime(target);

    if (shouldBePlaying && audio.paused && !disposed) {
      void play(target);
    }
  }

  function syncFrame(globalFrame) {
    if (!shouldBePlaying || disposed) return;

    const expected = getExpectedAudioTime(globalFrame);
    const actual = getCurrentTime();
    let drift = Math.abs(actual - expected);
    if (shouldLoop && loopAudioDuration > 0 && actual >= loopStartTime && expected >= loopStartTime) {
      drift = Math.min(drift, Math.abs(loopAudioDuration - drift));
    }

    if (drift > 0.15) {
      setCurrentTime(expected);
    }

    if (audio.paused) {
      void play(expected);
    }
  }

  function setVolume(value) {
    audio.volume = Math.max(0, Math.min(1, value));
  }

  function handlePause() {
    if (!shouldBePlaying) {
      playing = false;
      pausedOffset = getCurrentTime();
    }
  }

  function handleEnded() {
    if (shouldLoop && shouldBePlaying && !disposed) {
      setCurrentTime(loopStartTime);
      void play(loopStartTime);
      return;
    }

    playing = false;
    shouldBePlaying = false;
    pausedOffset = totalDuration;
  }

  audio.addEventListener("pause", handlePause);
  audio.addEventListener("ended", handleEnded);

  function dispose() {
    disposed = true;
    playToken += 1;
    shouldBePlaying = false;
    playing = false;
    audio.pause();
    audio.removeEventListener("pause", handlePause);
    audio.removeEventListener("ended", handleEnded);
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(objectUrl);
  }

  return {
    play,
    pause,
    stop,
    seekToFrame,
    syncFrame,
    setVolume,
    dispose,
    getExpectedAudioTime,
    get playing() { return playing; },
    get duration() { return totalDuration; },
    get currentTime() { return getCurrentTime(); },
  };
}
