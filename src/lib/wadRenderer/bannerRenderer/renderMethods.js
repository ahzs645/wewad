import { interpolateKeyframes } from "../animations";

function clampChannel(value, fallback = 255) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizeMaterialColor(color) {
  if (!Array.isArray(color) || color.length < 4) {
    return null;
  }

  return {
    r: clampChannel(color[0]),
    g: clampChannel(color[1]),
    b: clampChannel(color[2]),
    a: clampChannel(color[3]),
  };
}

function buildCssColor(color) {
  const normalized = normalizeMaterialColor([color?.r, color?.g, color?.b, color?.a]);
  if (!normalized) {
    return "rgba(0, 0, 0, 1)";
  }

  return `rgba(${normalized.r}, ${normalized.g}, ${normalized.b}, ${normalized.a / 255})`;
}

function normalizePaneVertexColors(pane) {
  const rawColors = pane?.vertexColors;
  if (!Array.isArray(rawColors) || rawColors.length !== 4) {
    return null;
  }

  return rawColors.map((color) => ({
    r: clampChannel(color?.r),
    g: clampChannel(color?.g),
    b: clampChannel(color?.b),
    a: clampChannel(color?.a),
  }));
}

function writePixel(data, offset, r, g, b, a) {
  data[offset] = r;
  data[offset + 1] = g;
  data[offset + 2] = b;
  data[offset + 3] = a;
}

function buildVertexColorCanvas(colors, mode) {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;

  const context = canvas.getContext("2d");
  const imageData = context.createImageData(2, 2);
  const pixels = imageData.data;
  const [tl, tr, bl, br] = colors;

  if (mode === "color") {
    writePixel(pixels, 0, tl.r, tl.g, tl.b, 255);
    writePixel(pixels, 4, tr.r, tr.g, tr.b, 255);
    writePixel(pixels, 8, bl.r, bl.g, bl.b, 255);
    writePixel(pixels, 12, br.r, br.g, br.b, 255);
  } else {
    writePixel(pixels, 0, 255, 255, 255, tl.a);
    writePixel(pixels, 4, 255, 255, 255, tr.a);
    writePixel(pixels, 8, 255, 255, 255, bl.a);
    writePixel(pixels, 12, 255, 255, 255, br.a);
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

export function getAnimValues(paneName, frame) {
  const result = {
    transX: null,
    transY: null,
    rotZ: null,
    scaleX: null,
    scaleY: null,
    alpha: null,
    width: null,
    height: null,
  };

  if (!this.anim) {
    return result;
  }

  const paneAnimation = this.animByPaneName.get(paneName);
  if (!paneAnimation) {
    return result;
  }

  for (const tag of paneAnimation.tags) {
    for (const entry of tag.entries) {
      const keyframes = entry.keyframes ?? [];
      let sampleFrame = frame;
      if (this.anim.frameSize > 0 && keyframes.length > 0 && keyframes[0].frame >= 0 && frame < keyframes[0].frame) {
        sampleFrame += this.anim.frameSize;
      }

      const value = interpolateKeyframes(keyframes, sampleFrame);
      switch (entry.type) {
        case 0x00:
          result.transX = value;
          break;
        case 0x01:
          result.transY = value;
          break;
        case 0x05:
          result.rotZ = value;
          break;
        case 0x06:
          result.scaleX = value;
          break;
        case 0x07:
          result.scaleY = value;
          break;
        case 0x08:
          result.width = value;
          break;
        case 0x09:
          result.height = value;
          break;
        case 0x0a:
        case 0x10:
          result.alpha = value;
          break;
        default:
          break;
      }
    }
  }

  return result;
}

export function getPaneTransformChain(pane) {
  const cached = this.paneTransformChains.get(pane);
  if (cached) {
    return cached;
  }

  const chain = [];
  const seen = new Set();
  let current = pane;

  while (current && !seen.has(current.name)) {
    chain.push(current);
    seen.add(current.name);

    if (!current.parent) {
      break;
    }
    current = this.panesByName.get(current.parent) ?? null;
  }

  chain.reverse();
  this.paneTransformChains.set(pane, chain);
  return chain;
}

export function getLocalPaneState(pane, frame) {
  const animValues = this.getAnimValues(pane.name, frame);
  const tx = animValues.transX ?? pane.translate?.x ?? 0;
  const ty = animValues.transY ?? pane.translate?.y ?? 0;
  const sx = animValues.scaleX ?? pane.scale?.x ?? 1;
  const sy = animValues.scaleY ?? pane.scale?.y ?? 1;
  const rotation = animValues.rotZ ?? pane.rotate?.z ?? 0;
  const width = animValues.width ?? pane.size?.w ?? 0;
  const height = animValues.height ?? pane.size?.h ?? 0;

  const defaultAlpha = pane.visible === false ? 0 : (pane.alpha ?? 255) / 255;
  const alpha = animValues.alpha != null ? animValues.alpha / 255 : defaultAlpha;

  return {
    tx,
    ty,
    sx,
    sy,
    rotation,
    width,
    height,
    alpha: Math.max(0, Math.min(1, alpha)),
  };
}

export function getPaneVertexColorModulation(pane) {
  const cached = this.vertexColorModulationCache.get(pane);
  if (cached !== undefined) {
    return cached;
  }

  const colors = normalizePaneVertexColors(pane);
  if (!colors) {
    this.vertexColorModulationCache.set(pane, null);
    return null;
  }

  const hasColorTint = colors.some((color) => color.r !== 255 || color.g !== 255 || color.b !== 255);
  const hasAlphaTint = colors.some((color) => color.a !== 255);
  if (!hasColorTint && !hasAlphaTint) {
    this.vertexColorModulationCache.set(pane, null);
    return null;
  }

  const modulation = {
    hasColorTint,
    hasAlphaTint,
    colorCanvas: hasColorTint ? buildVertexColorCanvas(colors, "color") : null,
    alphaCanvas: hasAlphaTint ? buildVertexColorCanvas(colors, "alpha") : null,
  };
  this.vertexColorModulationCache.set(pane, modulation);
  return modulation;
}

export function getPaneMaterialColorModulation(pane) {
  const cached = this.materialColorModulationCache.get(pane);
  if (cached !== undefined) {
    return cached;
  }

  if (!Number.isInteger(pane?.materialIndex) || pane.materialIndex < 0 || pane.materialIndex >= this.layout.materials.length) {
    this.materialColorModulationCache.set(pane, null);
    return null;
  }

  const material = this.layout.materials[pane.materialIndex];
  const color = normalizeMaterialColor(material?.color2);
  if (!color) {
    this.materialColorModulationCache.set(pane, null);
    return null;
  }

  const hasColorTint = color.r !== 255 || color.g !== 255 || color.b !== 255;
  const hasAlphaTint = color.a !== 255;
  if (!hasColorTint && !hasAlphaTint) {
    this.materialColorModulationCache.set(pane, null);
    return null;
  }

  const modulation = { ...color, hasColorTint, hasAlphaTint };
  this.materialColorModulationCache.set(pane, modulation);
  return modulation;
}

export function applyPaneMaterialColorModulation(context, pane, width, height) {
  const modulation = this.getPaneMaterialColorModulation(pane);
  if (!modulation) {
    return;
  }

  const x = -width / 2;
  const y = -height / 2;

  if (modulation.hasColorTint) {
    context.save();
    context.globalAlpha = 1;
    context.globalCompositeOperation = "multiply";
    context.fillStyle = `rgba(${modulation.r}, ${modulation.g}, ${modulation.b}, 1)`;
    context.fillRect(x, y, width, height);
    context.restore();
  }

  if (modulation.hasAlphaTint) {
    context.save();
    context.globalAlpha = 1;
    context.globalCompositeOperation = "destination-in";
    context.fillStyle = `rgba(255, 255, 255, ${modulation.a / 255})`;
    context.fillRect(x, y, width, height);
    context.restore();
  }
}

export function applyPaneVertexColorModulation(context, pane, width, height) {
  const modulation = this.getPaneVertexColorModulation(pane);
  if (!modulation) {
    return;
  }

  const x = -width / 2;
  const y = -height / 2;

  if (modulation.hasColorTint && modulation.colorCanvas) {
    context.save();
    context.globalAlpha = 1;
    context.globalCompositeOperation = "multiply";
    context.drawImage(modulation.colorCanvas, x, y, width, height);
    context.restore();
  }

  if (modulation.hasAlphaTint && modulation.alphaCanvas) {
    context.save();
    context.globalAlpha = 1;
    context.globalCompositeOperation = "destination-in";
    context.drawImage(modulation.alphaCanvas, x, y, width, height);
    context.restore();
  }
}

export function shouldTreatPaneAsLumaMask(pane, binding) {
  if (!pane || !binding) {
    return false;
  }

  const paneName = String(pane.name ?? "").toLowerCase();
  if (paneName !== "ch2") {
    return false;
  }

  const baseTextureName = String(binding.textureName ?? "").split("|", 1)[0];
  if (!baseTextureName) {
    return false;
  }

  const format = this.getTextureFormat(baseTextureName);
  if (format !== 1) {
    return false;
  }

  const material =
    binding.material ??
    (Number.isInteger(pane.materialIndex) && pane.materialIndex >= 0 && pane.materialIndex < this.layout.materials.length
      ? this.layout.materials[pane.materialIndex]
      : null);
  const color1 = normalizeMaterialColor(material?.color1);
  if (!color1) {
    return true;
  }

  return color1.a === 0 && color1.r >= 200 && color1.g >= 200 && color1.b >= 200;
}

export function shouldTreatPaneAsLumaOverlay(pane, binding) {
  if (!pane || !binding) {
    return false;
  }

  const paneName = String(pane.name ?? "").toLowerCase();
  if (paneName !== "tvline_00" && paneName !== "logobg") {
    return false;
  }

  const baseTextureName = String(binding.textureName ?? "").split("|", 1)[0];
  if (!baseTextureName) {
    return false;
  }

  const format = this.getTextureFormat(baseTextureName);
  return format === 0;
}

export function drawPaneAsLumaMask(context, binding, pane, width, height) {
  const baseTextureName = String(binding.textureName ?? "").split("|", 1)[0];
  const maskTexture = this.getLumaAlphaTexture(baseTextureName, { mode: "binary" });
  if (!maskTexture) {
    return false;
  }

  const maskBinding = {
    ...binding,
    texture: maskTexture,
    textureName: `${baseTextureName}|luma-alpha`,
  };

  // First, clip the accumulated icon layers to the rounded luma mask.
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = "destination-in";
  this.drawPaneTexture(context, maskBinding, pane, width, height);
  context.restore();

  // Then add a subtle white wash so the icon reads like Wii menu artwork.
  context.save();
  context.globalAlpha = 0.45;
  context.globalCompositeOperation = "source-atop";
  this.drawPaneTexture(context, maskBinding, pane, width, height);
  context.restore();

  return true;
}

export function drawPaneAsLumaOverlay(context, binding, pane, width, height) {
  const baseTextureName = String(binding.textureName ?? "").split("|", 1)[0];
  const overlayTexture = this.getLumaAlphaTexture(baseTextureName, { mode: "linear" });
  if (!overlayTexture) {
    return false;
  }

  const overlayBinding = {
    ...binding,
    texture: overlayTexture,
    textureName: `${baseTextureName}|luma-overlay`,
  };
  this.drawPaneTexture(context, overlayBinding, pane, width, height);
  return true;
}

export function getWrappedSurface(
  texture,
  textureName,
  sourceRect,
  repeatX,
  repeatY,
  tileWidth,
  tileHeight,
  targetWidth,
  targetHeight,
) {
  const src = sourceRect ?? { x: 0, y: 0, width: texture.width, height: texture.height };
  const safeTileWidth = Math.max(1, Math.round(tileWidth));
  const safeTileHeight = Math.max(1, Math.round(tileHeight));
  const safeTargetWidth = Math.max(1, Math.round(targetWidth));
  const safeTargetHeight = Math.max(1, Math.round(targetHeight));
  const key = [
    textureName,
    src.x,
    src.y,
    src.width,
    src.height,
    repeatX ? 1 : 0,
    repeatY ? 1 : 0,
    safeTileWidth,
    safeTileHeight,
    safeTargetWidth,
    safeTargetHeight,
  ].join(":");

  const cached = this.patternTextureCache.get(key);
  if (cached) {
    return cached;
  }

  const surface = document.createElement("canvas");

  if (repeatX && repeatY) {
    surface.width = safeTileWidth;
    surface.height = safeTileHeight;
    surface
      .getContext("2d")
      .drawImage(texture, src.x, src.y, src.width, src.height, 0, 0, surface.width, surface.height);
  } else if (repeatX) {
    surface.width = safeTileWidth;
    surface.height = safeTargetHeight;
    surface
      .getContext("2d")
      .drawImage(texture, src.x, src.y, src.width, src.height, 0, 0, surface.width, surface.height);
  } else {
    surface.width = safeTargetWidth;
    surface.height = safeTileHeight;
    surface
      .getContext("2d")
      .drawImage(texture, src.x, src.y, src.width, src.height, 0, 0, surface.width, surface.height);
  }

  this.patternTextureCache.set(key, surface);
  return surface;
}

export function drawPaneTextureWithVerticalClamp(context, binding, pane, width, height) {
  const texture = binding.texture;
  const textureSRT = binding.textureSRT ?? null;
  const transformed = this.getTransformedTexCoords(pane, textureSRT);
  if (!transformed) {
    return false;
  }

  const eps = 1e-6;
  const topDeltaT = Math.abs(transformed.tl.t - transformed.tr.t);
  const bottomDeltaT = Math.abs(transformed.bl.t - transformed.br.t);
  if (topDeltaT > eps || bottomDeltaT > eps) {
    return false;
  }

  const tTop = (transformed.tl.t + transformed.tr.t) * 0.5;
  const tBottom = (transformed.bl.t + transformed.br.t) * 0.5;
  if (!Number.isFinite(tTop) || !Number.isFinite(tBottom) || Math.abs(tBottom - tTop) <= eps) {
    return false;
  }

  const repeatX = binding.wrapS === 1 || binding.wrapS === 2;
  const repeatY = binding.wrapT === 1 || binding.wrapT === 2;
  if (!repeatX || repeatY) {
    return false;
  }

  // Only use segmented clamp mapping when vertical coordinates are actually outside [0, 1].
  if (Math.min(tTop, tBottom) >= 0 && Math.max(tTop, tBottom) <= 1) {
    return false;
  }

  const baseSourceRect =
    this.getSourceRectForPane(pane, texture, {
      forceNormalized: true,
      repeatX: true,
      repeatY: true,
      textureSRT,
    }) ?? { x: 0, y: 0, width: texture.width, height: texture.height };

  const spans = this.getTexCoordSpans(pane, textureSRT);
  const sSpan = spans?.spanS ?? 1;
  const tileWidth = Math.abs(width) / Math.max(1e-6, sSpan);
  const paneTop = -height / 2;
  const textureHeight = texture.height;

  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const tAtV = (v) => tTop + (tBottom - tTop) * v;

  const drawSegment = (vStart, vEnd, sourceY, sourceHeight) => {
    const segVStart = Math.max(0, Math.min(1, vStart));
    const segVEnd = Math.max(0, Math.min(1, vEnd));
    if (segVEnd - segVStart <= 1e-6) {
      return;
    }

    const destY = paneTop + segVStart * height;
    const destHeight = (segVEnd - segVStart) * height;
    if (destHeight <= 0.25) {
      return;
    }

    const safeSourceHeight = Math.max(1, sourceHeight);
    const segmentSourceRect = {
      x: baseSourceRect.x,
      y: Math.max(0, Math.min(textureHeight - 1, sourceY)),
      width: baseSourceRect.width,
      height: Math.min(textureHeight, safeSourceHeight),
    };

    const surface = this.getWrappedSurface(
      texture,
      binding.textureName,
      segmentSourceRect,
      true,
      false,
      tileWidth,
      destHeight,
      width,
      destHeight,
    );

    const pattern = context.createPattern(surface, "repeat-x");
    if (!pattern) {
      return;
    }
    context.save();
    context.translate(-width / 2, destY);
    context.fillStyle = pattern;
    context.fillRect(0, 0, width, destHeight);
    context.restore();
  };

  const drawEdgeSegment = (vStart, vEnd, edge) => {
    const sourceY = edge <= 0 ? 0 : textureHeight - 1;
    drawSegment(vStart, vEnd, sourceY, 1);
  };

  const drawMappedSegment = (vStart, vEnd) => {
    if (vEnd - vStart <= 1e-6) {
      return;
    }
    const tStart = clamp01(tAtV(vStart));
    const tEnd = clamp01(tAtV(vEnd));
    const yStart = tStart * textureHeight;
    const yEnd = tEnd * textureHeight;
    const sourceTop = Math.max(0, Math.min(textureHeight - 1, Math.floor(Math.min(yStart, yEnd))));
    const sourceBottom = Math.max(sourceTop + 1, Math.min(textureHeight, Math.ceil(Math.max(yStart, yEnd))));
    drawSegment(vStart, vEnd, sourceTop, sourceBottom - sourceTop);
  };

  const deltaT = tBottom - tTop;
  const vAt0 = clamp01((0 - tTop) / deltaT);
  const vAt1 = clamp01((1 - tTop) / deltaT);

  if (deltaT > 0) {
    let mappedStart = 0;
    if (tTop < 0) {
      drawEdgeSegment(0, vAt0, 0);
      mappedStart = vAt0;
    }

    let mappedEnd = 1;
    if (tBottom > 1) {
      mappedEnd = vAt1;
    }

    drawMappedSegment(mappedStart, mappedEnd);

    if (mappedEnd < 1) {
      drawEdgeSegment(mappedEnd, 1, 1);
    }
    return true;
  }

  let mappedStart = 0;
  if (tTop > 1) {
    drawEdgeSegment(0, vAt1, 1);
    mappedStart = vAt1;
  }

  let mappedEnd = 1;
  if (tBottom < 0) {
    mappedEnd = vAt0;
  }

  drawMappedSegment(mappedStart, mappedEnd);

  if (mappedEnd < 1) {
    drawEdgeSegment(mappedEnd, 1, 0);
  }

  return true;
}

export function drawPaneTexture(context, binding, pane, width, height) {
  const texture = binding.texture;
  const repeatX = binding.wrapS === 1 || binding.wrapS === 2;
  const repeatY = binding.wrapT === 1 || binding.wrapT === 2;
  const textureSRT = binding.textureSRT ?? null;

  if (this.drawPaneTextureWithVerticalClamp(context, binding, pane, width, height)) {
    return;
  }

  const sourceRect = this.getSourceRectForPane(pane, texture, {
    forceNormalized: repeatX || repeatY,
    repeatX,
    repeatY,
    textureSRT,
  });
  if (repeatX || repeatY) {
    const spans = this.getTexCoordSpans(pane, textureSRT);
    const sSpan = repeatX ? spans?.spanS ?? 1 : 1;
    const tSpan = repeatY ? spans?.spanT ?? 1 : 1;
    const tileWidth = repeatX ? Math.abs(width) / sSpan : Math.abs(width);
    const tileHeight = repeatY ? Math.abs(height) / tSpan : Math.abs(height);
    const surface = this.getWrappedSurface(
      texture,
      binding.textureName,
      sourceRect,
      repeatX,
      repeatY,
      tileWidth,
      tileHeight,
      width,
      height,
    );
    const repeatMode = repeatX && repeatY ? "repeat" : repeatX ? "repeat-x" : "repeat-y";
    const pattern = context.createPattern(surface, repeatMode);
    if (pattern) {
      context.save();
      context.translate(-width / 2, -height / 2);
      context.fillStyle = pattern;
      context.fillRect(0, 0, width, height);
      context.restore();
      return;
    }
  }

  if (sourceRect) {
    context.drawImage(
      texture,
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      -width / 2,
      -height / 2,
      width,
      height,
    );
    return;
  }

  context.drawImage(texture, -width / 2, -height / 2, width, height);
}

export function drawPane(context, binding, pane, width, height) {
  if (this.shouldTreatPaneAsLumaMask(pane, binding)) {
    if (this.drawPaneAsLumaMask(context, binding, pane, width, height)) {
      return;
    }
  }

  if (this.shouldTreatPaneAsLumaOverlay(pane, binding)) {
    if (this.drawPaneAsLumaOverlay(context, binding, pane, width, height)) {
      return;
    }
  }

  const vertexModulation = this.getPaneVertexColorModulation(pane);
  const materialModulation = this.getPaneMaterialColorModulation(pane);
  if (!vertexModulation && !materialModulation) {
    this.drawPaneTexture(context, binding, pane, width, height);
    return;
  }

  const absWidth = Math.abs(width);
  const absHeight = Math.abs(height);
  if (absWidth < 1e-6 || absHeight < 1e-6) {
    return;
  }

  const surfaceWidth = Math.max(1, Math.ceil(absWidth));
  const surfaceHeight = Math.max(1, Math.ceil(absHeight));
  if (!this.paneCompositeSurface) {
    this.paneCompositeSurface = document.createElement("canvas");
    this.paneCompositeContext = this.paneCompositeSurface.getContext("2d");
  }

  if (this.paneCompositeSurface.width !== surfaceWidth || this.paneCompositeSurface.height !== surfaceHeight) {
    this.paneCompositeSurface.width = surfaceWidth;
    this.paneCompositeSurface.height = surfaceHeight;
  }

  const paneContext = this.paneCompositeContext;
  paneContext.setTransform(1, 0, 0, 1, 0, 0);
  paneContext.clearRect(0, 0, surfaceWidth, surfaceHeight);
  paneContext.imageSmoothingEnabled = true;
  paneContext.imageSmoothingQuality = "high";
  paneContext.save();
  paneContext.translate(surfaceWidth / 2, surfaceHeight / 2);
  this.drawPaneTexture(paneContext, binding, pane, surfaceWidth, surfaceHeight);
  this.applyPaneMaterialColorModulation(paneContext, pane, surfaceWidth, surfaceHeight);
  this.applyPaneVertexColorModulation(paneContext, pane, surfaceWidth, surfaceHeight);
  paneContext.restore();

  context.drawImage(this.paneCompositeSurface, -width / 2, -height / 2, width, height);
}

export function drawTextPane(context, pane, width, height) {
  const rawText = typeof pane?.text === "string" ? pane.text : "";
  if (rawText.length === 0) {
    return;
  }

  const absWidth = Math.abs(width);
  const absHeight = Math.abs(height);
  if (absWidth < 1e-6 || absHeight < 1e-6) {
    return;
  }

  const lines = rawText.replace(/\r/g, "").split("\n");
  if (lines.length === 0) {
    return;
  }

  const fontSize = Math.max(1, Number.isFinite(pane?.textSize?.y) ? pane.textSize.y : absHeight * 0.45);
  const lineSpacing = Number.isFinite(pane?.lineSpacing) ? pane.lineSpacing : 0;
  const lineHeight = Math.max(1, fontSize + lineSpacing);
  const contentHeight = lineHeight * lines.length;

  let textAlign = "left";
  if (pane?.textAlignment === 1) {
    textAlign = "center";
  } else if (pane?.textAlignment === 2) {
    textAlign = "right";
  }

  const boxLeft = -width / 2;
  const boxTop = -height / 2;
  const textX = textAlign === "center" ? 0 : textAlign === "right" ? width / 2 : boxLeft;
  const textY = boxTop + Math.max(0, (height - contentHeight) / 2);

  const topColor = pane?.textTopColor ?? { r: 32, g: 32, b: 32, a: 255 };
  const bottomColor = pane?.textBottomColor ?? topColor;

  context.save();
  context.textBaseline = "top";
  context.textAlign = textAlign;
  context.font = `${fontSize}px sans-serif`;

  const sameColor =
    topColor.r === bottomColor.r &&
    topColor.g === bottomColor.g &&
    topColor.b === bottomColor.b &&
    topColor.a === bottomColor.a;

  if (sameColor) {
    context.fillStyle = buildCssColor(topColor);
  } else {
    const gradient = context.createLinearGradient(0, boxTop, 0, boxTop + height);
    gradient.addColorStop(0, buildCssColor(topColor));
    gradient.addColorStop(1, buildCssColor(bottomColor));
    context.fillStyle = gradient;
  }

  for (let i = 0; i < lines.length; i += 1) {
    context.fillText(lines[i], textX, textY + i * lineHeight, absWidth);
  }
  context.restore();
}

export function renderFrame(frame) {
  const context = this.ctx;
  const layoutWidth = this.layout.width || this.canvas.clientWidth || this.canvas.width;
  const layoutHeight = this.layout.height || this.canvas.clientHeight || this.canvas.height;
  const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.round(layoutWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(layoutHeight * dpr));

  if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
  }
  if (this.canvas.style) {
    this.canvas.style.width = `${layoutWidth}px`;
    this.canvas.style.height = `${layoutHeight}px`;
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  context.clearRect(0, 0, layoutWidth, layoutHeight);

  const localPaneStates = new Map();
  for (const pane of this.layout.panes) {
    localPaneStates.set(pane, this.getLocalPaneState(pane, frame));
  }

  const renderablePanes = this.layout.panes.filter((pane) => pane.type === "pic1" || pane.type === "txt1");

  for (const pane of renderablePanes) {
    if (!this.shouldRenderPaneForLocale(pane)) {
      continue;
    }

    const paneState = localPaneStates.get(pane);
    if (!paneState) {
      continue;
    }

    let alpha = 1;
    const transformChain = this.getPaneTransformChain(pane);

    context.save();
    context.translate(layoutWidth / 2, layoutHeight / 2);

    for (const chainPane of transformChain) {
      const chainState = localPaneStates.get(chainPane);
      if (!chainState) {
        continue;
      }

      alpha *= chainState.alpha;
      if (alpha <= 0) {
        break;
      }

      context.translate(chainState.tx, -chainState.ty);
      if (chainState.rotation !== 0) {
        context.rotate((chainState.rotation * Math.PI) / 180);
      }
      context.scale(chainState.sx, chainState.sy);
    }

    if (alpha <= 0) {
      context.restore();
      continue;
    }

    context.globalAlpha = Math.max(0, Math.min(1, alpha));

    if (pane.type === "pic1") {
      const binding = this.getTextureBindingForPane(pane);
      if (!binding) {
        context.restore();
        continue;
      }
      this.drawPane(context, binding, pane, paneState.width, paneState.height);
    } else if (pane.type === "txt1") {
      this.drawTextPane(context, pane, paneState.width, paneState.height);
    }

    context.restore();
  }
}

export function render() {
  this.applyFrame(this.frame);
}

export function play() {
  if (this.playing) {
    return;
  }

  this.playing = true;

  if (this.useGsap && !this.sequenceEnabled) {
    this.ensureGsapTimeline();
    if (this.gsapTimeline) {
      this.gsapTimeline.play();
      return;
    }
  }

  this.lastTime = performance.now();

  const tick = (now) => {
    if (!this.playing) {
      return;
    }

    const delta = now - this.lastTime;
    if (delta >= 1000 / this.fps) {
      this.lastTime = now;
      this.advanceFrame();
    }

    this.animationId = requestAnimationFrame(tick);
  };

  this.animationId = requestAnimationFrame(tick);
}

export function stop() {
  this.playing = false;
  if (this.gsapTimeline) {
    this.gsapTimeline.pause();
  }
  if (this.animationId) {
    cancelAnimationFrame(this.animationId);
    this.animationId = null;
  }
}

export function reset() {
  if (this.sequenceEnabled && this.startAnim) {
    this.setActiveAnim(this.startAnim, "start");
  }
  this.frame = this.normalizeFrame(this.startFrame);
  this.gsapDriver.frame = this.frame;
  if (this.gsapTimeline) {
    this.gsapTimeline.pause(0);
  }
  this.applyFrame(this.frame);
}

export function dispose() {
  this.stop();
  if (this.gsapTimeline) {
    this.gsapTimeline.kill();
    this.gsapTimeline = null;
  }
  this.patternTextureCache.clear();
  this.textureMaskCache.clear();
  this.lumaAlphaTextureCache.clear();
  this.materialColorModulationCache = new WeakMap();
  this.vertexColorModulationCache = new WeakMap();
  this.paneCompositeSurface = null;
  this.paneCompositeContext = null;
}
