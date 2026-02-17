import { gsap } from "gsap";
import { mergePaneAnimations } from "../animations";

export function buildAnimPaneMap(anim) {
  const paneMap = new Map();
  const mergedPaneAnimations = mergePaneAnimations(anim?.panes ?? []);
  for (const paneAnim of mergedPaneAnimations) {
    if (!paneMap.has(paneAnim.name)) {
      paneMap.set(paneAnim.name, paneAnim);
    }
  }
  return paneMap;
}

export function getAnimPaneMap(anim) {
  if (!anim) {
    return new Map();
  }
  const cached = this.animMapByAnim.get(anim);
  if (cached) {
    return cached;
  }
  const paneMap = this.buildAnimPaneMap(anim);
  this.animMapByAnim.set(anim, paneMap);
  return paneMap;
}

export function setActiveAnim(anim, phase = this.phase) {
  this.anim = anim ?? this.loopAnim ?? this.startAnim ?? null;
  this.phase = phase;
  this.animByPaneName = this.getAnimPaneMap(this.anim);
  this.textureSrtAnimationCache.clear();
}

export function captureStartEndState() {
  this.frozenStartState.clear();
  if (!this.startAnim) return;

  const startFrames = this.getFrameCountForAnim(this.startAnim);
  const finalFrame = Math.max(0, startFrames - 1);

  const startPaneMap = this.getAnimPaneMap(this.startAnim);
  for (const [paneName] of startPaneMap) {
    this.frozenStartState.set(paneName, {
      animValues: this.getAnimValues(paneName, finalFrame),
      matColor: this.getPaneMaterialAnimColor(paneName, finalFrame),
      texSrt: this.getPaneTextureSRTAnimations(paneName, finalFrame),
    });
  }
}

export function getFrameCountForAnim(anim) {
  return Math.max(1, anim?.frameSize || 120);
}

export function getTotalFrames() {
  return this.getFrameCountForAnim(this.anim);
}

export function getLoopPlaybackLength() {
  return Math.max(1, this.loopPlaybackEndFrame - this.loopPlaybackStartFrame);
}

export function normalizeFrameInRange(rawFrame, startFrame, endFrame) {
  const span = Math.max(1, endFrame - startFrame);
  const numeric = Number.isFinite(rawFrame) ? rawFrame : startFrame;
  return startFrame + ((((numeric - startFrame) % span) + span) % span);
}

export function normalizeFrame(rawFrame) {
  const total = this.getTotalFrames();
  const numeric = Number.isFinite(rawFrame) ? rawFrame : 0;
  return ((numeric % total) + total) % total;
}

export function normalizeFrameForPlayback(rawFrame) {
  if (this.playbackMode === "hold") {
    const total = this.getTotalFrames();
    const numeric = Number.isFinite(rawFrame) ? rawFrame : 0;
    return Math.max(0, Math.min(total - 1, numeric));
  }

  return this.normalizeFrame(rawFrame);
}

export function applyFrame(rawFrame) {
  if (this.sequenceEnabled && this.phase === "loop") {
    const nextFrame = this.normalizeFrameInRange(rawFrame, this.loopPlaybackStartFrame, this.loopPlaybackEndFrame);
    const loopLength = this.getLoopPlaybackLength();
    this.frame = nextFrame;
    this.renderFrame(this.frame);
    const globalFrame = this.startFrameCount + Math.max(0, this.frame - this.loopPlaybackStartFrame);
    this.onFrame(Math.max(0, this.frame - this.loopPlaybackStartFrame), loopLength, this.phase, globalFrame, this.audioFrame);
    return;
  }

  const total = this.getTotalFrames();
  const nextFrame = this.normalizeFrameForPlayback(rawFrame);
  this.frame = nextFrame;
  this.renderFrame(this.frame);
  this.onFrame(this.frame, total, this.phase, this.frame, this.audioFrame);
}

export function setStartFrame(rawFrame) {
  if (this.sequenceEnabled && this.startAnim) {
    this.setActiveAnim(this.startAnim, "start");
  }
  const normalized = this.normalizeFrameForPlayback(rawFrame);
  this.startFrame = normalized;
  this.stop();
  if (this.gsapTimeline) {
    this.gsapTimeline.kill();
    this.gsapTimeline = null;
  }
  this.gsapDriver.frame = normalized;
  this.applyFrame(normalized);
}

export function ensureGsapTimeline() {
  if (this.sequenceEnabled || !this.useGsap || this.playbackMode === "hold" || this.gsapTimeline) {
    return;
  }

  const total = this.getTotalFrames();
  const duration = Math.max(1e-3, total / this.fps);
  const targetFrame = this.subframePlayback ? Math.max(0, total - 1e-4) : Math.max(0, total - 1);
  this.gsapDriver.frame = this.frame;

  this.gsapTimeline = gsap.timeline({
    paused: true,
    repeat: -1,
    defaults: { ease: "none" },
    onUpdate: () => {
      this.applyFrame(this.gsapDriver.frame);
    },
  });

  this.gsapTimeline.to(this.gsapDriver, {
    frame: targetFrame,
    duration,
    ease: "none",
  });
}

export function seekToFrame(globalFrame) {
  const wasPlaying = this.playing;
  if (this.playing) {
    this.stop();
  }
  if (this.gsapTimeline) {
    this.gsapTimeline.kill();
    this.gsapTimeline = null;
  }

  const clamped = Math.max(0, Number.isFinite(globalFrame) ? globalFrame : 0);
  this.audioFrame = clamped;

  if (this.sequenceEnabled && this.startAnim) {
    const startFrames = this.startFrameCount;
    if (clamped < startFrames) {
      if (this.phase !== "start") {
        this.setActiveAnim(this.startAnim, "start");
        this.frozenStartState.clear();
      }
      this.frame = clamped;
      this.gsapDriver.frame = clamped;
      this.applyFrame(clamped);
      if (wasPlaying) this.play();
      return;
    }
    if (this.phase !== "loop") {
      this.captureStartEndState();
      this.setActiveAnim(this.loopAnim, "loop");
    }
    const loopLocalFrame = this.loopPlaybackStartFrame +
      ((clamped - startFrames) % this.getLoopPlaybackLength());
    this.frame = loopLocalFrame;
    this.gsapDriver.frame = loopLocalFrame;
    this.applyFrame(loopLocalFrame);
    if (wasPlaying) this.play();
    return;
  }

  const normalized = this.normalizeFrameForPlayback(clamped);
  this.frame = normalized;
  this.gsapDriver.frame = normalized;
  this.applyFrame(normalized);
  if (wasPlaying) this.play();
}

export function advanceFrame(deltaMs = 1000 / this.fps) {
  const frameDelta = this.subframePlayback ? Math.max(0, (deltaMs * this.fps) / 1000) : 1;
  this.audioFrame += frameDelta;

  if (this.sequenceEnabled && this.phase === "start") {
    const startFrames = this.getFrameCountForAnim(this.startAnim);
    const nextStartFrame = this.frame + frameDelta;
    if (nextStartFrame >= startFrames) {
      if (this.loopAnim) {
        this.captureStartEndState();
        this.setActiveAnim(this.loopAnim, "loop");
        this.applyFrame(this.loopPlaybackStartFrame);
      } else {
        this.applyFrame(Math.max(0, startFrames - 1));
        this.stop();
      }
      return;
    }
    this.applyFrame(nextStartFrame);
    return;
  }

  if (this.playbackMode === "hold") {
    const total = this.getTotalFrames();
    if (total <= 1) {
      this.applyFrame(0);
      this.stop();
      return;
    }

    const nextFrame = Math.min(total - 1, this.frame + frameDelta);
    this.applyFrame(nextFrame);
    if (nextFrame >= total - 1) {
      this.stop();
    }
    return;
  }

  this.applyFrame(this.frame + frameDelta);
}
