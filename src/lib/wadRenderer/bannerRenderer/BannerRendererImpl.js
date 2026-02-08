import { detectPreferredTitleLocale } from "./locale";
import * as animationMethods from "./animationMethods";
import * as localeMethods from "./localeMethods";
import * as renderMethods from "./renderMethods";
import * as textureMethods from "./textureMethods";

export class BannerRenderer {
  constructor(canvas, layout, anim, tplImages, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.layout = layout;
    this.anim = anim;
    this.tplImages = tplImages;
    this.startAnim = options.startAnim ?? null;
    this.loopAnim = options.loopAnim ?? anim ?? null;
    if (!this.startAnim && !this.loopAnim) {
      this.loopAnim = anim ?? null;
    }
    this.sequenceEnabled = Boolean(this.startAnim && this.loopAnim);
    this.phase = this.sequenceEnabled ? "start" : "loop";
    this.loopPlaybackStartFrame = 0;
    this.loopPlaybackEndFrame = this.getFrameCountForAnim(this.loopAnim);
    if (this.loopPlaybackEndFrame <= this.loopPlaybackStartFrame) {
      this.loopPlaybackEndFrame = this.getFrameCountForAnim(this.loopAnim);
    }

    const requestedInitialFrame = Number.isFinite(options.initialFrame) ? Math.floor(options.initialFrame) : 0;
    this.startFrame = requestedInitialFrame;
    this.frame = requestedInitialFrame;
    this.playing = false;
    this.animationId = null;
    this.lastTime = 0;
    this.fps = options.fps ?? 60;
    this.useGsap = options.useGsap ?? true;
    this.onFrame = options.onFrame ?? (() => {});
    this.gsapTimeline = null;
    this.gsapDriver = { frame: 0 };
    this.patternTextureCache = new Map();
    this.textureMaskCache = new Map();
    this.lumaAlphaTextureCache = new Map();
    this.vertexColorModulationCache = new WeakMap();
    this.materialColorModulationCache = new WeakMap();
    this.paneCompositeSurface = null;
    this.paneCompositeContext = null;

    this.textureCanvases = {};
    this.textureFormats = {};
    this.panesByName = new Map();
    this.paneTransformChains = new Map();
    this.animMapByAnim = new WeakMap();
    this.animByPaneName = new Map();
    this.titleLocalePreference = options.titleLocale ?? detectPreferredTitleLocale();
    this.availableTitleLocales = new Set();
    this.activeTitleLocale = null;

    for (const pane of this.layout?.panes ?? []) {
      if (!this.panesByName.has(pane.name)) {
        this.panesByName.set(pane.name, pane);
      }
    }

    this.availableTitleLocales = this.collectTitleLocales();
    this.activeTitleLocale = this.resolveActiveTitleLocale(this.titleLocalePreference);

    const initialAnim = this.sequenceEnabled ? this.startAnim : (this.loopAnim ?? this.startAnim ?? this.anim);
    this.setActiveAnim(initialAnim, this.phase);

    this.startFrame = this.normalizeFrame(this.startFrame);
    this.frame = this.startFrame;
    this.prepareTextures();
  }
}

Object.assign(
  BannerRenderer.prototype,
  localeMethods,
  animationMethods,
  textureMethods,
  renderMethods,
);
