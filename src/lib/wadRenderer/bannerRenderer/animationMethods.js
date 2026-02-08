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
  const numeric = Number.isFinite(rawFrame) ? Math.floor(rawFrame) : startFrame;
  return startFrame + ((((numeric - startFrame) % span) + span) % span);
}

export function normalizeFrame(rawFrame) {
  const total = this.getTotalFrames();
  const numeric = Number.isFinite(rawFrame) ? Math.floor(rawFrame) : 0;
  return ((numeric % total) + total) % total;
}

export function applyFrame(rawFrame) {
  if (this.sequenceEnabled && this.phase === "loop") {
    const nextFrame = this.normalizeFrameInRange(rawFrame, this.loopPlaybackStartFrame, this.loopPlaybackEndFrame);
    const loopLength = this.getLoopPlaybackLength();
    this.frame = nextFrame;
    this.renderFrame(this.frame);
    this.onFrame(this.frame - this.loopPlaybackStartFrame, loopLength, this.phase);
    return;
  }

  const total = this.getTotalFrames();
  const nextFrame = this.normalizeFrame(rawFrame);
  this.frame = nextFrame;
  this.renderFrame(this.frame);
  this.onFrame(this.frame, total, this.phase);
}

export function setStartFrame(rawFrame) {
  if (this.sequenceEnabled && this.startAnim) {
    this.setActiveAnim(this.startAnim, "start");
  }
  const normalized = this.normalizeFrame(rawFrame);
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
  if (this.sequenceEnabled || !this.useGsap || this.gsapTimeline) {
    return;
  }

  const total = this.getTotalFrames();
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
    frame: total,
    duration: total / this.fps,
    ease: "none",
  });
}

export function advanceFrame() {
  if (this.sequenceEnabled && this.phase === "start") {
    const startFrames = this.getFrameCountForAnim(this.startAnim);
    const nextStartFrame = this.frame + 1;
    if (nextStartFrame >= startFrames) {
      this.setActiveAnim(this.loopAnim ?? this.startAnim, "loop");
      this.applyFrame(this.loopPlaybackStartFrame);
      return;
    }
    this.applyFrame(nextStartFrame);
    return;
  }

  this.applyFrame(this.frame + 1);
}
