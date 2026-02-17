import { interpolateKeyframes } from "../lib/wadRenderer";
import {
  normalizeRenderState,
  resolveAutoRenderState,
  findStateAnimationEntry,
  shouldHoldStateAnimation,
} from "./renderState";

export function clampFrame(value, max) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(max, Math.round(value)));
}

export function findAlphaRevealFrame(animation, paneNamePattern = null) {
  if (!animation?.panes?.length) {
    return null;
  }

  const revealFrames = [];
  for (const pane of animation.panes) {
    if (paneNamePattern && !paneNamePattern.test(pane.name)) {
      continue;
    }

    for (const tag of pane.tags ?? []) {
      for (const entry of tag.entries ?? []) {
        if (entry.type !== 0x0a && entry.type !== 0x10) {
          continue;
        }

        for (const keyframe of entry.keyframes ?? []) {
          if (Number.isFinite(keyframe.frame) && Number.isFinite(keyframe.value) && keyframe.value >= 200) {
            revealFrames.push(keyframe.frame);
            break;
          }
        }
      }
    }
  }

  if (revealFrames.length === 0) {
    return null;
  }
  return Math.min(...revealFrames);
}

export function sampleAnimatedEntry(entry, frame, frameSize) {
  const keyframes = entry?.keyframes ?? [];
  if (keyframes.length === 0) {
    return null;
  }

  return interpolateKeyframes(keyframes, frame);
}

export function sampleDiscreteAnimatedEntry(entry, frame, frameSize) {
  const keyframes = entry?.keyframes ?? [];
  if (keyframes.length === 0) {
    return null;
  }

  let selected = keyframes[0];
  for (const keyframe of keyframes) {
    if (frame < keyframe.frame) {
      break;
    }
    selected = keyframe;
  }
  return selected?.value ?? null;
}

export function buildPaneAnimationMap(animation) {
  const paneAnimationMap = new Map();
  for (const paneAnimation of animation?.panes ?? []) {
    if (!paneAnimationMap.has(paneAnimation.name)) {
      paneAnimationMap.set(paneAnimation.name, paneAnimation);
    }
  }
  return paneAnimationMap;
}

export function buildPaneChainResolver(layout) {
  const panesByName = new Map();
  for (const pane of layout?.panes ?? []) {
    if (!panesByName.has(pane.name)) {
      panesByName.set(pane.name, pane);
    }
  }

  const cache = new Map();
  const getPaneChain = (pane) => {
    if (!pane) {
      return [];
    }

    const cached = cache.get(pane.name);
    if (cached) {
      return cached;
    }

    const chain = [];
    const seen = new Set();
    let current = pane;
    while (current && !seen.has(current.name)) {
      chain.push(current);
      seen.add(current.name);
      if (!current.parent) {
        break;
      }
      current = panesByName.get(current.parent) ?? null;
    }

    chain.reverse();
    cache.set(pane.name, chain);
    return chain;
  };

  return getPaneChain;
}

export function getAnimatedPaneState(pane, paneAnimation, frame, frameSize) {
  let scaleX = null;
  let scaleY = null;
  let alpha = null;
  let visible = null;
  let width = null;
  let height = null;

  for (const tag of paneAnimation?.tags ?? []) {
    const tagType = String(tag?.type ?? "");
    for (const entry of tag.entries ?? []) {
      if (tagType === "RLPA" || !tagType) {
        const value = sampleAnimatedEntry(entry, frame, frameSize);
        if (value == null) {
          continue;
        }
        switch (entry.type) {
          case 0x06:
            scaleX = value;
            break;
          case 0x07:
            scaleY = value;
            break;
          case 0x08:
            width = value;
            break;
          case 0x09:
            height = value;
            break;
          case 0x0a:
            alpha = value;
            break;
          default:
            break;
        }
      } else if (tagType === "RLVC") {
        if (entry.type !== 0x10) {
          continue;
        }
        const value = sampleAnimatedEntry(entry, frame, frameSize);
        if (value != null) {
          alpha = value;
        }
      } else if (tagType === "RLVI") {
        if (entry.type !== 0x00) {
          continue;
        }
        const value = sampleDiscreteAnimatedEntry(entry, frame, frameSize);
        if (value != null) {
          visible = value >= 0.5;
        }
      }
    }
  }

  const hasAnimatedAlpha = alpha != null;
  const isVisible = visible != null ? visible : hasAnimatedAlpha ? true : pane.visible !== false;
  const defaultAlpha = isVisible ? (pane.alpha ?? 255) / 255 : 0;
  const animatedAlpha = hasAnimatedAlpha ? alpha / 255 : defaultAlpha;

  return {
    scaleX: scaleX ?? pane.scale?.x ?? 1,
    scaleY: scaleY ?? pane.scale?.y ?? 1,
    width: width ?? pane.size?.w ?? 0,
    height: height ?? pane.size?.h ?? 0,
    alpha: Math.max(0, Math.min(1, isVisible ? animatedAlpha : 0)),
  };
}

export function scoreStartFrame(layout, startAnim, frame, paneAnimationMap, getPaneChain) {
  const frameSize = Math.max(1, Math.floor(startAnim?.frameSize ?? 1));
  const panes = (layout?.panes ?? []).filter((pane) => pane.type === "pic1" || pane.type === "txt1");

  let visibleCount = 0;
  let score = 0;

  for (const pane of panes) {
    let alpha = 1;
    let aggregateScale = 1;
    const chain = getPaneChain(pane);
    for (const chainPane of chain) {
      const state = getAnimatedPaneState(chainPane, paneAnimationMap.get(chainPane.name), frame, frameSize);
      alpha *= state.alpha;
      aggregateScale *= Math.max(0, (Math.abs(state.scaleX) + Math.abs(state.scaleY)) * 0.5);
      if (alpha <= 0.01) {
        break;
      }
    }

    if (alpha <= 0.01) {
      continue;
    }

    visibleCount += 1;
    const paneState = getAnimatedPaneState(pane, paneAnimationMap.get(pane.name), frame, frameSize);
    const paneArea = Math.max(1, Math.abs(paneState.width) * Math.abs(paneState.height));
    const scaledWeight = Math.max(0, Math.min(4, aggregateScale));
    score += alpha * scaledWeight * Math.sqrt(paneArea);
  }

  return { score, visibleCount };
}

export function suggestInitialFrame(result) {
  const bannerResult = result?.results?.banner;

  const startAnim = bannerResult?.animStart;
  const layout = bannerResult?.renderLayout;
  if (!startAnim || !layout) {
    return 0;
  }

  const frameCount = Math.max(1, Math.floor(startAnim.frameSize ?? 1));
  if (frameCount <= 1) {
    return 0;
  }

  const paneAnimationMap = buildPaneAnimationMap(startAnim);
  const getPaneChain = buildPaneChainResolver(layout);

  const candidateFrames = new Set([0, frameCount - 1]);
  const sampleStep = Math.max(1, Math.floor(frameCount / 72));
  for (let frame = 0; frame < frameCount; frame += sampleStep) {
    candidateFrames.add(frame);
  }

  let baselineScore = null;
  let bestFrame = 0;
  let bestResult = { score: Number.NEGATIVE_INFINITY, visibleCount: Number.NEGATIVE_INFINITY };
  const sampledFrameScores = new Map();

  for (const frame of [...candidateFrames].sort((left, right) => left - right)) {
    const frameResult = scoreStartFrame(layout, startAnim, frame, paneAnimationMap, getPaneChain);
    sampledFrameScores.set(frame, frameResult);
    if (frame === 0) {
      baselineScore = frameResult;
    }

    if (
      frameResult.score > bestResult.score ||
      (Math.abs(frameResult.score - bestResult.score) < 1e-6 && frameResult.visibleCount > bestResult.visibleCount)
    ) {
      bestFrame = frame;
      bestResult = frameResult;
    }
  }

  if (!baselineScore || bestFrame <= 0) {
    return 0;
  }

  const baselineVisible = baselineScore.visibleCount;
  const sparseStart =
    baselineVisible <= 12 ||
    (baselineVisible <= 24 && baselineVisible <= bestResult.visibleCount * 0.45);
  const scoreImproved = baselineScore.score <= 0 ? bestResult.score > 0 : bestResult.score >= baselineScore.score * 1.6;
  const visibilityImproved =
    baselineVisible <= 0 ? bestResult.visibleCount >= 8 : bestResult.visibleCount >= baselineVisible * 1.7;

  if (sparseStart && (scoreImproved || visibilityImproved)) {
    // Prefer the first strong reveal frame so users can still watch the intro
    // (e.g. Internet Channel punctuation + staggered letter reveals) instead
    // of jumping to the densest near-end startup frame.
    const minimumVisible = Math.max(8, baselineVisible + 4, Math.ceil(bestResult.visibleCount * 0.45));
    const minimumScore = bestResult.score <= 0 ? 0 : bestResult.score * 0.55;
    const earliestStrongFrame = [...candidateFrames]
      .sort((left, right) => left - right)
      .find((frame) => {
        if (frame <= 0) {
          return false;
        }
        const sample = sampledFrameScores.get(frame);
        return Boolean(sample && sample.visibleCount >= minimumVisible && sample.score >= minimumScore);
      });

    return earliestStrongFrame ?? bestFrame;
  }

  return 0;
}

export function resolveAnimationSelection(targetResult, selectedState, animOverrideId) {
  const explicitState = normalizeRenderState(selectedState);
  if (!targetResult) {
    return {
      anim: null,
      startAnim: null,
      loopAnim: null,
      renderState: explicitState,
      playbackMode: "loop",
    };
  }

  // If a specific animation entry is selected by override, use it directly.
  if (animOverrideId) {
    const entry = targetResult.animEntries?.find((e) => e.id === animOverrideId);
    if (entry?.anim) {
      return {
        anim: entry.anim,
        startAnim: null,
        loopAnim: entry.anim,
        renderState: null,
        playbackMode: "loop",
        renderLayout: entry.renderLayout ?? null,
      };
    }
  }

  const autoState = resolveAutoRenderState(targetResult);
  const activeState = explicitState ?? autoState;
  const stateAnimEntry = findStateAnimationEntry(targetResult, activeState);
  const stateAnim = stateAnimEntry?.anim ?? null;

  if (stateAnim) {
    const startAnim = targetResult?.animStart ?? null;
    if (startAnim) {
      // Start + RSO state: play start first, then loop the state animation.
      return {
        anim: startAnim,
        startAnim,
        loopAnim: stateAnim,
        renderState: activeState ?? null,
        playbackMode: "loop",
      };
    }
    const playbackMode = shouldHoldStateAnimation(targetResult, stateAnim) ? "hold" : "loop";
    return {
      anim: stateAnim,
      startAnim: null,
      loopAnim: stateAnim,
      renderState: activeState ?? null,
      playbackMode,
    };
  }

  if (!explicitState) {
    return {
      anim: targetResult.anim ?? null,
      startAnim: targetResult.animStart ?? null,
      loopAnim: targetResult.animLoop ?? targetResult.anim ?? null,
      renderState: autoState ?? null,
      playbackMode: "loop",
    };
  }

  const selectedAnim = targetResult.animLoop ?? targetResult.animStart ?? targetResult.anim ?? null;

  return {
    anim: selectedAnim,
    startAnim: null,
    loopAnim: selectedAnim,
    renderState: activeState,
    playbackMode: "loop",
  };
}
