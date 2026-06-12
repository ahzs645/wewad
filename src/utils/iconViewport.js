export function resolveIconViewport(layout) {
  if (!layout) {
    return { width: 128, height: 96 };
  }

  const picturePanes = (layout.panes ?? []).filter((pane) => pane.type === "pic1");

  // Normalize camelCase to snake_case before matching so names like "iconBg"
  // are split and the keyword "icon" is recognized.
  const camelToSnake = (name) => String(name ?? "").replace(/([a-z])([A-Z])/g, "$1_$2");
  const explicitViewportPane =
    picturePanes.find((pane) => /^ch\d+$/i.test(pane.name)) ??
    picturePanes.find((pane) => /(?:^|_)(?:tv|icon|cork|frame|bg|back|base|board)(?:_|$)/i.test(camelToSnake(pane.name)));

  const fallbackViewportPane = picturePanes
    .filter((pane) => pane.visible !== false)
    .filter((pane) => (pane.alpha ?? 255) > 0)
    .filter((pane) => Math.abs(pane.size?.w ?? 0) >= 64 && Math.abs(pane.size?.h ?? 0) >= 32)
    .sort((left, right) => {
      const leftArea = Math.abs(left.size?.w ?? 0) * Math.abs(left.size?.h ?? 0);
      const rightArea = Math.abs(right.size?.w ?? 0) * Math.abs(right.size?.h ?? 0);
      return rightArea - leftArea;
    })[0];

  const iconPane = explicitViewportPane ?? fallbackViewportPane;

  if (!iconPane) {
    return { width: 128, height: 96 };
  }

  const width = Math.max(1, Math.round(Math.abs(iconPane.size?.w ?? 128)));
  const height = Math.max(1, Math.round(Math.abs(iconPane.size?.h ?? 96)));
  return { width, height };
}
