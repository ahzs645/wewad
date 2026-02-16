import { resolveAnimationSelection } from "./animation";

export function getUsedTextureNames(layout) {
  if (!layout) return new Set();
  const used = new Set();
  for (const pane of layout.panes ?? []) {
    if (pane.materialIndex < 0) continue;
    const material = layout.materials?.[pane.materialIndex];
    if (!material) continue;
    for (const tm of material.textureMaps ?? []) {
      const idx = tm.textureIndex;
      if (idx !== 0xffff && idx < (layout.textures?.length ?? 0)) {
        used.add(layout.textures[idx]);
      }
    }
  }
  return used;
}

export function resolveIconViewport(layout) {
  if (!layout) {
    return { width: 128, height: 96 };
  }

  const picturePanes = (layout.panes ?? []).filter((pane) => pane.type === "pic1");

  // Normalize camelCase to snake_case before matching so that names like
  // "iconBg" are split into "icon_Bg" and the keyword "icon" is recognised.
  const camelToSnake = (name) => name.replace(/([a-z])([A-Z])/g, "$1_$2");
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

export function createRecentIconPreview(result, BannerRenderer) {
  if (typeof document === "undefined") {
    return null;
  }

  const iconResult = result?.results?.icon;
  if (!iconResult?.renderLayout || !iconResult?.tplImages) {
    return null;
  }

  let renderer = null;
  try {
    const viewport = resolveIconViewport(iconResult.renderLayout);
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const iconLayout = {
      ...iconResult.renderLayout,
      width: viewport.width,
      height: viewport.height,
    };
    const animationSelection = resolveAnimationSelection(iconResult, null);
    renderer = new BannerRenderer(
      canvas,
      iconLayout,
      animationSelection.anim,
      iconResult.tplImages,
      {
        initialFrame: 0,
        startAnim: animationSelection.startAnim ?? null,
        loopAnim: animationSelection.loopAnim ?? animationSelection.anim ?? null,
        renderState: animationSelection.renderState,
        playbackMode: animationSelection.playbackMode ?? "loop",
        fonts: iconResult.fonts,
      },
    );
    renderer.render();
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    renderer?.dispose?.();
  }
}
