import { TITLE_LOCALE_CODES, extractTitleLocaleCode } from "./locale";

export function collectTitleLocales() {
  const locales = new Set();
  for (const pane of this.layout?.panes ?? []) {
    const locale = extractTitleLocaleCode(pane.name);
    if (locale && TITLE_LOCALE_CODES.includes(locale)) {
      locales.add(locale);
    }
  }
  return locales;
}

export function resolveActiveTitleLocale(preferredLocale) {
  if (this.availableTitleLocales.size === 0) {
    return null;
  }

  if (preferredLocale && this.availableTitleLocales.has(preferredLocale)) {
    return preferredLocale;
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

  const chain = this.getPaneTransformChain(pane);
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const locale = extractTitleLocaleCode(chain[i].name);
    if (locale) {
      return locale;
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
