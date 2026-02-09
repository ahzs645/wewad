import { interpolateKeyframes } from "../animations";

export function sampleAnimationEntry(entry, frame, frameSize, options = {}) {
  const keyframes = entry?.keyframes ?? [];
  if (keyframes.length === 0) {
    return null;
  }

  const wrapBeforeFirst = options.wrapBeforeFirst !== false;
  let sampleFrame = frame;
  const returnNullBeforeFirst = options.returnNullBeforeFirst ?? !wrapBeforeFirst;
  if (!wrapBeforeFirst && returnNullBeforeFirst && sampleFrame < keyframes[0].frame) {
    return null;
  }
  if (wrapBeforeFirst && frameSize > 0 && keyframes[0].frame >= 0 && frame < keyframes[0].frame) {
    sampleFrame += frameSize;
  }

  return interpolateKeyframes(keyframes, sampleFrame, {
    mode: options.mode ?? entry?.interpolation ?? "hermite",
    preExtrapolation: options.preExtrapolation ?? entry?.preExtrapolation ?? "clamp",
    postExtrapolation: options.postExtrapolation ?? entry?.postExtrapolation ?? "clamp",
    scaleTangents: options.scaleTangents ?? true,
  });
}

export function sampleDiscreteAnimationEntry(entry, frame, frameSize, options = {}) {
  const keyframes = entry?.keyframes ?? [];
  if (keyframes.length === 0) {
    return null;
  }

  const wrapBeforeFirst = options.wrapBeforeFirst !== false;
  let sampleFrame = frame;
  const returnNullBeforeFirst = options.returnNullBeforeFirst ?? !wrapBeforeFirst;
  if (!wrapBeforeFirst && returnNullBeforeFirst && sampleFrame < keyframes[0].frame) {
    return null;
  }
  if (wrapBeforeFirst && frameSize > 0 && keyframes[0].frame >= 0 && frame < keyframes[0].frame) {
    sampleFrame += frameSize;
  }

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
