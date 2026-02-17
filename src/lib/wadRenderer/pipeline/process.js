import { parseU8, parseWAD } from "../parsers/index";
import { withLogger } from "../shared/index";
import { tryFindBannerArchiveByTmdIndex, tryFindMetaArchive } from "./archiveSelection";
import { decryptWadContents } from "./decryption";
import { createRenderableLayout } from "./layout";
import { extractChannelAudio, extractTargetResources, parseResourceSet } from "./resourceExtraction";
import { loadJSZip } from "../../exportBundle";

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

function buildResultFromResourceSet(parsedTarget, logger) {
  if (!parsedTarget) {
    return null;
  }

  return {
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
      608,
      456,
      logger,
    ),
  };
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

  const results = {};
  if (banner) {
    results.banner = banner;
  } else {
    logger.warn("No renderable layout found in archive");
  }

  logger.success("=== Done! ===");
  return { wad: null, results };
}

export async function processZipBundle(buffer, loggerInput) {
  const logger = withLogger(loggerInput);

  logger.info("=== Parsing ZIP Bundle ===");
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(buffer);

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

  const mergedFiles = {};

  // Parse each .arc and merge files (largest first for priority)
  if (arcEntries.length > 0) {
    // Sort by size descending so the largest archive's files take priority
    const arcBuffers = [];
    for (const [path, entry] of arcEntries) {
      const arcBuffer = await entry.async("arraybuffer");
      arcBuffers.push({ path, buffer: arcBuffer, size: arcBuffer.byteLength });
    }
    arcBuffers.sort((a, b) => b.size - a.size);

    for (const { path, buffer: arcBuffer } of arcBuffers) {
      logger.info(`Parsing archive: ${path}`);
      try {
        const arcFiles = parseU8(arcBuffer, logger);
        for (const [filePath, data] of Object.entries(arcFiles)) {
          if (!mergedFiles[filePath]) {
            mergedFiles[filePath] = data;
          }
        }
      } catch (error) {
        logger.warn(`Failed to parse ${path}: ${error.message}`);
      }
    }
  }

  // Add loose files
  for (const [path, entry] of looseEntries) {
    if (!mergedFiles[path]) {
      mergedFiles[path] = await entry.async("arraybuffer");
    }
  }

  const fileCount = Object.keys(mergedFiles).length;
  if (fileCount === 0) {
    logger.warn("No renderable files found in ZIP bundle");
    return { wad: null, results: {} };
  }

  logger.info(`Total ${fileCount} file(s) available for rendering`);

  const parsedTarget = parseResourceSet(mergedFiles, logger);
  const banner = buildResultFromResourceSet(parsedTarget, logger);

  const results = {};
  if (banner) {
    results.banner = banner;
  } else {
    logger.warn("No renderable layout found in ZIP bundle");
  }

  logger.success("=== Done! ===");
  return { wad: null, results };
}
