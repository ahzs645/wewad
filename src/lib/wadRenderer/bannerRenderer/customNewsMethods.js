const TELOP_PANE_PATTERN = /^telop(\d+)$/;
const SPHERE_PANE_PATTERN = /^sphere(\d+)$/;
// Plain spacing between headlines — the sphere panes provide the yellow dot.
const HEADLINE_SEPARATOR = "\u3000\u3000\u3000\u3000";

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
  if (!Array.isArray(headlines) || headlines.length === 0) {
    return null;
  }

  // The News Channel icon has two ticker lines (telop0, telop1).
  // Distribute headlines by interleaving: even indices on line 0,
  // odd indices on line 1. Extra telop panes (2+) are hidden.
  if (index > 1) {
    return "";
  }

  const lineHeadlines = headlines.filter((_, i) => i % 2 === index);
  if (lineHeadlines.length === 0) {
    return "";
  }

  return lineHeadlines.join(HEADLINE_SEPARATOR);
}

export function shouldRenderPaneForCustomNews(pane) {
  if (!this.isCustomNewsEnabled() || !pane) {
    return true;
  }

  const paneName = String(pane.name ?? "");
  const headlines = this.customNews?.headlines;
  const headlineCount = Array.isArray(headlines) ? headlines.length : 0;

  const sphereMatch = paneName.match(SPHERE_PANE_PATTERN);
  if (sphereMatch) {
    const idx = Number.parseInt(sphereMatch[1], 10);
    // Hide sphere1 if there are no odd-indexed headlines for telop1
    if (idx === 1 && headlineCount < 2) return false;
    if (idx > 1) return false;
    return true;
  }

  const telopMatch = paneName.match(TELOP_PANE_PATTERN);
  if (telopMatch) {
    const idx = Number.parseInt(telopMatch[1], 10);
    if (idx === 1 && headlineCount < 2) return false;
    if (idx > 1) return false;
    return true;
  }

  return true;
}
