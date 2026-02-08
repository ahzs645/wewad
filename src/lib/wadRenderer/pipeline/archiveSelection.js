import { parseU8 } from "../parsers/index";
import { NOOP_LOGGER, withLogger } from "../shared/index";

function scoreArchiveFiles(files) {
  const paths = Object.keys(files).map((path) => path.toLowerCase());
  let score = 0;

  if (paths.some((path) => path.includes("banner.bin"))) {
    score += 200;
  }
  if (paths.some((path) => path.includes("icon.bin"))) {
    score += 180;
  }
  if (paths.some((path) => path.endsWith(".brlyt"))) {
    score += 80;
  }
  if (paths.some((path) => path.endsWith(".brlan"))) {
    score += 60;
  }
  if (paths.some((path) => path.endsWith(".tpl"))) {
    score += 40;
  }

  const szsCount = paths.filter((path) => path.endsWith(".szs")).length;
  if (szsCount > 0) {
    score += Math.min(szsCount * 25, 300);
  }

  if (paths.some((path) => path.includes("channel/screenall"))) {
    score += 260;
  }

  if (paths.some((path) => path.includes("homebutton"))) {
    score -= 120;
  }

  return score;
}

export function tryFindMetaArchive(contents) {
  const appNames = Object.keys(contents).sort((left, right) => {
    if (left === "00000000.app") {
      return -1;
    }
    if (right === "00000000.app") {
      return 1;
    }
    return left.localeCompare(right);
  });

  let best = null;

  for (const appName of appNames) {
    let files;
    try {
      files = parseU8(contents[appName], NOOP_LOGGER);
    } catch {
      continue;
    }

    const score = scoreArchiveFiles(files);
    if (score <= 0) {
      continue;
    }

    if (!best || score > best.score) {
      best = { appName, files, score };
    }
  }

  return best;
}

function containsBannerPayload(files) {
  return Object.keys(files).some((path) => {
    const lower = path.toLowerCase();
    return (
      lower.endsWith("banner.bin") ||
      lower.endsWith("/banner.bin") ||
      lower.endsWith("icon.bin") ||
      lower.endsWith("/icon.bin") ||
      lower.endsWith("sound.bin") ||
      lower.endsWith("/sound.bin")
    );
  });
}

export function tryFindBannerArchiveByTmdIndex(contents, contentRecords, loggerInput) {
  const logger = withLogger(loggerInput);
  const bannerRecord = contentRecords.find((record) => record.index === 0);
  if (!bannerRecord) {
    return null;
  }

  const appName = bannerRecord.name;
  const appData = contents[appName];
  if (!appData) {
    return null;
  }

  try {
    const files = parseU8(appData, NOOP_LOGGER);
    if (!containsBannerPayload(files)) {
      return null;
    }

    logger.info(`Using TMD index 0 content (${appName}) as banner archive`);
    return { appName, files, score: Number.MAX_SAFE_INTEGER };
  } catch {
    return null;
  }
}
