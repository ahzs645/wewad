import { parseBNS, parseBRFNT, parseBRLAN, parseBRLYT, parseTPL, parseU8 } from "../parsers/index";
import { decodeLz77, decodeLzRaw, NOOP_LOGGER, withLogger } from "../shared/index";

function inferAnimationRole(filePath) {
  const lower = String(filePath ?? "").toLowerCase();
  if (lower.includes("start")) {
    return "start";
  }
  if (lower.includes("loop")) {
    return "loop";
  }
  // "_In" suffix is a start-animation alias used by some channels (reference:
  // wii-system-menu-player Banner.cpp fallback chain: _Start → _In → _Rso0).
  const stem = filenameStem(filePath).toLowerCase();
  if (stem.endsWith("_in")) {
    return "start";
  }
  return "generic";
}

function filenameStem(filePath) {
  return (filePath.split("/").pop() ?? filePath).replace(/\.[^.]+$/, "");
}

function findMatchingLayout(animPath, layoutsByPath, primaryLayoutPath) {
  const animStem = filenameStem(animPath).toLowerCase();
  let bestPath = primaryLayoutPath;
  let bestLen = 0;

  for (const layoutPath of Object.keys(layoutsByPath)) {
    const layoutStem = filenameStem(layoutPath).toLowerCase();
    if (animStem.startsWith(layoutStem) && layoutStem.length > bestLen) {
      bestPath = layoutPath;
      bestLen = layoutStem.length;
    }
  }

  return bestPath;
}

/**
 * For RSO animations where the actual visible content is clustered in a small
 * portion of the total frameSize, return a copy with a tighter frameSize.
 * RSO animations on the Wii have large frameSizes because the RSO state system
 * fills the remaining time with dynamic content — without that system running,
 * the animation goes blank for most of the cycle.
 */
function tightenRsoFrameSize(anim) {
  const frameSize = anim?.frameSize ?? 0;
  if (frameSize <= 0) {
    return null;
  }

  let maxActiveFrame = 0;
  for (const pane of anim.panes ?? []) {
    for (const tag of pane.tags ?? []) {
      for (const entry of tag.entries ?? []) {
        for (const kf of entry.keyframes ?? []) {
          if (kf.frame >= 0 && kf.frame < frameSize && kf.frame > maxActiveFrame) {
            maxActiveFrame = kf.frame;
          }
        }
      }
    }
  }

  if (maxActiveFrame <= 0) {
    return null;
  }

  // Add a small margin past the last keyframe for interpolation tails.
  const effectiveEnd = Math.min(frameSize, Math.ceil(maxActiveFrame) + 10);

  // Only tighten if the content occupies less than half the total frame range.
  if (effectiveEnd >= frameSize * 0.5) {
    return null;
  }

  return { ...anim, frameSize: effectiveEnd };
}

function inferAnimationState(filePath) {
  const match = String(filePath ?? "").match(/(?:^|[_-])(rso\d+)(?:[_.-]|$)/i);
  if (!match) {
    return null;
  }
  return match[1].toUpperCase();
}

export function parseResourceSet(files, loggerInput) {
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

  // Decompress .tpl.lz / .tpl.l / .LZ files (LZ-compressed TPL) and split multi-image
  // TPLs into individual entries so each sub-image gets its own texture name.
  // Tries: raw Nintendo LZ (no tag), LZ77-tagged BE, LZ77-tagged LE.
  for (const [filePath, data] of Object.entries(sourceFiles)) {
    const lowerPath = filePath.toLowerCase();
    if (!lowerPath.endsWith(".tpl.lz") && !lowerPath.endsWith(".tpl.l") && !(lowerPath.endsWith(".lz") && lowerPath.includes("tpl"))) {
      continue;
    }

    const raw = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer ?? data);
    const stem = filePath.split("/").pop().replace(/\.lz?$/i, "").replace(/\.tpl$/i, "");

    const decoders = [
      ["raw LZ", () => decodeLzRaw(raw)],
      ["LZ77 BE", () => decodeLz77(raw, "be")],
      ["LZ77 LE", () => decodeLz77(raw, "le")],
    ];

    let decoded = false;
    for (const [label, decode] of decoders) {
      try {
        const decompressed = decode();
        const buf = decompressed instanceof ArrayBuffer ? decompressed : decompressed.buffer;
        const images = parseTPL(buf, NOOP_LOGGER);
        for (let i = 0; i < images.length; i++) {
          const syntheticName = `${stem}_${String(i).padStart(2, "0")}.tpl`;
          sourceFiles[syntheticName] = "SYNTHETIC";
          sourceFiles[`__tplImageOverride__${syntheticName}`] = [images[i]];
        }
        logger.info(`Decompressed ${filePath} (${label}) → ${images.length} image(s) as ${stem}_XX.tpl`);
        decoded = true;
        break;
      } catch {
        // Try next decoder
      }
    }

    if (!decoded) {
      logger.warn(`Failed to decompress ${filePath}`);
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

    // Check for pre-parsed images from LZ-decompressed multi-image TPLs.
    const overrideKey = `__tplImageOverride__${filePath}`;
    if (sourceFiles[overrideKey]) {
      tplImages[textureName] = sourceFiles[overrideKey];
      logger.success(`Registered ${textureName} (from compressed TPL)`);
      decodedTextureCount += 1;
      continue;
    }

    try {
      tplImages[textureName] = parseTPL(data, logger);
      logger.success(`Decoded ${textureName}`);
      decodedTextureCount += 1;
    } catch (error) {
      logger.error(`Failed to decode ${textureName}: ${error.message}`);
    }
  }

  const parsedFonts = {};
  for (const [filePath, data] of Object.entries(sourceFiles)) {
    if (!filePath.toLowerCase().endsWith(".brfnt")) {
      continue;
    }

    const baseName = filePath.split("/").pop() ?? filePath;
    try {
      const font = parseBRFNT(data, logger);
      if (font) {
        parsedFonts[baseName] = font;
        logger.success(`Decoded font ${baseName}`);
      }
    } catch (error) {
      logger.warn(`Failed to decode font ${baseName}: ${error.message}`);
    }
  }

  const brlytEntries = Object.entries(sourceFiles)
    .filter(([filePath]) => filePath.toLowerCase().endsWith(".brlyt"))
    .sort((left, right) => right[1].byteLength - left[1].byteLength);
  const layoutsByPath = {};
  let layoutPath = null;
  if (brlytEntries.length > 0) {
    const selectedLayoutEntry =
      brlytEntries.find(([filePath]) => !filePath.toLowerCase().includes("common")) ?? brlytEntries[0];
    layoutPath = selectedLayoutEntry[0];

    for (const [path, data] of brlytEntries) {
      logger.info(`=== Parsing ${path} ===`);
      try {
        const parsed = parseBRLYT(data, logger);
        layoutsByPath[path] = parsed;
        if (path === layoutPath) {
          layout = parsed;
        }
      } catch (error) {
        logger.error(`BRLYT parse error (${path}): ${error.message}`);
      }
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
        const matchedLayoutPath = Object.keys(layoutsByPath).length > 1
          ? findMatchingLayout(animPath, layoutsByPath, layoutPath)
          : layoutPath;
        animationEntries.push({
          id: animPath,
          path: animPath,
          role,
          state: inferAnimationState(animPath),
          frameSize: anim.frameSize ?? 0,
          paneCount: anim.panes?.length ?? 0,
          anim,
          layout: matchedLayoutPath && matchedLayoutPath !== layoutPath
            ? layoutsByPath[matchedLayoutPath]
            : undefined,
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

      // RSO animations (e.g. Wii Shop Channel icon) have large frameSizes
      // designed for the Wii's RSO state system to fill with dynamic content.
      // The actual visible content is often clustered in a small portion of
      // the total frames.  Tighten the loop to the effective content range
      // so the icon doesn't go blank for long periods.
      if (animation && animationEntries.some((entry) => entry.state)) {
        const tightened = tightenRsoFrameSize(animation);
        if (tightened) {
          animation = tightened;
        }
      }
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
    fonts: parsedFonts,
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
