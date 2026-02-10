const TELOP_PANE_PATTERN = /^telop(\d+)$/;

export function isCustomNewsEnabled() {
  return Boolean(this.customNews?.enabled);
}

export function getCustomNewsTextForPane(pane) {
  if (!this.isCustomNewsEnabled() || !pane) {
    return null;
  }

  const paneName = String(pane.name ?? "");
  const match = paneName.match(TELOP_PANE_PATTERN);
  if (!match) {
    return null;
  }

  const index = Number.parseInt(match[1], 10);
  const headlines = this.customNews.headlines;
  if (!Array.isArray(headlines) || index >= headlines.length) {
    return null;
  }

  const text = headlines[index];
  return typeof text === "string" && text.length > 0 ? text : null;
}
