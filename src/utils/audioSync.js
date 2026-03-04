let sharedContext = null;

function getAudioContext() {
  if (!sharedContext || sharedContext.state === "closed") {
    sharedContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return sharedContext;
}

function buildAudioBuffer(bnsMetadata) {
  const ctx = getAudioContext();
  const channelCount = Math.max(1, bnsMetadata.channelCount ?? bnsMetadata.pcm16.length);
  const sampleCount = Math.min(...bnsMetadata.pcm16.map((ch) => ch.length));
  if (sampleCount <= 0) return null;

  const buf = ctx.createBuffer(channelCount, sampleCount, bnsMetadata.sampleRate);
  for (let ch = 0; ch < channelCount; ch++) {
    const src = bnsMetadata.pcm16[ch] ?? bnsMetadata.pcm16[bnsMetadata.pcm16.length - 1];
    const dest = buf.getChannelData(ch);
    for (let i = 0; i < sampleCount; i++) {
      dest[i] = (src[i] ?? 0) / 32768;
    }
  }
  return buf;
}

export function createAudioSyncController(audioElement, bnsMetadata, fps = 60, { animationLoops = false } = {}) {
  if (!bnsMetadata?.pcm16?.length) return null;

  const ctx = getAudioContext();
  const audioBuffer = buildAudioBuffer(bnsMetadata);
  if (!audioBuffer) return null;

  const sampleRate = bnsMetadata.sampleRate || 1;
  const loopFlag = Boolean(bnsMetadata.loopFlag);
  const totalDuration = audioBuffer.duration;
  const shouldLoop = loopFlag;
  const loopStartTime = loopFlag ? (bnsMetadata.loopStart || 0) / sampleRate : 0;
  const loopAudioDuration = totalDuration - loopStartTime;

  let sourceNode = null;
  let gainNode = ctx.createGain();
  gainNode.connect(ctx.destination);

  // Track playback start so we can compute current position
  let playStartContextTime = 0;
  let playStartOffset = 0;
  let playing = false;

  function getCurrentTime() {
    if (!playing) return playStartOffset;
    return playStartOffset + (ctx.currentTime - playStartContextTime);
  }

  function getExpectedAudioTime(globalFrame) {
    const elapsed = globalFrame / fps;
    if (!shouldLoop) return Math.min(elapsed, totalDuration);
    if (elapsed <= totalDuration) return elapsed;
    if (loopAudioDuration <= 0) return totalDuration;
    const overflow = elapsed - totalDuration;
    return loopStartTime + (overflow % loopAudioDuration);
  }

  function startSource(offset) {
    stopSource();
    if (ctx.state === "suspended") ctx.resume();

    sourceNode = ctx.createBufferSource();
    sourceNode.buffer = audioBuffer;

    if (shouldLoop) {
      sourceNode.loop = true;
      sourceNode.loopStart = loopStartTime;
      sourceNode.loopEnd = totalDuration;
    }

    sourceNode.connect(gainNode);

    const clampedOffset = Math.max(0, Math.min(offset, totalDuration));
    playStartOffset = clampedOffset;
    playStartContextTime = ctx.currentTime;
    sourceNode.start(0, clampedOffset);
    playing = true;

    const thisNode = sourceNode;
    sourceNode.onended = () => {
      if (sourceNode === thisNode) {
        playing = false;
        sourceNode = null;
      }
    };
  }

  function stopSource() {
    if (sourceNode) {
      try { sourceNode.stop(); } catch (_) { /* already stopped */ }
      sourceNode.disconnect();
      sourceNode = null;
    }
    playing = false;
  }

  function play(offset) {
    startSource(offset ?? 0);
  }

  function pause() {
    if (playing) {
      playStartOffset = getCurrentTime();
    }
    stopSource();
  }

  function stop() {
    stopSource();
    playStartOffset = 0;
  }

  function seekToFrame(globalFrame) {
    const target = getExpectedAudioTime(globalFrame);
    if (playing) {
      startSource(target);
    } else {
      playStartOffset = target;
    }
  }

  function syncFrame(globalFrame) {
    if (!playing) return;
    const expected = getExpectedAudioTime(globalFrame);
    const actual = getCurrentTime();
    if (Math.abs(actual - expected) > 0.15) {
      startSource(expected);
    }
  }

  function setVolume(v) {
    gainNode.gain.value = Math.max(0, Math.min(1, v));
  }

  function dispose() {
    stopSource();
    gainNode.disconnect();
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
