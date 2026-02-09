export function render() {
  this.applyFrame(this.frame);
}

export function play() {
  if (this.playing) {
    return;
  }

  this.playing = true;

  if (this.useGsap && !this.sequenceEnabled) {
    this.ensureGsapTimeline();
    if (this.gsapTimeline) {
      this.gsapTimeline.play();
      return;
    }
  }

  this.lastTime = performance.now();

  const tick = (now) => {
    if (!this.playing) {
      return;
    }

    const delta = Math.max(0, now - this.lastTime);
    if (this.subframePlayback) {
      this.lastTime = now;
      this.advanceFrame(delta);
    } else {
      const frameDuration = 1000 / this.fps;
      if (delta >= frameDuration) {
        const steps = Math.min(8, Math.floor(delta / frameDuration));
        this.lastTime += steps * frameDuration;
        for (let i = 0; i < steps; i += 1) {
          this.advanceFrame(frameDuration);
        }
      }
    }

    this.animationId = requestAnimationFrame(tick);
  };

  this.animationId = requestAnimationFrame(tick);
}

export function stop() {
  this.playing = false;
  if (this.gsapTimeline) {
    this.gsapTimeline.pause();
  }
  if (this.animationId) {
    cancelAnimationFrame(this.animationId);
    this.animationId = null;
  }
}

export function reset() {
  if (this.sequenceEnabled && this.startAnim) {
    this.setActiveAnim(this.startAnim, "start");
  }
  this.frame = this.normalizeFrameForPlayback(this.startFrame);
  this.gsapDriver.frame = this.frame;
  if (this.gsapTimeline) {
    this.gsapTimeline.pause(0);
  }
  this.applyFrame(this.frame);
}

export function dispose() {
  this.stop();
  if (this.gsapTimeline) {
    this.gsapTimeline.kill();
    this.gsapTimeline = null;
  }
  this.patternTextureCache.clear();
  this.textureMaskCache.clear();
  this.lumaAlphaTextureCache.clear();
  this.textureSrtAnimationCache.clear();
  this.materialColorModulationCache = new WeakMap();
  this.vertexColorModulationCache = new WeakMap();
  this.paneCompositeSurface = null;
  this.paneCompositeContext = null;
  this.modulationScratchSurface = null;
  this.modulationScratchContext = null;
}
