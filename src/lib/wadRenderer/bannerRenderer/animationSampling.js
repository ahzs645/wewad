import { interpolateKeyframes } from "../animations";

export function sampleAnimationEntry(entry, frame, frameSize, options = {}) {
  const keyframes = entry?.keyframes ?? [];
  if (keyframes.length === 0) {
    return null;
  }

  // Match NW4R/reference behavior: always clamp to [firstKey, lastKey].
  // Loop wrapping is handled at the playback level (normalizeFrame), not here.
  const sampleFrame = frame;

  return interpolateKeyframes(keyframes, sampleFrame, {
    mode: options.mode ?? entry?.interpolation ?? "hermite",
    preExtrapolation: "clamp",
    postExtrapolation: "clamp",
    scaleTangents: options.scaleTangents ?? true,
  });
}

export function sampleDiscreteAnimationEntry(entry, frame, frameSize, options = {}) {
  const keyframes = entry?.keyframes ?? [];
  if (keyframes.length === 0) {
    return null;
  }

  // Match NW4R/reference behavior: clamp — use first keyframe value if before first keyframe.
  const sampleFrame = frame;

  let selected = keyframes[0];
  for (const keyframe of keyframes) {
    if (sampleFrame < keyframe.frame) {
      break;
    }
    selected = keyframe;
  }
  return selected?.value ?? null;
}

export function sampleAnimationEntryWithDataType(entry, frame, frameSize, options = {}) {
  if (!entry) {
    return null;
  }

  // Integer/discrete BRLAN entries (e.g. RLVI, some RLMC channels) should
  // step at keyframes instead of Hermite interpolation.
  if (entry.dataType === 1 || entry.interpolation === "step") {
    return sampleDiscreteAnimationEntry(entry, frame, frameSize, options);
  }

  return sampleAnimationEntry(entry, frame, frameSize, {
    ...options,
    mode: options.mode ?? entry.interpolation ?? "hermite",
  });
}
