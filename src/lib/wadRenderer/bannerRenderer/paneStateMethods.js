import { clampChannel, normalizePaneVertexColors } from "./renderColorUtils";

function mergeAnimatedVertexColors(pane, animatedVertexColors) {
  if (!animatedVertexColors) {
    return pane?.vertexColors ?? null;
  }

  const base = normalizePaneVertexColors(pane) ?? [
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
  ];

  return base.map((color, index) => ({
    r: clampChannel(animatedVertexColors[index]?.r ?? color.r),
    g: clampChannel(animatedVertexColors[index]?.g ?? color.g),
    b: clampChannel(animatedVertexColors[index]?.b ?? color.b),
    a: clampChannel(animatedVertexColors[index]?.a ?? color.a),
  }));
}

export function getLocalPaneState(pane, frame) {
  const animValues = this.getAnimValues(pane.name, frame);
  const tx = animValues.transX ?? pane.translate?.x ?? 0;
  const ty = animValues.transY ?? pane.translate?.y ?? 0;
  const tz = animValues.transZ ?? pane.translate?.z ?? 0;
  const rotX = animValues.rotX ?? pane.rotate?.x ?? 0;
  const rotY = animValues.rotY ?? pane.rotate?.y ?? 0;
  const sx = animValues.scaleX ?? pane.scale?.x ?? 1;
  const sy = animValues.scaleY ?? pane.scale?.y ?? 1;
  const rotation = animValues.rotZ ?? pane.rotate?.z ?? 0;
  const width = animValues.width ?? pane.size?.w ?? 0;
  const height = animValues.height ?? pane.size?.h ?? 0;

  // Custom weather digit visibility takes priority over icon visibility.
  const digitVisibilityOverride = this.getCustomWeatherDigitVisibility?.(pane) ?? null;
  const visibilityOverride = digitVisibilityOverride != null
    ? digitVisibilityOverride
    : (this.getCustomWeatherVisibilityOverride?.(pane) ?? null);
  const hasAnimatedAlpha = animValues.alpha != null;
  // On real Wii, the system menu sets locale-matching panes visible (they're
  // visible=false in the BRLYT since the layout doesn't know the console language).
  const localeVisOverride = this.getLocaleVisibilityOverride?.(pane) ?? null;
  const isVisible = visibilityOverride != null
    ? visibilityOverride
    : animValues.visible != null
      ? animValues.visible
      : hasAnimatedAlpha
        ? true
        : localeVisOverride != null
          ? localeVisOverride
          : pane.visible !== false;
  const defaultAlpha = isVisible ? (pane.alpha ?? 255) / 255 : 0;
  const animatedAlpha = hasAnimatedAlpha ? animValues.alpha / 255 : defaultAlpha;
  const materialAlphaFactor = animValues.materialAlpha != null ? Math.max(0, Math.min(1, animValues.materialAlpha / 255)) : 1;
  // When custom weather forces a digit pane visible, override alpha to 1 — the BRLAN
  // animation may have alpha=0 at the frozen frame since these panes were originally
  // hidden and replaced by Canvas 2D text.
  const alpha = digitVisibilityOverride === true ? 1 : (isVisible ? animatedAlpha * materialAlphaFactor : 0);
  const propagatesAlpha = (pane.flags & 0x02) !== 0 || pane.type === "pic1" || pane.type === "txt1" || pane.type === "bnd1" || pane.type === "wnd1";
  const propagatesVisibility = true;

  // Custom weather overrides the texture index for digit panes to show the correct digit.
  let textureIndex = animValues.textureIndex;
  const customTexIdx = this.getCustomWeatherPaneTextureIndex?.(String(pane?.name ?? ""));
  if (customTexIdx != null) {
    textureIndex = customTexIdx;
  }

  return {
    tx,
    ty,
    tz,
    rotX,
    rotY,
    sx,
    sy,
    rotation,
    width,
    height,
    visible: isVisible,
    propagatesAlpha,
    propagatesVisibility,
    vertexColors: mergeAnimatedVertexColors(pane, animValues.vertexColors),
    alpha: Math.max(0, Math.min(1, alpha)),
    textureIndex,
  };
}
