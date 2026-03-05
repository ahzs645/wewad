import { parseU8, parseWAD } from "../parsers/index";
import { withLogger } from "../shared/index";
import { tryFindBannerArchiveByTmdIndex, tryFindMetaArchive } from "./archiveSelection";
import { decryptWadContents } from "./decryption";
import { createRenderableLayout } from "./layout";
import { extractChannelAudio, extractTargetResources, parseResourceSet } from "./resourceExtraction";
import { loadJSZip } from "../../exportBundle";
import { loadRendererBundle } from "../../bundleLoader";

export async function processWAD(buffer, loggerInput) {
  const logger = withLogger(loggerInput);

  logger.info("=== Parsing WAD ===");
  const wad = parseWAD(buffer, logger);
  let contents = wad.contents;
  const selectMetaArchive = (candidateContents) =>
    tryFindBannerArchiveByTmdIndex(candidateContents, wad.contentRecords, logger) ??
    tryFindMetaArchive(candidateContents);

  let metaArchive = selectMetaArchive(contents);

  if (!metaArchive) {
    logger.info("No banner archive found in raw contents, attempting AES decryption");
    try {
      const decryptedContents = await decryptWadContents(wad, logger);
      if (decryptedContents) {
        contents = decryptedContents;
        metaArchive = selectMetaArchive(contents);
      }
    } catch (error) {
      logger.warn(`Content decryption failed: ${error.message}`);
    }
  }

  if (!metaArchive) {
    logger.warn("Could not find a renderable banner/icon archive in this WAD");
    logger.success("=== Done! ===");
    return { wad, results: {} };
  }

  logger.info(`=== Parsing content ${metaArchive.appName} ===`);
  const metaFiles = metaArchive.files;

  const results = {};
  const channelAudio = extractChannelAudio(metaFiles, logger);
  if (channelAudio) {
    results.audio = channelAudio;
  }

  for (const target of ["banner", "icon"]) {
    const parsedTarget = extractTargetResources(metaFiles, target, logger);
    if (!parsedTarget) {
      continue;
    }

    const fallbackSize = target === "banner" ? { width: 608, height: 456 } : { width: 128, height: 128 };

    results[target] = {
      tplImages: parsedTarget.tplImages,
      layout: parsedTarget.layout,
      anim: parsedTarget.anim,
      animStart: parsedTarget.animStart ?? null,
      animLoop: parsedTarget.animLoop ?? null,
      animEntries: parsedTarget.animEntries ?? [],
      fonts: parsedTarget.fonts ?? {},
      renderLayout: createRenderableLayout(
        parsedTarget.layout,
        parsedTarget.tplImages,
        fallbackSize.width,
        fallbackSize.height,
        logger,
      ),
    };
  }

  logger.success("=== Done! ===");

  return { wad, results };
}

export function flattenTextures(tplImages) {
  const entries = [];

  for (const [name, images] of Object.entries(tplImages)) {
    for (let i = 0; i < images.length; i += 1) {
      entries.push({
        key: `${name}-${i}`,
        name,
        image: images[i],
      });
    }
  }

  return entries;
}

function buildResultFromResourceSet(parsedTarget, logger, fallbackW = 608, fallbackH = 456) {
  if (!parsedTarget) {
    return null;
  }

  const result = {
    tplImages: parsedTarget.tplImages,
    layout: parsedTarget.layout,
    anim: parsedTarget.anim,
    animStart: parsedTarget.animStart ?? null,
    animLoop: parsedTarget.animLoop ?? null,
    animEntries: parsedTarget.animEntries ?? [],
    fonts: parsedTarget.fonts ?? {},
    renderLayout: createRenderableLayout(
      parsedTarget.layout,
      parsedTarget.tplImages,
      fallbackW,
      fallbackH,
      logger,
    ),
  };

  // Build per-entry renderLayouts for animation entries that use a different layout
  for (const entry of result.animEntries) {
    if (entry.layout) {
      entry.renderLayout = createRenderableLayout(
        entry.layout,
        parsedTarget.tplImages,
        fallbackW,
        fallbackH,
        logger,
      );
    }
  }

  return result;
}

export function processArchive(buffer, loggerInput) {
  const logger = withLogger(loggerInput);

  logger.info("=== Parsing U8 Archive ===");
  let files;
  try {
    files = parseU8(buffer, logger);
  } catch (error) {
    logger.error(`Failed to parse U8 archive: ${error.message}`);
    return { wad: null, results: {} };
  }

  const fileCount = Object.keys(files).length;
  logger.info(`Extracted ${fileCount} file(s) from archive`);

  const parsedTarget = parseResourceSet(files, logger);
  const banner = buildResultFromResourceSet(parsedTarget, logger);
  const icon = buildResultFromResourceSet(parsedTarget, logger, 128, 128);

  const results = {};
  if (banner) {
    results.banner = banner;
  } else {
    logger.warn("No renderable layout found in archive");
  }
  if (icon) {
    results.icon = icon;
  }

  logger.success("=== Done! ===");
  return { wad: null, results };
}

function decodeWavToPcm16(wavBuffer) {
  const view = new DataView(wavBuffer);
  if (wavBuffer.byteLength < 44) return null;
  // Verify RIFF/WAVE header
  if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57415645) return null;

  let offset = 12;
  let sampleRate = 44100;
  let channelCount = 2;
  let bitsPerSample = 16;

  while (offset < wavBuffer.byteLength - 8) {
    const chunkId = view.getUint32(offset);
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 0x666D7420) { // "fmt "
      channelCount = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 0x64617461) { // "data"
      const dataOffset = offset + 8;
      const bytesPerSample = bitsPerSample / 8;
      const sampleCount = Math.floor(chunkSize / (channelCount * bytesPerSample));
      const pcm16 = [];
      for (let ch = 0; ch < channelCount; ch++) {
        pcm16.push(new Int16Array(sampleCount));
      }
      let readPos = dataOffset;
      for (let i = 0; i < sampleCount; i++) {
        for (let ch = 0; ch < channelCount; ch++) {
          pcm16[ch][i] = view.getInt16(readPos, true);
          readPos += 2;
        }
      }
      return { pcm16, sampleRate, channelCount, sampleCount };
    }

    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset++; // WAV chunks are word-aligned
  }
  return null;
}

async function processRendererBundleZip(buffer, logger) {
  logger.info("Detected renderer bundle format");
  const bundle = await loadRendererBundle(buffer);
  const manifest = bundle.manifest ?? {};

  const results = {};
  for (const target of ["banner", "icon"]) {
    const targetData = bundle[target];
    if (!targetData?.layout) continue;

    logger.info(`Loaded ${target} from renderer bundle`);
    results[target] = {
      tplImages: targetData.tplImages ?? {},
      layout: targetData.layout,
      anim: targetData.startAnim ?? targetData.loopAnim ?? null,
      animStart: targetData.startAnim ?? null,
      animLoop: targetData.loopAnim ?? null,
      animEntries: [],
      fonts: targetData.fonts ?? {},
      renderLayout: targetData.layout,
    };
  }

  if (bundle.audioWav) {
    const audio = decodeWavToPcm16(bundle.audioWav);
    if (audio) {
      const manifestAudio = manifest.audio ?? {};
      audio.loopFlag = manifestAudio.loopFlag ?? false;
      audio.loopStart = manifestAudio.loopStart ?? 0;
      audio.durationSeconds = manifestAudio.durationSeconds ?? 0;
      results.audio = audio;
      logger.info("Loaded audio from renderer bundle");
    }
  }

  logger.success("=== Done! ===");
  return { wad: { titleId: manifest.titleId ?? null }, results };
}

export async function processZipBundle(buffer, loggerInput) {
  const logger = withLogger(loggerInput);

  logger.info("=== Parsing ZIP Bundle ===");
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(buffer);

  // Detect renderer bundle (has banner/layout.json or icon/layout.json)
  if (zip.file("banner/layout.json") || zip.file("icon/layout.json")) {
    return processRendererBundleZip(buffer, logger);
  }

  // Collect all .arc files from the ZIP
  const arcEntries = Object.entries(zip.files).filter(
    ([path, entry]) => !entry.dir && path.toLowerCase().endsWith(".arc"),
  );

  // Collect loose raw files (.brlyt, .brlan, .tpl)
  const looseEntries = Object.entries(zip.files).filter(([path, entry]) => {
    if (entry.dir) return false;
    const lower = path.toLowerCase();
    return lower.endsWith(".brlyt") || lower.endsWith(".brlan") || lower.endsWith(".tpl") ||
      lower.endsWith(".brfnt") || lower.endsWith(".szs");
  });

  // Parse all .arc files and partition into banner vs icon groups.
  // Archives whose name contains "thum" (e.g. diskThum.arc) are treated as icon sources.
  const arcBuffers = [];
  for (const [path, entry] of arcEntries) {
    const arcBuffer = await entry.async("arraybuffer");
    arcBuffers.push({ path, buffer: arcBuffer, size: arcBuffer.byteLength });
  }
  arcBuffers.sort((a, b) => b.size - a.size);

  const bannerArcs = arcBuffers.filter((a) => !a.path.toLowerCase().includes("thum"));
  const iconArcs = arcBuffers.filter((a) => a.path.toLowerCase().includes("thum"));

  const mergeArcFiles = (arcs) => {
    const merged = {};
    for (const { path, buffer: arcBuffer } of arcs) {
      logger.info(`Parsing archive: ${path}`);
      try {
        const arcFiles = parseU8(arcBuffer, logger);
        for (const [filePath, data] of Object.entries(arcFiles)) {
          if (!merged[filePath]) {
            merged[filePath] = data;
          }
        }
      } catch (error) {
        logger.warn(`Failed to parse ${path}: ${error.message}`);
      }
    }
    return merged;
  };

  // Banner: non-icon arcs + loose files
  const bannerFiles = mergeArcFiles(bannerArcs.length > 0 ? bannerArcs : arcBuffers);
  for (const [path, entry] of looseEntries) {
    if (!bannerFiles[path]) {
      bannerFiles[path] = await entry.async("arraybuffer");
    }
  }

  const results = {};

  const bannerFileCount = Object.keys(bannerFiles).length;
  if (bannerFileCount > 0) {
    logger.info(`Banner: ${bannerFileCount} file(s) available`);
    const parsedBanner = parseResourceSet(bannerFiles, logger);
    const banner = buildResultFromResourceSet(parsedBanner, logger, 608, 456);
    if (banner) {
      results.banner = banner;
    }
  }

  // Icon: if we found icon-specific arcs, process them separately
  if (iconArcs.length > 0) {
    const iconFiles = mergeArcFiles(iconArcs);
    const iconFileCount = Object.keys(iconFiles).length;
    if (iconFileCount > 0) {
      logger.info(`Icon: ${iconFileCount} file(s) available`);
      // Merge banner textures so icon layouts can reference shared TPLs
      const iconFilesWithTextures = { ...iconFiles };
      for (const [filePath, data] of Object.entries(bannerFiles)) {
        if (filePath.toLowerCase().endsWith(".tpl") && !iconFilesWithTextures[filePath]) {
          iconFilesWithTextures[filePath] = data;
        }
      }
      const parsedIcon = parseResourceSet(iconFilesWithTextures, logger);
      const icon = buildResultFromResourceSet(parsedIcon, logger, 128, 128);
      if (icon) {
        results.icon = icon;
      }
    }
  }

  if (!results.banner && !results.icon) {
    logger.warn("No renderable layout found in ZIP bundle");
  }

  logger.success("=== Done! ===");
  return { wad: null, results };
}
