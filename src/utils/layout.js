import { resolveAnimationSelection } from "./animation";
import { resolveIconViewport } from "./iconViewport";

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

export { resolveIconViewport };

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
