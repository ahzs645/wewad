export const TITLE_LOCALE_CODES = ["JP", "NE", "GE", "SP", "IT", "FR", "US"];

const TITLE_LOCALE_ALIASES = new Map([
  ["JP", "JP"],
  ["JPN", "JP"],
  ["JA", "JP"],
  ["NE", "NE"],
  ["NED", "NE"],
  ["DUT", "NE"],
  ["NL", "NE"],
  ["GE", "GE"],
  ["GER", "GE"],
  ["DE", "GE"],
  ["DEU", "GE"],
  ["SP", "SP"],
  ["SPA", "SP"],
  ["ES", "SP"],
  ["ESP", "SP"],
  ["IT", "IT"],
  ["ITA", "IT"],
  ["FR", "FR"],
  ["FRA", "FR"],
  ["US", "US"],
  ["ENG", "US"],
  ["EN", "US"],
  ["USA", "US"],
]);

function normalizeLocaleAlias(code) {
  if (!code) {
    return null;
  }

  return TITLE_LOCALE_ALIASES.get(String(code).toUpperCase()) ?? null;
}

export function detectPreferredTitleLocale() {
  const locale =
    globalThis.navigator?.language ??
    globalThis.Intl?.DateTimeFormat?.().resolvedOptions?.().locale ??
    "en-US";
  const lower = String(locale).toLowerCase();

  if (lower.startsWith("ja")) {
    return "JP";
  }
  if (lower.startsWith("nl")) {
    return "NE";
  }
  if (lower.startsWith("de")) {
    return "GE";
  }
  if (lower.startsWith("es")) {
    return "SP";
  }
  if (lower.startsWith("it")) {
    return "IT";
  }
  if (lower.startsWith("fr")) {
    return "FR";
  }
  return "US";
}

export function extractTitleLocaleCode(name) {
  if (!name) {
    return null;
  }

  let match = name.match(/^N_title(JP|NE|GE|SP|IT|FR|US)_/);
  if (match) {
    return match[1];
  }

  match = name.match(/^title_(JP|NE|GE|SP|IT|FR|US)_/);
  if (match) {
    return match[1];
  }

  match = name.match(/^(JP|NE|GE|SP|IT|FR|US)_/);
  if (match) {
    return match[1];
  }

  const normalized = String(name)
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toUpperCase();
  const tokens = normalized
    .split(/[^A-Z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const canonical = normalizeLocaleAlias(tokens[i]);
    if (canonical) {
      return canonical;
    }
  }

  return null;
}

export function isLikelyAlphaOnlyTitleMask(textureName) {
  if (!textureName) {
    return false;
  }

  return /nigaoetitlejpa/i.test(textureName) || /title_.*a_/i.test(textureName);
}
