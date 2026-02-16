/**
 * Export WAD banner/icon assets as a downloadable zip bundle.
 *
 * Uses JSZip (loaded from CDN on demand) to create a zip containing:
 * - manifest.json (metadata + animation info)
 * - banner.png / icon.png (snapshots at current aspect)
 * - banner-4x3.png / banner-16x9.png (both aspect ratio snapshots)
 * - textures/banner/*.png and textures/icon/*.png
 * - audio.wav (if available)
 * - banner-frames/*.png and icon-frames/*.png (optional, all animation frames)
 */

let jsZipPromise = null;

function loadJSZip() {
  if (jsZipPromise) return jsZipPromise;
  jsZipPromise = import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm").then(
    (mod) => mod.default ?? mod,
  );
  return jsZipPromise;
}

export { loadJSZip };

function canvasToBlob(canvas, type = "image/png") {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type);
  });
}

function imageDataToPngBlob(imageData) {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

function tplImageToImageData(image) {
  return new ImageData(
    new Uint8ClampedArray(image.imageData.buffer, image.imageData.byteOffset, image.imageData.byteLength),
    image.width,
    image.height,
  );
}

/**
 * Compute the output pixel dimensions for a given layout + aspect ratio.
 * The renderer applies displayScaleX = displayAspect / referenceAspect (4/3)
 * to horizontally stretch/compress the native layout into the target aspect.
 */
function computeOutputSize(layoutWidth, layoutHeight, displayAspect) {
  const referenceAspect = 4 / 3;
  const scaleX = displayAspect ? displayAspect / referenceAspect : 1;
  return {
    width: Math.round(layoutWidth * scaleX),
    height: layoutHeight,
  };
}

function buildManifest(parsed, sourceFileName, options) {
  const { wad, results } = parsed;
  const manifest = {
    version: "1.0.0",
    titleId: wad.titleId ?? null,
    sourceFile: sourceFileName ?? null,
    exportAspect: options.exportAspect ?? "4:3",
  };

  for (const target of ["banner", "icon"]) {
    const result = results[target];
    if (!result) {
      manifest[target] = null;
      continue;
    }

    const layout = result.renderLayout ?? result.layout;
    const startAnim = result.animStart;
    const loopAnim = result.animLoop ?? result.anim;
    const startFrames = startAnim?.frameSize ?? null;
    const loopFrames = loopAnim?.frameSize ?? 120;
    const totalFrames = (startFrames ?? 0) + loopFrames;

    const nativeW = layout?.width ?? (target === "banner" ? 608 : 128);
    const nativeH = layout?.height ?? (target === "banner" ? 456 : 128);

    const out43 = target === "banner" ? computeOutputSize(nativeW, nativeH, 4 / 3) : { width: nativeW, height: nativeH };
    const out169 = target === "banner" ? computeOutputSize(nativeW, nativeH, 16 / 9) : { width: nativeW, height: nativeH };

    manifest[target] = {
      nativeWidth: nativeW,
      nativeHeight: nativeH,
      snapshots: {
        "4:3": { file: `${target}-4x3.png`, width: out43.width, height: out43.height },
        "16:9": { file: `${target}-16x9.png`, width: out169.width, height: out169.height },
      },
      animation: {
        totalFrames,
        fps: 60,
        startFrames,
        loopFrames,
        durationSeconds: Math.round((totalFrames / 60) * 100) / 100,
      },
      frames: options.includeFrames
        ? { directory: `${target}-frames/`, aspect: options.exportAspect ?? "4:3" }
        : null,
      textures: layout?.textures ?? [],
      materials: (layout?.materials ?? []).map((m) => ({
        name: m.name,
        textureMaps: (m.textureMaps ?? [])
          .map((tm) => layout?.textures?.[tm.textureIndex])
          .filter(Boolean),
        blendMode: m.blendMode?.type ?? null,
      })),
      panes: (layout?.panes ?? []).map((p) => ({
        name: p.name,
        type: p.type,
        parent: p.parent ?? null,
        size: [p.size?.w ?? 0, p.size?.h ?? 0],
        visible: p.visible !== false,
      })),
      groups: (layout?.groups ?? []).map((g) => g.name ?? g),
    };
  }

  if (results.audio?.pcm16?.length) {
    const audio = results.audio;
    const channelCount = Math.max(1, audio.channelCount ?? audio.pcm16.length);
    const frameCount = Math.min(...audio.pcm16.map((ch) => ch.length));
    manifest.audio = {
      file: "audio.wav",
      sampleRate: audio.sampleRate,
      channels: channelCount,
      durationSeconds: Math.round((frameCount / audio.sampleRate) * 100) / 100,
    };
  } else {
    manifest.audio = null;
  }

  return manifest;
}

function createWavArrayBuffer(audio) {
  if (!audio?.pcm16?.length || !Number.isFinite(audio.sampleRate) || audio.sampleRate <= 0) {
    return null;
  }

  const channelCount = Math.max(1, audio.channelCount ?? audio.pcm16.length);
  const frameCount = Math.min(...audio.pcm16.map((ch) => ch.length));
  if (!Number.isFinite(frameCount) || frameCount <= 0) return null;

  const blockAlign = channelCount * 2;
  const byteRate = audio.sampleRate * blockAlign;
  const dataSize = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const encoder = new TextEncoder();

  const writeTag = (offset, tag) => {
    const bytes = encoder.encode(tag);
    for (let i = 0; i < bytes.length; i++) view.setUint8(offset + i, bytes[i]);
  };

  writeTag(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeTag(8, "WAVE");
  writeTag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeTag(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame++) {
    for (let ch = 0; ch < channelCount; ch++) {
      const channelData = audio.pcm16[ch] ?? audio.pcm16[audio.pcm16.length - 1];
      view.setInt16(offset, channelData?.[frame] ?? 0, true);
      offset += 2;
    }
  }

  return buffer;
}

/**
 * Render a single snapshot at a given aspect ratio using an offscreen renderer.
 */
async function renderSnapshot(BannerRenderer, result, animSelection, displayAspect, extraOptions) {
  const layout = extraOptions.layout ?? result.renderLayout;
  const loopAnim = animSelection.loopAnim ?? animSelection.anim;

  // The renderer will resize the canvas based on displayAspect, but we need
  // to give it the native layout size and let it compute the output.
  const outSize = computeOutputSize(layout.width, layout.height, displayAspect);
  const offscreen = new OffscreenCanvas(outSize.width, outSize.height);

  const renderer = new BannerRenderer(offscreen, layout, animSelection.anim, result.tplImages, {
    startAnim: null,
    loopAnim,
    renderState: animSelection.renderState,
    playbackMode: "hold",
    displayAspect,
    tevQuality: extraOptions.tevQuality ?? "fast",
    fonts: result.fonts ?? {},
    titleLocale: extraOptions.titleLocale,
    paneStateSelections: extraOptions.paneStateSelections,
  });

  try {
    renderer.applyFrame(extraOptions.snapshotFrame ?? 0);
    return await offscreen.convertToBlob({ type: "image/png" });
  } finally {
    renderer.dispose();
  }
}

/**
 * Render all animation frames for a target and return as PNG blobs.
 */
async function renderAllFrames(BannerRenderer, result, animSelection, extraOptions, onProgress) {
  const layout = extraOptions.layout ?? result.renderLayout;
  const loopAnim = animSelection.loopAnim ?? animSelection.anim;
  const startAnim = animSelection.startAnim ?? null;
  const totalStartFrames = startAnim?.frameSize ?? 0;
  const totalLoopFrames = loopAnim?.frameSize ?? 120;
  const totalFrames = totalStartFrames + totalLoopFrames;

  const displayAspect = extraOptions.displayAspect ?? 4 / 3;
  const outSize = computeOutputSize(layout.width, layout.height, displayAspect);
  const offscreen = new OffscreenCanvas(outSize.width, outSize.height);

  const renderer = new BannerRenderer(offscreen, layout, animSelection.anim, result.tplImages, {
    startAnim,
    loopAnim,
    renderState: animSelection.renderState,
    playbackMode: "hold",
    displayAspect,
    tevQuality: extraOptions.tevQuality ?? "fast",
    fonts: result.fonts ?? {},
    titleLocale: extraOptions.titleLocale,
    paneStateSelections: extraOptions.paneStateSelections,
  });

  const blobs = [];

  try {
    if (startAnim && totalStartFrames > 0) {
      for (let f = 0; f < totalStartFrames; f++) {
        renderer.applyFrame(f);
        const blob = await offscreen.convertToBlob({ type: "image/png" });
        blobs.push(blob);
        onProgress?.(blobs.length, totalFrames);
      }
      renderer.setActiveAnim(loopAnim, "loop");
      renderer.captureStartEndState?.();
    }

    for (let f = 0; f < totalLoopFrames; f++) {
      renderer.applyFrame(f);
      const blob = await offscreen.convertToBlob({ type: "image/png" });
      blobs.push(blob);
      onProgress?.(blobs.length, totalFrames);
    }
  } finally {
    renderer.dispose();
  }

  return blobs;
}

function resolveIconViewportForExport(layout) {
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

function parseAspectNumber(aspect) {
  if (typeof aspect === "number") return aspect;
  const str = String(aspect).trim();
  if (str === "4:3" || str === "4/3") return 4 / 3;
  if (str === "16:9" || str === "16/9") return 16 / 9;
  if (str === "16:10" || str === "16/10") return 16 / 10;
  if (str === "native" || str === "auto") return null;
  const m = str.match(/^([0-9.]+)\s*[:/]\s*([0-9.]+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  return 4 / 3;
}

/**
 * Export parsed WAD data as a zip bundle.
 *
 * @param {object} params
 * @param {object} params.parsed - Result from processWAD()
 * @param {string} params.sourceFileName - Original WAD filename
 * @param {HTMLCanvasElement} params.bannerCanvas - Current banner canvas (for snapshot)
 * @param {HTMLCanvasElement} params.iconCanvas - Current icon canvas (for snapshot)
 * @param {object} params.options - Export options
 * @param {boolean} params.options.includeFrames - Export all animation frames
 * @param {boolean} params.options.includeTextures - Export individual textures (default: true)
 * @param {boolean} params.options.includeAudio - Export WAV audio (default: true)
 * @param {string} params.options.exportAspect - Aspect ratio for frame export ("4:3", "16:9", etc.)
 * @param {Function} params.BannerRenderer - BannerRenderer class (needed for snapshot/frame rendering)
 * @param {object} params.bannerAnimSelection - Banner animation selection
 * @param {object} params.iconAnimSelection - Icon animation selection
 * @param {object} params.rendererOptions - Extra renderer options (tevQuality, titleLocale, etc.)
 * @param {Function} params.onProgress - Progress callback (stage, current, total)
 * @returns {Promise<Blob>} Zip file as Blob
 */
export async function exportBundle({
  parsed,
  sourceFileName,
  bannerCanvas,
  iconCanvas,
  options = {},
  BannerRenderer,
  bannerAnimSelection,
  iconAnimSelection,
  rendererOptions = {},
  onProgress,
}) {
  const includeTextures = options.includeTextures !== false;
  const includeAudio = options.includeAudio !== false;
  const includeFrames = options.includeFrames === true;
  const exportAspect = options.exportAspect ?? "4:3";

  onProgress?.("loading", 0, 1);
  const JSZip = await loadJSZip();
  const zip = new JSZip();

  const manifest = buildManifest(parsed, sourceFileName, { includeFrames, exportAspect });
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  // --- Snapshots ---
  // Export the current canvas view plus both aspect ratio variants for banner.
  onProgress?.("snapshots", 0, 4);

  if (bannerCanvas) {
    const blob = await canvasToBlob(bannerCanvas);
    if (blob) zip.file("banner.png", blob);
  }
  onProgress?.("snapshots", 1, 4);

  if (iconCanvas) {
    const blob = await canvasToBlob(iconCanvas);
    if (blob) zip.file("icon.png", blob);
  }
  onProgress?.("snapshots", 2, 4);

  // Render both 4:3 and 16:9 banner snapshots via offscreen renderer
  const bannerResult = parsed.results.banner;
  if (BannerRenderer && bannerResult && bannerAnimSelection?.anim) {
    for (const aspect of [4 / 3, 16 / 9]) {
      const label = aspect === 4 / 3 ? "4x3" : "16x9";
      try {
        const blob = await renderSnapshot(
          BannerRenderer, bannerResult, bannerAnimSelection, aspect, {
            ...rendererOptions,
            snapshotFrame: 0,
          },
        );
        if (blob) zip.file(`banner-${label}.png`, blob);
      } catch {
        // fall through - snapshot is best-effort
      }
    }
  }
  onProgress?.("snapshots", 4, 4);

  // Icon aspect-ratio snapshots (icon doesn't stretch, just copy)
  const iconResult = parsed.results.icon;
  if (BannerRenderer && iconResult && iconAnimSelection?.anim) {
    const iconViewport = resolveIconViewportForExport(iconResult.renderLayout);
    const iconExtraOpts = { ...rendererOptions };
    if (iconViewport) {
      iconExtraOpts.layout = { ...iconResult.renderLayout, width: iconViewport.width, height: iconViewport.height };
    }
    try {
      const blob = await renderSnapshot(
        BannerRenderer, iconResult, iconAnimSelection, null, iconExtraOpts,
      );
      if (blob) {
        zip.file("icon-4x3.png", blob);
        zip.file("icon-16x9.png", blob);
      }
    } catch {
      // best-effort
    }
  }

  // --- Textures ---
  if (includeTextures) {
    for (const target of ["banner", "icon"]) {
      const result = parsed.results[target];
      if (!result?.tplImages) continue;

      const textureEntries = Object.entries(result.tplImages);
      let done = 0;
      for (const [name, images] of textureEntries) {
        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          if (!img?.imageData) continue;
          try {
            const imageData = tplImageToImageData(img);
            const blob = await imageDataToPngBlob(imageData);
            const safeName = images.length > 1 ? `${name}_${i}.png` : `${name}.png`;
            zip.file(`textures/${target}/${safeName}`, blob);
          } catch {
            // skip
          }
        }
        done++;
        onProgress?.("textures", done, textureEntries.length);
      }
    }
  }

  // --- Audio ---
  if (includeAudio && parsed.results.audio) {
    const wavBuffer = createWavArrayBuffer(parsed.results.audio);
    if (wavBuffer) {
      zip.file("audio.wav", wavBuffer);
    }
    onProgress?.("audio", 1, 1);
  }

  // --- Animation frames ---
  if (includeFrames && BannerRenderer) {
    const frameAspect = parseAspectNumber(exportAspect);

    for (const target of ["banner", "icon"]) {
      const result = parsed.results[target];
      const animSel = target === "banner" ? bannerAnimSelection : iconAnimSelection;
      if (!result || !animSel?.anim) continue;

      const extraOpts = { ...rendererOptions, displayAspect: target === "banner" ? frameAspect : null };
      if (target === "icon") {
        const iconViewport = resolveIconViewportForExport(result.renderLayout);
        if (iconViewport) {
          extraOpts.layout = { ...result.renderLayout, width: iconViewport.width, height: iconViewport.height };
        }
      }

      const frameBlobs = await renderAllFrames(
        BannerRenderer,
        result,
        animSel,
        extraOpts,
        (current, total) => onProgress?.(`${target}-frames`, current, total),
      );

      for (let i = 0; i < frameBlobs.length; i++) {
        zip.file(`${target}-frames/${String(i).padStart(4, "0")}.png`, frameBlobs[i]);
      }
    }
  }

  onProgress?.("compressing", 0, 1);
  const zipBlob = await zip.generateAsync({ type: "blob" });
  onProgress?.("done", 1, 1);
  return zipBlob;
}

/**
 * Load and parse an exported zip bundle for preview.
 * Returns a structured object with URLs for images, audio, and parsed manifest.
 *
 * @param {Blob|ArrayBuffer|File} zipData - The zip file data
 * @returns {Promise<object>} Parsed bundle with object URLs
 */
export async function loadBundle(zipData) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(zipData);

  let manifest = null;
  const manifestFile = zip.file("manifest.json");
  if (manifestFile) {
    manifest = JSON.parse(await manifestFile.async("string"));
  }

  const urls = {};
  const entries = [];

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const blob = await entry.async("blob");
    const url = URL.createObjectURL(blob);
    urls[path] = url;
    entries.push({
      path,
      size: blob.size,
      url,
      isImage: /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(path),
      isAudio: /\.(wav|mp3|ogg)$/i.test(path),
      isJson: /\.json$/i.test(path),
    });
  }

  return { manifest, urls, entries, zip };
}

/**
 * Revoke all object URLs from a loaded bundle to free memory.
 */
export function revokeBundle(bundle) {
  if (!bundle?.urls) return;
  for (const url of Object.values(bundle.urls)) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
