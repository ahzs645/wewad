export const TITLE_LOCALE_CODES = ["JP", "NE", "GE", "SP", "IT", "FR", "US"];

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

  return null;
}

export function isLikelyAlphaOnlyTitleMask(textureName) {
  if (!textureName) {
    return false;
  }

  return /nigaoetitlejpa/i.test(textureName) || /title_.*a_/i.test(textureName);
}
