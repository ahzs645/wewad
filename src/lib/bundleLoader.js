/**
 * Bundle Loader — Deserializes a renderer data bundle ZIP back into
 * BannerRenderer-compatible data structures.
 *
 * Usage:
 *   const bundle = await loadRendererBundle(zipArrayBuffer);
 *   const renderer = new BannerRenderer(canvas, bundle.banner.layout, ...);
 */

import { loadJSZip } from "./exportBundle";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pngBlobToImageData(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return imgData;
}

async function readJson(zip, path) {
  const file = zip.file(path);
  if (!file) return null;
  return JSON.parse(await file.async("string"));
}

async function readBlob(zip, path) {
  const file = zip.file(path);
  if (!file) return null;
  return file.async("blob");
}

// ---------------------------------------------------------------------------
// Load textures from PNG files back to tplImages format
// ---------------------------------------------------------------------------

async function loadTextures(zip, prefix) {
  const manifestJson = await readJson(zip, `${prefix}/textures.json`);
  if (!manifestJson) return {};

  const tplImages = {};

  for (const [tplName, entries] of Object.entries(manifestJson)) {
    tplImages[tplName] = [];

    for (const entry of entries) {
      const blob = await readBlob(zip, `${prefix}/textures/${entry.file}`);
      if (!blob) continue;

      const imgData = await pngBlobToImageData(blob);
      tplImages[tplName].push({
        width: entry.width,
        height: entry.height,
        format: entry.format,
        imageData: imgData.data,
      });
    }
  }

  return tplImages;
}

// ---------------------------------------------------------------------------
// Load fonts from JSON metadata + PNG glyph sheets
// ---------------------------------------------------------------------------

async function loadFonts(zip, prefix) {
  const fonts = {};

  // Find all font JSON files in the prefix/fonts/ directory
  const fontJsonPaths = Object.keys(zip.files).filter(
    (path) => path.startsWith(`${prefix}/fonts/`) && path.endsWith(".json"),
  );

  for (const jsonPath of fontJsonPaths) {
    const meta = await readJson(zip, jsonPath);
    if (!meta) continue;

    // Derive the font key from the JSON filename
    const fontKey = jsonPath
      .replace(`${prefix}/fonts/`, "")
      .replace(".json", "");

    // Reconstruct Maps from serialized arrays
    const charWidths = new Map(meta.charWidths ?? []);
    const charMap = new Map(meta.charMap ?? []);

    // Load glyph sheet PNGs
    const sheets = [];
    for (const sheetInfo of meta.sheets ?? []) {
      const blob = await readBlob(zip, `${prefix}/fonts/${sheetInfo.file}`);
      if (!blob) continue;

      const imgData = await pngBlobToImageData(blob);
      sheets.push({
        width: sheetInfo.width,
        height: sheetInfo.height,
        imageData: imgData.data,
      });
    }

    fonts[fontKey] = {
      fontInfo: meta.fontInfo ?? null,
      glyphInfo: meta.glyphInfo ?? null,
      charWidths,
      charMap,
      sheets,
    };
  }

  return fonts;
}

// ---------------------------------------------------------------------------
// Load a single target (banner or icon)
// ---------------------------------------------------------------------------

async function loadTarget(zip, prefix) {
  // Check if this target exists in the bundle
  const layoutFile = zip.file(`${prefix}/layout.json`);
  if (!layoutFile) return null;

  const layout = await readJson(zip, `${prefix}/layout.json`);
  const startAnim = await readJson(zip, `${prefix}/anim-start.json`);
  const loopAnim = await readJson(zip, `${prefix}/anim-loop.json`);
  const tplImages = await loadTextures(zip, prefix);
  const fonts = await loadFonts(zip, prefix);

  return {
    layout,
    startAnim,
    loopAnim,
    tplImages,
    fonts,
  };
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

/**
 * Load a renderer data bundle ZIP and reconstruct BannerRenderer-compatible data.
 *
 * @param {Blob|ArrayBuffer|File} zipData - The bundle ZIP
 * @returns {Promise<{
 *   manifest: object,
 *   banner: { layout, startAnim, loopAnim, tplImages, fonts } | null,
 *   icon: { layout, startAnim, loopAnim, tplImages, fonts } | null,
 *   audioWav: ArrayBuffer | null
 * }>}
 */
export async function loadRendererBundle(zipData) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(zipData);

  const manifest = await readJson(zip, "manifest.json");

  const [banner, icon] = await Promise.all([
    loadTarget(zip, "banner"),
    loadTarget(zip, "icon"),
  ]);

  // Load audio WAV as ArrayBuffer
  const audioFile = zip.file("audio.wav");
  const audioWav = audioFile ? await audioFile.async("arraybuffer") : null;

  return {
    manifest,
    banner,
    icon,
    audioWav,
  };
}
