import { detectPreferredTitleLocale } from "./locale";
import * as animationMethods from "./animationMethods";
import * as customWeatherMethods from "./customWeatherMethods";
import * as localeMethods from "./localeMethods";
import * as transformMethods from "./transformMethods";
import * as paneAnimValues from "./paneAnimValues";
import * as paneStateMethods from "./paneStateMethods";
import * as colorModulationMethods from "./colorModulationMethods";
import * as lumaEffectMethods from "./lumaEffectMethods";
import * as textureDrawMethods from "./textureDrawMethods";
import * as paneDrawMethods from "./paneDrawMethods";
import * as playbackMethods from "./playbackMethods";
import * as stateMethods from "./stateMethods";
import * as textureMethods from "./textureMethods";

const DEFAULT_REFERENCE_ASPECT = 4 / 3;

function parseAspectRatio(value) {
  if (value == null) {
    return null;
  }

  if (Number.isFinite(value)) {
    return value > 0 ? value : null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === "native" || normalized === "layout" || normalized === "auto" || normalized === "off") {
    return null;
  }

  if (normalized === "4:3" || normalized === "4/3" || normalized === "standard") {
    return 4 / 3;
  }
  if (normalized === "16:9" || normalized === "16/9" || normalized === "widescreen" || normalized === "wide") {
    return 16 / 9;
  }
  if (normalized === "16:10" || normalized === "16/10") {
    return 16 / 10;
  }

  const parts = normalized.match(/^([0-9]*\.?[0-9]+)\s*[:/]\s*([0-9]*\.?[0-9]+)$/);
  if (parts) {
    const left = Number.parseFloat(parts[1]);
    const right = Number.parseFloat(parts[2]);
    if (Number.isFinite(left) && Number.isFinite(right) && right > 0) {
      return left / right;
    }
    return null;
  }

  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizePositiveAspect(value, fallback = null) {
  if (Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

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
    const requestedFps = Number.isFinite(options.fps) ? options.fps : 60;
    this.fps = Math.max(1, Math.min(240, requestedFps));
    this.playbackMode = options.playbackMode === "hold" ? "hold" : "loop";
    this.useGsap = options.useGsap ?? true;
    this.onFrame = options.onFrame ?? (() => {});
    this.subframePlayback = options.subframePlayback !== false;
    this.gsapTimeline = null;
    this.gsapDriver = { frame: 0 };
    this.patternTextureCache = new Map();
    this.patternTextureCacheLimit = Number.isFinite(options.patternTextureCacheLimit)
      ? Math.max(64, Math.floor(options.patternTextureCacheLimit))
      : 512;
    this.textureMaskCache = new Map();
    this.lumaAlphaTextureCache = new Map();
    this.vertexColorModulationCache = new WeakMap();
    this.materialColorModulationCache = new WeakMap();
    this.textureSrtAnimationCache = new Map();
    this.paneCompositeSurface = null;
    this.paneCompositeContext = null;
    this.modulationScratchSurface = null;
    this.modulationScratchContext = null;

    this.textureCanvases = {};
    this.textureFormats = {};
    this.panesByName = new Map();
    this.paneTransformChains = new Map();
    this.paneGroupNames = new Map();
    this.animMapByAnim = new WeakMap();
    this.animByPaneName = new Map();
    this.titleLocalePreference = options.titleLocale ?? detectPreferredTitleLocale();
    this.availableTitleLocales = new Set();
    this.activeTitleLocale = null;
    this.availableRenderStates = new Set();
    this.activeRenderState = null;
    this.availablePaneStateGroups = [];
    this.activePaneStateSelections = {};
    this.paneStateMembershipByPaneName = new Map();
    this.customWeather = options.customWeather ?? null;
    this.customWeatherIconPaneSet = null;
    this.referenceAspectRatio = normalizePositiveAspect(
      parseAspectRatio(options.referenceAspectRatio),
      DEFAULT_REFERENCE_ASPECT,
    );
    this.displayAspectRatio = normalizePositiveAspect(
      parseAspectRatio(options.displayAspectRatio ?? options.displayAspect),
      null,
    );
    this.perspectiveEnabled = options.perspectiveEnabled === true;
    this.perspectiveDistance = Number.isFinite(options.perspectiveDistance)
      ? Math.max(64, options.perspectiveDistance)
      : Math.max(256, Math.max(layout?.width ?? 608, layout?.height ?? 456) * 2);
    this.rotationOrder = String(options.rotationOrder ?? "RZ_RY_RX")
      .trim()
      .toUpperCase();

    for (const pane of this.layout?.panes ?? []) {
      if (!this.panesByName.has(pane.name)) {
        this.panesByName.set(pane.name, pane);
      }
    }

    for (const group of this.layout?.groups ?? []) {
      for (const paneName of group?.paneNames ?? []) {
        if (!paneName) {
          continue;
        }
        let groups = this.paneGroupNames.get(paneName);
        if (!groups) {
          groups = new Set();
          this.paneGroupNames.set(paneName, groups);
        }
        groups.add(group.name);
      }
    }

    this.availableTitleLocales = this.collectTitleLocales();
    this.activeTitleLocale = this.resolveActiveTitleLocale(this.titleLocalePreference);
    this.availableRenderStates = this.collectRenderStates();
    this.activeRenderState = this.resolveActiveRenderState(options.renderState ?? null);
    this.availablePaneStateGroups = this.collectPaneStateGroups();
    this.activePaneStateSelections = this.resolvePaneStateSelections(options.paneStateSelections ?? null);
    this.customWeatherIconPaneSet = this.resolveCustomWeatherIconPaneSet();

    for (const group of this.availablePaneStateGroups) {
      for (const option of group.options) {
        let memberships = this.paneStateMembershipByPaneName.get(option.paneName);
        if (!memberships) {
          memberships = [];
          this.paneStateMembershipByPaneName.set(option.paneName, memberships);
        }
        memberships.push({
          groupId: group.id,
          index: option.index,
        });
      }
    }

    const initialAnim = this.sequenceEnabled ? this.startAnim : (this.loopAnim ?? this.startAnim ?? this.anim);
    this.setActiveAnim(initialAnim, this.phase);

    this.startFrame = this.normalizeFrameForPlayback(this.startFrame);
    this.frame = this.startFrame;
    this.prepareTextures();
  }
}

Object.assign(
  BannerRenderer.prototype,
  localeMethods,
  animationMethods,
  textureMethods,
  stateMethods,
  customWeatherMethods,
  transformMethods,
  paneAnimValues,
  paneStateMethods,
  colorModulationMethods,
  lumaEffectMethods,
  textureDrawMethods,
  paneDrawMethods,
  playbackMethods,
);
