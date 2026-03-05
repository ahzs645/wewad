/**
 * Bundle Renderer — High-level helper that creates a fully configured
 * BannerRenderer from a loaded bundle + settings JSON.
 *
 * Usage:
 *   import { loadRendererBundle } from '@firstform/wii-channel-renderer/bundle-loader';
 *   import { createRendererFromBundle } from '@firstform/wii-channel-renderer/bundle-renderer';
 *
 *   const bundle = await loadRendererBundle(zipArrayBuffer);
 *   const renderer = createRendererFromBundle(canvas, bundle, 'icon', {
 *     animOverride: 'arc/anim/my_DiskCh_b.brlan',
 *     scene: 'gc',
 *     displayAspect: '4:3',
 *   });
 *   renderer.play();
 */

import { BannerRenderer } from "./wadRenderer/BannerRenderer.js";

// ---------------------------------------------------------------------------
// Icon viewport helper
// ---------------------------------------------------------------------------

function resolveIconViewport(layout) {
  if (!layout?.panes) return { width: 128, height: 96 };

  const picturePanes = layout.panes.filter((pane) => pane.type === "pic1");

  const camelToSnake = (name) => name.replace(/([a-z])([A-Z])/g, "$1_$2");
  const explicitViewportPane =
    picturePanes.find((pane) => /^ch\d+$/i.test(pane.name)) ??
    picturePanes.find((pane) =>
      /(?:^|_)(?:tv|icon|cork|frame|bg|back|base|board)(?:_|$)/i.test(camelToSnake(pane.name)),
    );

  const fallbackViewportPane = picturePanes
    .filter((pane) => pane.visible !== false)
    .filter((pane) => (pane.alpha ?? 255) > 0)
    .filter((pane) => Math.abs(pane.size?.w ?? 0) >= 64 && Math.abs(pane.size?.h ?? 0) >= 32)
    .sort((a, b) => {
      const aArea = Math.abs(a.size?.w ?? 0) * Math.abs(a.size?.h ?? 0);
      const bArea = Math.abs(b.size?.w ?? 0) * Math.abs(b.size?.h ?? 0);
      return bArea - aArea;
    })[0];

  const iconPane = explicitViewportPane ?? fallbackViewportPane;
  if (!iconPane) return { width: 128, height: 96 };

  return {
    width: Math.max(1, Math.round(Math.abs(iconPane.size?.w ?? 128))),
    height: Math.max(1, Math.round(Math.abs(iconPane.size?.h ?? 96))),
  };
}

// ---------------------------------------------------------------------------
// Layout feature detection
// ---------------------------------------------------------------------------

function getPaneNames(layout) {
  return new Set((layout?.panes ?? []).map((p) => p.name));
}

function isDiscChannelBannerLayout(layout) {
  const names = getPaneNames(layout);
  return names.has("WiiDisk") && names.has("GCDisk") && names.has("DVDDisk");
}

function hasIconScenePanes(layout) {
  const names = getPaneNames(layout);
  return names.has("N_GCIcon") && names.has("N_DiscUpdateIcon");
}

// ---------------------------------------------------------------------------
// Disc Channel banner — pane visibility overrides
// ---------------------------------------------------------------------------

const DISC_JUNK_PANES = [
  "BackMask2", "W_DVD", "W_Wii", "W_GC",
];

const DISC_HIDE_UNKNOWN = [
  "N_Unknown", "UnknownDisk", "ShadeWii_00",
  "N_Ref0_00", "N_RefUnknown", "RefUnknown",
];

function buildDiscTypeOverrides(discType) {
  const overrides = new Map();
  for (const k of DISC_JUNK_PANES) overrides.set(k, false);

  if (!discType || discType === "auto") {
    for (const k of DISC_HIDE_UNKNOWN) overrides.set(k, false);
    return overrides;
  }

  if (discType === "all") {
    overrides.set("N_DVD0", true);
    for (const k of DISC_HIDE_UNKNOWN) overrides.set(k, false);
    return overrides;
  }

  if (discType === "none") {
    for (const k of ["N_DVD0", "N_Wii0", "N_GC0", "N_Shade0", "N_Ref0", "N_Unknown", "N_Ref0_00", "ShadeWii_00"]) {
      overrides.set(k, false);
    }
    return overrides;
  }

  const wii = discType === "wii";
  const gc = discType === "gc";
  const dvd = discType === "dvd";

  overrides.set("N_DVD0", dvd); overrides.set("DVDDisk", dvd);
  overrides.set("N_Wii0", wii); overrides.set("WiiDisk", wii);
  overrides.set("N_GC0", gc); overrides.set("GCDisk", gc);
  overrides.set("SahdeDVD", dvd); overrides.set("ShadeWii", wii); overrides.set("ShadeGC", gc);
  overrides.set("N_RefDVD", dvd); overrides.set("RefDVD", dvd);
  overrides.set("N_RefWii", wii); overrides.set("RefWii", wii);
  overrides.set("N_RefGC", gc); overrides.set("RefGC", gc);
  for (const k of DISC_HIDE_UNKNOWN) overrides.set(k, false);

  return overrides;
}

const DISC_ALPHA_MASK_PANES = new Set(["RefDVD", "RefWii", "RefGC", "RefUnknown"]);

const DISC_CHANNEL_STRINGS = {
  US: { title: "Disc Channel", insert: "Please insert a disc." },
  JP: { title: "ディスクドライブチャンネル", insert: "ディスクを挿入してください。" },
  FR: { title: "Chaîne disques", insert: "Veuillez insérer un disque." },
  GE: { title: "Disc-Kanal", insert: "Bitte schiebe eine Disc ein." },
  IT: { title: "Canale Disco", insert: "Inserisci un disco." },
  NE: { title: "Diskkanaal", insert: "Voer een disk in." },
  SP: { title: "Canal Disco", insert: "Inserta un disco en la consola." },
};

function buildDiscTextOverrides(locale) {
  const key = locale && locale !== "auto" ? locale : "US";
  const strings = DISC_CHANNEL_STRINGS[key] ?? DISC_CHANNEL_STRINGS.US;
  return { T_Bar: strings.title, T_Comment0: strings.insert, T_Comment1: "" };
}

// ---------------------------------------------------------------------------
// Disc Channel icon — scene visibility overrides
// ---------------------------------------------------------------------------

function buildIconSceneOverrides(scene) {
  if (scene === "update") return new Map([["N_GCIcon", false]]);
  return new Map([["N_DiscUpdateIcon", false]]);
}

// ---------------------------------------------------------------------------
// Animation override resolution
// ---------------------------------------------------------------------------

function resolveAnimFromEntries(data, animOverrideId) {
  if (!animOverrideId) {
    return { startAnim: data.startAnim, loopAnim: data.loopAnim, playbackMode: null, renderLayout: null };
  }
  const entry = (data.animEntries ?? []).find((e) => e.id === animOverrideId);
  if (!entry?.anim) {
    return { startAnim: data.startAnim, loopAnim: data.loopAnim, playbackMode: null, renderLayout: null };
  }
  const loops = (entry.anim.flags & 1) !== 0;
  return {
    startAnim: null,
    loopAnim: entry.anim,
    playbackMode: loops ? "loop" : "once",
    renderLayout: entry.renderLayout ?? null,
  };
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Create a BannerRenderer from a loaded bundle with settings overrides.
 *
 * @param {HTMLCanvasElement} canvas - Target canvas element
 * @param {object} bundle - Result from loadRendererBundle()
 * @param {string} target - "banner" or "icon"
 * @param {object} [settings] - Renderer settings (from the wewad settings JSON)
 * @param {string} [settings.animOverride] - Animation entry ID to use instead of default
 * @param {string} [settings.discType] - Disc type: "auto"|"all"|"none"|"wii"|"gc"|"dvd"
 * @param {string} [settings.scene] - Icon scene: "auto"|"gc"|"update"
 * @param {string} [settings.displayAspect] - Display aspect ratio
 * @param {string} [settings.tevQuality] - TEV quality: "fast"|"accurate"
 * @param {string} [settings.renderState] - Render state override (e.g. "RSO0")
 * @param {string} [settings.playbackMode] - Playback mode: "loop"|"hold"|"once"
 * @param {string} [settings.titleLocale] - Title locale code (e.g. "US", "JP")
 * @param {object} [settings.paneStateSelections] - Pane state group selections
 * @param {number} [settings.fps] - Frames per second
 * @param {boolean} [settings.useGsap] - Whether to use GSAP (default false)
 * @returns {{ renderer: BannerRenderer, layout: object, meta: object }}
 */
export function createRendererFromBundle(canvas, bundle, target, settings = {}) {
  const data = bundle[target];
  if (!data) {
    throw new Error(`No "${target}" data in bundle`);
  }

  const meta = bundle.manifest?.[target];
  if (!meta) {
    throw new Error(`No "${target}" manifest in bundle`);
  }

  const { layout: rawLayout, tplImages, fonts } = data;

  // Resolve animation
  const resolved = resolveAnimFromEntries(data, settings.animOverride);
  const { startAnim, loopAnim } = resolved;

  // Use the animation entry's layout if it has one, otherwise the main layout
  const baseLayout = resolved.renderLayout ?? rawLayout;

  // Resolve layout & aspect for icon targets
  let layout = baseLayout;
  let refAspect = undefined;
  if (target === "icon") {
    const viewport = resolveIconViewport(baseLayout);
    layout = { ...baseLayout, width: viewport.width, height: viewport.height };
    refAspect = viewport.width / viewport.height;
  }

  canvas.width = layout.width ?? meta.width;
  canvas.height = layout.height ?? meta.height;

  // Build feature-specific overrides
  let paneVisibilityOverrides = null;
  let paneAlphaMaskFromFirstTexture = null;
  let textOverrides = null;

  if (target === "banner" && isDiscChannelBannerLayout(layout)) {
    paneVisibilityOverrides = buildDiscTypeOverrides(settings.discType ?? "auto");
    paneAlphaMaskFromFirstTexture = DISC_ALPHA_MASK_PANES;
    textOverrides = buildDiscTextOverrides(settings.titleLocale);
  }

  if (target === "icon" && hasIconScenePanes(layout)) {
    paneVisibilityOverrides = buildIconSceneOverrides(settings.scene ?? "auto");
  }

  const renderer = new BannerRenderer(
    canvas,
    layout,
    startAnim ?? loopAnim,
    tplImages,
    {
      startAnim,
      loopAnim,
      fonts,
      displayAspect: settings.displayAspect ?? "4:3",
      referenceAspectRatio: refAspect,
      fps: settings.fps ?? 30,
      useGsap: settings.useGsap ?? false,
      ...bundle.manifest.rendererOptions,
      renderState: settings.renderState ?? meta.animSelection?.renderState ?? null,
      playbackMode: resolved.playbackMode ?? settings.playbackMode ?? meta.animSelection?.playbackMode ?? "loop",
      tevQuality: settings.tevQuality ?? undefined,
      titleLocale: settings.titleLocale ?? undefined,
      paneStateSelections: settings.paneStateSelections ?? undefined,
      paneVisibilityOverrides,
      paneAlphaMaskFromFirstTexture,
      textOverrides,
    },
  );

  return { renderer, layout, meta };
}
