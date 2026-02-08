import { parseWAD } from "../parsers/index";
import { withLogger } from "../shared/index";
import { tryFindBannerArchiveByTmdIndex, tryFindMetaArchive } from "./archiveSelection";
import { decryptWadContents } from "./decryption";
import { createRenderableLayout } from "./layout";
import { extractTargetResources } from "./resourceExtraction";

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
