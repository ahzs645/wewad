const DRIFT_THRESHOLD = 0.1;

export function createAudioSyncController(audioElement, bnsMetadata, fps = 60) {
  if (!audioElement || !bnsMetadata) return null;

  const sampleRate = bnsMetadata.sampleRate || 1;
  const loopFlag = Boolean(bnsMetadata.loopFlag);
  const loopStartTime = loopFlag ? (bnsMetadata.loopStart || 0) / sampleRate : 0;
  const totalDuration = bnsMetadata.durationSeconds || (bnsMetadata.sampleCount / sampleRate) || 0;
  const loopAudioDuration = totalDuration - loopStartTime;

  function getExpectedAudioTime(globalFrame) {
    const elapsed = globalFrame / fps;

    if (!loopFlag) {
      return Math.min(elapsed, totalDuration);
    }

    if (elapsed <= totalDuration) {
      return elapsed;
    }

    if (loopAudioDuration <= 0) {
      return totalDuration;
    }

    const overflow = elapsed - totalDuration;
    return loopStartTime + (overflow % loopAudioDuration);
  }

  function syncFrame(globalFrame) {
    if (audioElement.paused) return;
    const expected = getExpectedAudioTime(globalFrame);
    const actual = audioElement.currentTime;
    if (Math.abs(actual - expected) > DRIFT_THRESHOLD) {
      audioElement.currentTime = expected;
    }
  }

  function seekToFrame(globalFrame) {
    const expected = getExpectedAudioTime(globalFrame);
    audioElement.currentTime = expected;
  }

  function handleTimeUpdate() {
    if (!loopFlag) return;
    if (audioElement.currentTime >= totalDuration - 0.05) {
      audioElement.currentTime = loopStartTime;
    }
  }

  return {
    getExpectedAudioTime,
    syncFrame,
    seekToFrame,
    handleTimeUpdate,
  };
}
