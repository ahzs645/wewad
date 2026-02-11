export const TITLE_LOCALE_CODES = ["JP", "NE", "GE", "SP", "IT", "FR", "US", "KR"];

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
  ["KR", "KR"],
  ["KOR", "KR"],
  ["KO", "KR"],
]);

export function normalizeTitleLocaleCode(code) {
  if (!code) {
    return null;
  }

  return TITLE_LOCALE_ALIASES.get(String(code).toUpperCase()) ?? null;
}

function tokenizeLocaleName(name) {
  const normalized = String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([0-9])/g, "$1_$2")
    .replace(/([0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();

  return normalized
    .split(/[^A-Z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);
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
  if (lower.startsWith("ko")) {
    return "KR";
  }
  return "US";
}

export function extractTitleLocaleCode(name) {
  if (!name) {
    return null;
  }

  let match = name.match(/^N_title(JP|NE|GE|SP|IT|FR|US|KR)_/);
  if (match) {
    return match[1];
  }

  match = name.match(/^title_(JP|NE|GE|SP|IT|FR|US|KR)_/);
  if (match) {
    return match[1];
  }

  // Single-letter language codes used by some WADs (e.g. Wii Shop Channel:
  // P_title_E_00, P_title_J_00). Only match after "title_" to avoid false
  // positives on pane name prefixes like N_ (null/container panes).
  match = name.match(/title_([EJFGISN])_/i);
  if (match) {
    const SINGLE_LETTER_MAP = { J: "JP", E: "US", F: "FR", G: "GE", I: "IT", S: "SP", N: "NE" };
    const mapped = SINGLE_LETTER_MAP[match[1].toUpperCase()];
    if (mapped) {
      return mapped;
    }
  }

  match = name.match(/^(JP|NE|GE|SP|IT|FR|US|KR)_/);
  if (match) {
    return match[1];
  }

  match = String(name).match(
    /(?:^|_)(JP|NE|GE|SP|IT|FR|US|KR|JPN|NED|DUT|NL|GER|DEU|DE|SPA|ES|ESP|ITA|FRA|ENG|EN|USA|KOR|KO)(?:_|[0-9]|$)/i,
  );
  if (match) {
    return normalizeTitleLocaleCode(match[1]);
  }

  const tokens = tokenizeLocaleName(name);

  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const canonical = normalizeTitleLocaleCode(tokens[i]);
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
