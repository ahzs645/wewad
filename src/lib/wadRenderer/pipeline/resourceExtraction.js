import { parseBNS, parseBRLAN, parseBRLYT, parseTPL, parseU8 } from "../parsers/index";
import { NOOP_LOGGER, withLogger } from "../shared/index";

function inferAnimationRole(filePath) {
  const lower = String(filePath ?? "").toLowerCase();
  if (lower.includes("start")) {
    return "start";
  }
  if (lower.includes("loop")) {
    return "loop";
  }
  return "generic";
}

function inferAnimationState(filePath) {
  const match = String(filePath ?? "").match(/(?:^|[_-])(rso\d+)(?:[_.-]|$)/i);
  if (!match) {
    return null;
  }
  return match[1].toUpperCase();
}

function parseResourceSet(files, loggerInput) {
  const logger = withLogger(loggerInput);
  const sourceFiles = { ...files };

  // Expand SZS/Yaz0 layout packs into a flat lookup for tpl/brlyt/brlan scanning.
  for (const [filePath, data] of Object.entries(files)) {
    const lowerPath = filePath.toLowerCase();
    if (!lowerPath.endsWith(".szs")) {
      continue;
    }

    try {
      const innerFiles = parseU8(data, NOOP_LOGGER);
      let added = 0;
      for (const [innerPath, innerData] of Object.entries(innerFiles)) {
        sourceFiles[`${filePath}::${innerPath}`] = innerData;
        added += 1;
      }
      if (added > 0) {
        logger.info(`Expanded ${filePath} (${added} file(s))`);
      }
    } catch (error) {
      logger.warn(`Failed to expand ${filePath}: ${error.message}`);
    }
  }

  const tplImages = {};
  let decodedTextureCount = 0;
  const maxDecodedTextures = 200;
  let layout = null;
  let animation = null;
  let animationStart = null;
  let animationLoop = null;
  const animationEntries = [];

  for (const [filePath, data] of Object.entries(sourceFiles)) {
    if (!filePath.toLowerCase().endsWith(".tpl")) {
      continue;
    }

    if (decodedTextureCount >= maxDecodedTextures) {
      logger.warn(`Texture decode limit reached (${maxDecodedTextures}); skipping remaining textures`);
      break;
    }

    const baseName = filePath.split("/").pop() ?? filePath;
    let textureName = baseName;
    if (tplImages[textureName]) {
      textureName = filePath;
    }

    try {
      tplImages[textureName] = parseTPL(data, logger);
      logger.success(`Decoded ${textureName}`);
      decodedTextureCount += 1;
    } catch (error) {
      logger.error(`Failed to decode ${textureName}: ${error.message}`);
    }
  }

  const brlytEntries = Object.entries(sourceFiles)
    .filter(([filePath]) => filePath.toLowerCase().endsWith(".brlyt"))
    .sort((left, right) => right[1].byteLength - left[1].byteLength);
  if (brlytEntries.length > 0) {
    const selectedLayoutEntry =
      brlytEntries.find(([filePath]) => !filePath.toLowerCase().includes("common")) ?? brlytEntries[0];
    const [layoutPath, layoutData] = selectedLayoutEntry;

    logger.info(`=== Parsing ${layoutPath} ===`);
    try {
      layout = parseBRLYT(layoutData, logger);
    } catch (error) {
      logger.error(`BRLYT parse error: ${error.message}`);
    }
  }

  const brlanEntries = Object.entries(sourceFiles).filter(([filePath]) => filePath.toLowerCase().endsWith(".brlan"));
  if (brlanEntries.length > 0) {
    const sortBySize = (left, right) => right[1].byteLength - left[1].byteLength;
    const parseAnimEntry = ([animPath, animData]) => {
      logger.info(`=== Parsing ${animPath} ===`);
      try {
        const anim = parseBRLAN(animData, logger);
        const role = inferAnimationRole(animPath);
        animationEntries.push({
          id: animPath,
          path: animPath,
          role,
          state: inferAnimationState(animPath),
          frameSize: anim.frameSize ?? 0,
          paneCount: anim.panes?.length ?? 0,
          anim,
        });
      } catch (error) {
        logger.warn(`BRLAN parse warning: ${error.message}`);
      }
    };

    brlanEntries.sort(sortBySize).forEach(parseAnimEntry);

    const loopEntry = animationEntries.find((entry) => entry.role === "loop") ?? null;
    const startEntry = animationEntries.find((entry) => entry.role === "start") ?? null;

    animationLoop = loopEntry?.anim ?? null;
    animationStart = startEntry?.anim ?? null;

    if (!animationLoop && !animationStart) {
      animation = animationEntries[0]?.anim ?? null;
    } else {
      animation = animationLoop ?? animationStart;
    }
  }

  return {
    tplImages,
    layout,
    anim: animation,
    animStart: animationStart,
    animLoop: animationLoop,
    animEntries: animationEntries,
  };
}

function hasDirectRenderableFiles(files) {
  return Object.keys(files).some((path) => {
    const lower = path.toLowerCase();
    return (
      lower.endsWith(".tpl") ||
      lower.endsWith(".brlyt") ||
      lower.endsWith(".brlan") ||
      lower.endsWith(".szs")
    );
  });
}

export function extractTargetResources(metaFiles, target, loggerInput) {
  const logger = withLogger(loggerInput);
  const entries = Object.entries(metaFiles);
  const binEntry = entries.find(([path]) => path.toLowerCase().includes(`${target}.bin`));

  let sourceFiles = null;
  if (binEntry) {
    const [binPath, binData] = binEntry;
    logger.info(`=== Parsing ${binPath} ===`);
    try {
      sourceFiles = parseU8(binData, logger);
    } catch (error) {
      logger.warn(`Failed to parse ${binPath}: ${error.message}`);
      return null;
    }
  } else if (hasDirectRenderableFiles(metaFiles)) {
    logger.warn(`${target}.bin not found, using direct resources from selected content`);
    const entries = Object.entries(metaFiles);
    const screenAllEntries = entries.filter(([path]) => path.toLowerCase().includes("/screenall/"));

    if (screenAllEntries.length > 0) {
      const preferredSuffixes = [
        "/screenall/cmn/layout00.szs",
        "/screenall/usa/layout00.szs",
        "/screenall/eng/layout00.szs",
        "/screenall/jpn/layout00.szs",
      ];

      let selected = null;
      for (const suffix of preferredSuffixes) {
        selected = screenAllEntries.find(([path]) => path.toLowerCase().endsWith(suffix));
        if (selected) {
          break;
        }
      }

      if (!selected) {
        [selected] = screenAllEntries;
      }

      sourceFiles = { [selected[0]]: selected[1] };
      logger.info(`Selected ${selected[0]} as primary screen layout archive`);
    } else {
      sourceFiles = Object.fromEntries(
        entries.filter(([path]) => {
          const lower = path.toLowerCase();
          return !lower.includes("sofkeybd") && !lower.includes("homebutton");
        }),
      );
    }
  } else {
    logger.warn(`${target}.bin not found`);
    return null;
  }

  return parseResourceSet(sourceFiles, logger);
}

export function extractChannelAudio(metaFiles, loggerInput) {
  const logger = withLogger(loggerInput);
  const soundEntry = Object.entries(metaFiles).find(([path]) => path.toLowerCase().endsWith("sound.bin"));
  if (!soundEntry) {
    logger.info("sound.bin not found");
    return null;
  }

  const [soundPath, soundData] = soundEntry;
  logger.info(`=== Parsing ${soundPath} ===`);

  try {
    return parseBNS(soundData, logger);
  } catch (error) {
    logger.warn(`Failed to parse ${soundPath}: ${error.message}`);
    return null;
  }
}
