const TELOP_PANE_PATTERN = /^telop(\d+)$/;
const SPHERE_PANE_PATTERN = /^sphere(\d+)$/;
const HEADLINE_SEPARATOR = "\u3000\u3000\u25CF\u3000\u3000";

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
  if (index !== 0) {
    return "";
  }

  const headlines = this.customNews.headlines;
  if (!Array.isArray(headlines) || headlines.length === 0) {
    return null;
  }

  return headlines.join(HEADLINE_SEPARATOR);
}

export function shouldRenderPaneForCustomNews(pane) {
  if (!this.isCustomNewsEnabled() || !pane) {
    return true;
  }

  const paneName = String(pane.name ?? "");

  const sphereMatch = paneName.match(SPHERE_PANE_PATTERN);
  if (sphereMatch && Number.parseInt(sphereMatch[1], 10) > 0) {
    return false;
  }

  const telopMatch = paneName.match(TELOP_PANE_PATTERN);
  if (telopMatch && Number.parseInt(telopMatch[1], 10) > 0) {
    return false;
  }

  return true;
}
