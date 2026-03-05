/**
 * Renderer Data Bundle Export
 *
 * Exports all parsed WAD data (layout, animations, textures, fonts, audio)
 * as a serializable ZIP bundle. The consuming app imports BannerRenderer
 * and loads this bundle to replay animations on Canvas 2D with GSAP.
 */

import { loadJSZip, imageDataToPngBlob, tplImageToImageData, createWavArrayBuffer } from "@firstform/wii-channel-renderer/export-bundle";
import { collectRenderStateOptions } from "../utils/renderState";

// ---------------------------------------------------------------------------
// Icon viewport helper (duplicated to avoid circular import from utils/)
// ---------------------------------------------------------------------------

function resolveIconViewport(layout) {
  if (!layout?.panes) return null;
  for (const pane of layout.panes) {
    const normalized = pane.name
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .toLowerCase();
    if (normalized.includes("icon") && normalized.includes("bg")) {
      return { width: Math.round(pane.size.w), height: Math.round(pane.size.h) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Build available options metadata for a target (banner or icon)
// ---------------------------------------------------------------------------

function buildTargetOptions(targetResult) {
  if (!targetResult) return null;

  const options = {};

  // Available animations (from animEntries)
  const animEntries = targetResult.animEntries ?? [];
  if (animEntries.length > 0) {
    options.availableAnimations = animEntries.map((entry) => ({
      id: entry.id,
      path: entry.path,
      name: entry.path?.split("/").pop()?.replace(/\.[^.]+$/, "") ?? entry.id,
      frameSize: entry.frameSize ?? 0,
      loops: Boolean(entry.anim?.flags & 1),
      role: entry.role ?? null,
      state: entry.state ?? null,
    }));
  }

  // Available render states (RSO groups)
  const renderStates = collectRenderStateOptions(targetResult);
  if (renderStates.length > 0) {
    options.availableRenderStates = renderStates;
  }

  // Available pane state groups
  const paneStateGroups = collectPaneStateGroups(targetResult);
  if (paneStateGroups.length > 0) {
    options.availablePaneStateGroups = paneStateGroups;
  }

  // Available title locales
  const titleLocales = collectTitleLocales(targetResult);
  if (titleLocales.length > 0) {
    options.availableTitleLocales = titleLocales;
  }

  // Feature detection
  const features = detectFeatures(targetResult);
  if (Object.keys(features).length > 0) {
    options.features = features;
  }

  return Object.keys(options).length > 0 ? options : null;
}

function collectPaneStateGroups(targetResult) {
  const panes = targetResult?.renderLayout?.panes ?? [];
  const groupsByKey = new Map();

  for (const pane of panes) {
    if (pane?.type !== "pan1" && pane?.type !== "bnd1") continue;
    if (Number.isInteger(pane?.materialIndex) && pane.materialIndex >= 0) continue;

    const match = String(pane?.name ?? "").match(/^(.*?)(\d+)$/);
    if (!match) continue;

    const baseName = match[1];
    const index = Number.parseInt(match[2], 10);
    const key = `${pane.parent ?? "__root__"}|${baseName}`;

    let entry = groupsByKey.get(key);
    if (!entry) {
      entry = { parentName: pane.parent ?? null, baseName, options: new Map() };
      groupsByKey.set(key, entry);
    }
    if (!entry.options.has(index)) {
      entry.options.set(index, pane.name);
    }
  }

  const groups = [];
  for (const entry of groupsByKey.values()) {
    if (entry.options.size < 2) continue;
    const options = [...entry.options.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, paneName]) => ({ index, paneName }));
    const parentPart = entry.parentName ?? "__root__";
    const basePart = entry.baseName || "state";
    groups.push({
      id: `${parentPart}::${basePart}`,
      label: entry.parentName ? `${entry.parentName}/${basePart}` : basePart,
      options,
    });
  }

  return groups.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

function collectTitleLocales(targetResult) {
  const LOCALE_CODES = ["JP", "NE", "GE", "SP", "IT", "FR", "US", "KR", "CN"];
  const LOCALE_PATTERN = new RegExp(
    `(?:^|_)(${LOCALE_CODES.join("|")})(?:_|[0-9]|$)`,
  );
  const locales = new Set();

  const tryExtract = (name) => {
    if (!name) return;
    const match = name.match(LOCALE_PATTERN);
    if (match && LOCALE_CODES.includes(match[1])) locales.add(match[1]);
  };

  for (const group of targetResult?.renderLayout?.groups ?? []) {
    tryExtract(group?.name);
  }
  for (const pane of targetResult?.renderLayout?.panes ?? []) {
    tryExtract(pane?.name);
  }

  return [...locales].sort((a, b) => LOCALE_CODES.indexOf(a) - LOCALE_CODES.indexOf(b));
}

function detectFeatures(targetResult) {
  const features = {};
  const paneNames = new Set((targetResult?.renderLayout?.panes ?? []).map((p) => p.name));

  // Disc Channel disc-type panes
  if (paneNames.has("WiiDisk") && paneNames.has("GCDisk") && paneNames.has("DVDDisk")) {
    features.hasDiscType = true;
    features.discTypes = ["auto", "all", "none", "wii", "gc", "dvd"];
  }

  // Disc Channel icon scene (GC icon vs system update)
  if (paneNames.has("N_GCIcon") && paneNames.has("N_DiscUpdateIcon")) {
    features.hasIconScene = true;
    features.iconScenes = [
      { value: "auto", label: "Auto (GC Icon)" },
      { value: "gc", label: "GC Icon" },
      { value: "update", label: "Wii Console Update" },
    ];
  }

  return features;
}

// ---------------------------------------------------------------------------
// Serialize textures (tplImages → PNGs + manifest)
// ---------------------------------------------------------------------------

async function serializeTextures(zip, prefix, tplImages, onProgress) {
  const texturesManifest = {};
  const entries = Object.entries(tplImages);

  for (let i = 0; i < entries.length; i++) {
    const [name, images] = entries[i];
    texturesManifest[name] = [];

    for (let j = 0; j < images.length; j++) {
      const img = images[j];
      if (!img?.imageData) continue;

      const fileName = images.length > 1 ? `${name}_${j}.png` : `${name}.png`;
      const imgData = tplImageToImageData(img);
      const pngBlob = await imageDataToPngBlob(imgData);
      zip.file(`${prefix}/textures/${fileName}`, pngBlob);
      texturesManifest[name].push({
        file: fileName,
        width: img.width,
        height: img.height,
        format: img.format,
      });
    }

    onProgress?.(i + 1, entries.length);
  }

  zip.file(`${prefix}/textures.json`, JSON.stringify(texturesManifest, null, 2));
}

// ---------------------------------------------------------------------------
// Serialize fonts (metadata JSON + glyph sheet PNGs)
// ---------------------------------------------------------------------------

async function serializeFonts(zip, prefix, fonts) {
  if (!fonts) return;

  for (const [fontName, fontData] of Object.entries(fonts)) {
    if (!fontData) continue;

    const fontMeta = {
      fontInfo: fontData.fontInfo ?? null,
      glyphInfo: fontData.glyphInfo ?? null,
      charWidths: fontData.charWidths instanceof Map
        ? Array.from(fontData.charWidths.entries())
        : [],
      charMap: fontData.charMap instanceof Map
        ? Array.from(fontData.charMap.entries())
        : [],
      sheets: [],
    };

    const sheets = fontData.sheets ?? [];
    for (let s = 0; s < sheets.length; s++) {
      const sheet = sheets[s];
      if (!sheet?.imageData) continue;

      const sheetFileName = `${fontName}_sheet_${s}.png`;
      const imgData = new ImageData(
        new Uint8ClampedArray(sheet.imageData.buffer, sheet.imageData.byteOffset, sheet.imageData.byteLength),
        sheet.width,
        sheet.height,
      );
      const pngBlob = await imageDataToPngBlob(imgData);
      zip.file(`${prefix}/fonts/${sheetFileName}`, pngBlob);
      fontMeta.sheets.push({
        file: sheetFileName,
        width: sheet.width,
        height: sheet.height,
      });
    }

    zip.file(`${prefix}/fonts/${fontName}.json`, JSON.stringify(fontMeta));
  }
}

// ---------------------------------------------------------------------------
// README template
// ---------------------------------------------------------------------------

function generateReadme(manifest) {
  const bannerInfo = manifest.banner
    ? `- Banner: ${manifest.banner.width}x${manifest.banner.height}, ${manifest.banner.startFrames + manifest.banner.loopFrames} frames @ ${manifest.banner.fps}fps`
    : "";
  const iconInfo = manifest.icon
    ? `- Icon: ${manifest.icon.width}x${manifest.icon.height}, ${manifest.icon.startFrames + manifest.icon.loopFrames} frames @ ${manifest.icon.fps}fps`
    : "";

  return `# Wii Channel Renderer Bundle

Source: ${manifest.sourceFile ?? "Unknown"}
Title ID: ${manifest.titleId ?? "Unknown"}
${bannerInfo}
${iconInfo}
${manifest.hasAudio ? "- Audio: included (audio.wav)" : ""}

## Usage

This bundle contains all the parsed data needed to render a Wii channel
banner/icon animation using the WeWAD BannerRenderer.

### Setup

1. Install the renderer package and GSAP:
   \`\`\`
   npm install @firstform/wii-channel-renderer gsap
   \`\`\`

2. Load the bundle and create a renderer:

   \`\`\`js
   import { BannerRenderer } from "@firstform/wii-channel-renderer";
   import { loadRendererBundle } from "@firstform/wii-channel-renderer/bundle-loader";

   // Load the bundle ZIP
   const response = await fetch("/assets/my-bundle.zip");
   const bundle = await loadRendererBundle(await response.arrayBuffer());

   // Create a canvas and renderer for the banner
   const canvas = document.getElementById("banner-canvas");
   canvas.width = bundle.manifest.banner.width;
   canvas.height = bundle.manifest.banner.height;

   const { layout, startAnim, loopAnim, tplImages, fonts } = bundle.banner;
   const renderer = new BannerRenderer(canvas, layout, startAnim ?? loopAnim, tplImages, {
     startAnim,
     loopAnim,
     fonts,
     displayAspect: 16 / 9, // or 4/3
     ...bundle.manifest.rendererOptions,
     renderState: bundle.manifest.banner.animSelection.renderState,
     playbackMode: bundle.manifest.banner.animSelection.playbackMode,
   });

   // Start playback (uses GSAP internally if available)
   renderer.play();
   \`\`\`

### React Component Example

\`\`\`jsx
import { useRef, useEffect } from "react";
import { BannerRenderer } from "@firstform/wii-channel-renderer";
import { loadRendererBundle } from "@firstform/wii-channel-renderer/bundle-loader";

function WiiBanner({ bundleUrl, aspectRatio = 4 / 3 }) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const res = await fetch(bundleUrl);
      const bundle = await loadRendererBundle(await res.arrayBuffer());
      if (cancelled) return;

      const { layout, startAnim, loopAnim, tplImages, fonts } = bundle.banner;
      const canvas = canvasRef.current;
      canvas.width = bundle.manifest.banner.width;
      canvas.height = bundle.manifest.banner.height;

      rendererRef.current = new BannerRenderer(
        canvas, layout, startAnim ?? loopAnim, tplImages, {
          startAnim, loopAnim, fonts,
          displayAspect: aspectRatio,
          ...bundle.manifest.rendererOptions,
          renderState: bundle.manifest.banner.animSelection.renderState,
          playbackMode: bundle.manifest.banner.animSelection.playbackMode,
        },
      );
      rendererRef.current.play();
    })();

    return () => {
      cancelled = true;
      rendererRef.current?.dispose();
    };
  }, [bundleUrl, aspectRatio]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "auto" }} />;
}
\`\`\`

### Audio

If \`audio.wav\` is present in the bundle, the manifest includes loop metadata:

\`\`\`js
if (bundle.audioWav) {
  const blob = new Blob([bundle.audioWav], { type: "audio/wav" });
  const audioEl = new Audio(URL.createObjectURL(blob));

  const { loopFlag, loopStart, sampleRate, durationSeconds } = bundle.manifest.audio;
  const loopStartTime = loopFlag ? loopStart / sampleRate : 0;

  // When audio ends (or reaches end), seek back to loop point
  audioEl.addEventListener("ended", () => {
    audioEl.currentTime = loopStartTime;
    audioEl.play().catch(() => {});
  });
  audioEl.addEventListener("timeupdate", () => {
    if (audioEl.currentTime >= durationSeconds - 0.05) {
      audioEl.currentTime = loopStartTime;
    }
  });

  audioEl.play().catch(() => {});
}
\`\`\`

## Bundle Contents

- \`manifest.json\` — Metadata (dimensions, frame counts, fps, renderer options)
- \`banner/layout.json\` — Parsed BRLYT layout
- \`banner/anim-start.json\` — Start animation (BRLAN), if present
- \`banner/anim-loop.json\` — Loop animation (BRLAN)
- \`banner/textures/\` — Decoded texture PNGs + textures.json manifest
- \`banner/fonts/\` — Font metadata + glyph sheet PNGs
- \`icon/\` — Same structure as banner (if icon is present)
- \`audio.wav\` — Channel audio (if present)
`;
}

// ---------------------------------------------------------------------------
// Main export orchestration
// ---------------------------------------------------------------------------

/**
 * Export a renderer data bundle as a ZIP.
 *
 * @param {object} params
 * @param {object} params.parsed - Result from processWAD()
 * @param {string} params.sourceFileName - Original WAD filename
 * @param {object} params.bannerAnimSelection - Banner animation selection
 * @param {object} params.iconAnimSelection - Icon animation selection
 * @param {object} params.rendererOptions - Extra renderer options
 * @param {string} params.exportAspect - Aspect ratio for banner
 * @param {Function} params.onProgress - Progress callback
 * @returns {Promise<Blob>} ZIP blob
 */
export async function exportGsapBundle({
  parsed,
  sourceFileName,
  bannerAnimSelection,
  iconAnimSelection,
  rendererOptions = {},
  exportAspect = "4:3",
  exportAllAnimations = true,
  onProgress,
}) {
  onProgress?.("loading", 0, 1);
  const JSZip = await loadJSZip();
  const zip = new JSZip();

  const manifest = {
    version: "1.0",
    sourceFile: sourceFileName ?? null,
    titleId: parsed.wad?.titleId ?? null,
    hasAudio: false,
    exportAspect,
    rendererOptions: {
      tevQuality: rendererOptions.tevQuality ?? "fast",
      titleLocale: rendererOptions.titleLocale ?? null,
      paneStateSelections: rendererOptions.paneStateSelections ?? {},
    },
  };

  // --- Audio ---
  const audioData = parsed.results?.audio;
  if (audioData) {
    const wavBuffer = createWavArrayBuffer(audioData);
    if (wavBuffer) {
      zip.file("audio.wav", wavBuffer);
      manifest.hasAudio = true;
      manifest.audio = {
        sampleRate: audioData.sampleRate,
        channelCount: audioData.channelCount ?? audioData.pcm16?.length ?? 1,
        sampleCount: audioData.sampleCount ?? 0,
        loopFlag: Boolean(audioData.loopFlag),
        loopStart: audioData.loopStart ?? 0,
        durationSeconds: audioData.durationSeconds ?? 0,
      };
    }
  }

  // --- Banner ---
  const bannerResult = parsed.results?.banner;
  if (bannerResult && bannerAnimSelection?.anim) {
    onProgress?.("banner-textures", 0, 1);
    await serializeTarget(zip, "banner", bannerResult, bannerAnimSelection, null, exportAllAnimations, (current, total) =>
      onProgress?.("banner-textures", current, total),
    );

    const startAnim = bannerAnimSelection.startAnim ?? null;
    const loopAnim = bannerAnimSelection.loopAnim ?? bannerAnimSelection.anim;
    manifest.banner = {
      width: bannerResult.renderLayout?.width ?? 608,
      height: bannerResult.renderLayout?.height ?? 456,
      fps: 60,
      startFrames: startAnim?.frameSize ?? 0,
      loopFrames: loopAnim?.frameSize ?? 120,
      animSelection: {
        renderState: bannerAnimSelection.renderState ?? null,
        playbackMode: bannerAnimSelection.playbackMode ?? "loop",
      },
    };

    const bannerOptions = buildTargetOptions(bannerResult);
    if (bannerOptions) {
      manifest.banner.options = bannerOptions;
    }
  }

  // --- Icon ---
  const iconResult = parsed.results?.icon;
  if (iconResult && iconAnimSelection?.anim) {
    onProgress?.("icon-textures", 0, 1);
    const iconViewport = resolveIconViewport(iconResult.renderLayout);
    await serializeTarget(zip, "icon", iconResult, iconAnimSelection, iconViewport, exportAllAnimations, (current, total) =>
      onProgress?.("icon-textures", current, total),
    );

    const startAnim = iconAnimSelection.startAnim ?? null;
    const loopAnim = iconAnimSelection.loopAnim ?? iconAnimSelection.anim;
    manifest.icon = {
      width: iconViewport?.width ?? iconResult.renderLayout?.width ?? 128,
      height: iconViewport?.height ?? iconResult.renderLayout?.height ?? 128,
      fps: 60,
      startFrames: startAnim?.frameSize ?? 0,
      loopFrames: loopAnim?.frameSize ?? 120,
      animSelection: {
        renderState: iconAnimSelection.renderState ?? null,
        playbackMode: iconAnimSelection.playbackMode ?? "loop",
      },
    };

    const iconOptions = buildTargetOptions(iconResult);
    if (iconOptions) {
      manifest.icon.options = iconOptions;
    }
  }

  // --- Manifest ---
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  // --- README ---
  zip.file("README.md", generateReadme(manifest));

  // --- Compress ---
  onProgress?.("compressing", 0, 1);
  const zipBlob = await zip.generateAsync({ type: "blob" });
  onProgress?.("done", 1, 1);
  return zipBlob;
}

// ---------------------------------------------------------------------------
// Serialize a single target (banner or icon)
// ---------------------------------------------------------------------------

async function serializeTarget(zip, prefix, result, animSelection, iconViewport, includeAllAnims, onTextureProgress) {
  // For icons, override layout dimensions to the icon viewport (128x96),
  // matching how the main app clones the layout with viewport dimensions.
  // The BannerRenderer uses layout.width/height to size its rendering area.
  const layout = iconViewport
    ? { ...result.renderLayout, width: iconViewport.width, height: iconViewport.height }
    : result.renderLayout;

  // Layout JSON
  zip.file(`${prefix}/layout.json`, JSON.stringify(layout, null, 2));

  // Animation JSONs
  const startAnim = animSelection.startAnim ?? null;
  const loopAnim = animSelection.loopAnim ?? animSelection.anim;

  if (startAnim) {
    zip.file(`${prefix}/anim-start.json`, JSON.stringify(startAnim));
  }
  if (loopAnim) {
    zip.file(`${prefix}/anim-loop.json`, JSON.stringify(loopAnim));
  }

  // Textures
  if (result.tplImages) {
    await serializeTextures(zip, prefix, result.tplImages, onTextureProgress);
  }

  // Fonts
  if (result.fonts) {
    await serializeFonts(zip, prefix, result.fonts);
  }

  // All animation entries (for multi-animation bundles)
  if (includeAllAnims && result.animEntries?.length > 0) {
    const entriesMeta = result.animEntries.map((entry, i) => ({
      id: entry.id,
      path: entry.path,
      role: entry.role ?? null,
      state: entry.state ?? null,
      frameSize: entry.frameSize ?? 0,
      paneCount: entry.paneCount ?? 0,
      flags: entry.anim?.flags ?? 0,
      hasLayout: Boolean(entry.renderLayout || entry.layout),
    }));
    zip.file(`${prefix}/anim-entries.json`, JSON.stringify(entriesMeta));

    for (let i = 0; i < result.animEntries.length; i++) {
      const entry = result.animEntries[i];
      if (entry.anim) {
        zip.file(`${prefix}/anims/${i}.json`, JSON.stringify(entry.anim));
      }
      const entryLayout = entry.renderLayout || entry.layout;
      if (entryLayout) {
        zip.file(`${prefix}/anims/${i}-layout.json`, JSON.stringify(entryLayout));
      }
    }
  }
}
