import { TITLE_LOCALE_CODES, extractTitleLocaleCode } from "./locale";

const LOCALE_SORT_ORDER = new Map(TITLE_LOCALE_CODES.map((code, index) => [code, index]));

function addLocale(locales, locale) {
  if (!locale || !TITLE_LOCALE_CODES.includes(locale)) {
    return;
  }
  locales.add(locale);
}

function getLocaleFromPaneGroups(renderer, paneName) {
  const groups = renderer.getPaneGroupNames(paneName);
  if (!groups || groups.size === 0) {
    return null;
  }

  for (const groupName of groups) {
    const locale = extractTitleLocaleCode(groupName);
    if (locale) {
      return locale;
    }
  }

  return null;
}

export function collectTitleLocales() {
  const locales = new Set();

  for (const group of this.layout?.groups ?? []) {
    addLocale(locales, extractTitleLocaleCode(group?.name));
  }

  for (const pane of this.layout?.panes ?? []) {
    addLocale(locales, extractTitleLocaleCode(pane.name));
    addLocale(locales, getLocaleFromPaneGroups(this, pane.name));
  }

  return locales;
}

export function resolveActiveTitleLocale(preferredLocale) {
  if (this.availableTitleLocales.size === 0) {
    return null;
  }

  const normalizedPreferred = preferredLocale ? String(preferredLocale).toUpperCase() : null;
  if (normalizedPreferred && this.availableTitleLocales.has(normalizedPreferred)) {
    return normalizedPreferred;
  }

  if (this.availableTitleLocales.has("US")) {
    return "US";
  }

  return this.availableTitleLocales.values().next().value ?? null;
}

export function getPaneTitleLocale(pane) {
  const directLocale = extractTitleLocaleCode(pane?.name);
  if (directLocale) {
    return directLocale;
  }

  const directGroupLocale = getLocaleFromPaneGroups(this, pane?.name);
  if (directGroupLocale) {
    return directGroupLocale;
  }

  const chain = this.getPaneTransformChain(pane);
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const chainPane = chain[i];
    const localeFromName = extractTitleLocaleCode(chainPane.name);
    if (localeFromName) {
      return localeFromName;
    }

    const localeFromGroups = getLocaleFromPaneGroups(this, chainPane.name);
    if (localeFromGroups) {
      return localeFromGroups;
    }
  }

  return null;
}

export function shouldRenderPaneForLocale(pane) {
  if (!this.activeTitleLocale || this.availableTitleLocales.size <= 1) {
    return true;
  }

  const paneLocale = this.getPaneTitleLocale(pane);
  if (!paneLocale) {
    return true;
  }

  return paneLocale === this.activeTitleLocale;
}

// Returns true if this pane should be forced visible because it matches the
// active locale. On real Wii, the system menu firmware sets the correct
// language pane visible — we simulate this by overriding visibility for
// locale-tagged panes that match the user's language preference.
export function getLocaleVisibilityOverride(pane) {
  if (!this.activeTitleLocale || this.availableTitleLocales.size <= 1) {
    return null;
  }

  const paneLocale = this.getPaneTitleLocale(pane);
  if (!paneLocale) {
    return null;
  }

  return paneLocale === this.activeTitleLocale ? true : null;
}

export function setTitleLocale(localeCode) {
  this.titleLocalePreference = localeCode ?? null;
  this.activeTitleLocale = this.resolveActiveTitleLocale(localeCode);
  this.render();
}

export function getAvailableTitleLocales() {
  return [...this.availableTitleLocales].sort((left, right) => {
    const leftOrder = LOCALE_SORT_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = LOCALE_SORT_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.localeCompare(right);
  });
}
