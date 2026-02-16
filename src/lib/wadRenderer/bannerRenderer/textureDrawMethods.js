import { resolveWrapMode, isTiledWrapMode } from "./renderColorUtils";

export function getWrappedSurface(
  texture,
  textureName,
  sourceRect,
  wrapModeX,
  wrapModeY,
  tileWidth,
  tileHeight,
  targetWidth,
  targetHeight,
) {
  const repeatX = wrapModeX !== "clamp";
  const repeatY = wrapModeY !== "clamp";
  const src = sourceRect ?? { x: 0, y: 0, width: texture.width, height: texture.height };
  const safeTileWidth = Math.max(1, Math.round(tileWidth));
  const safeTileHeight = Math.max(1, Math.round(tileHeight));
  const safeTargetWidth = Math.max(1, Math.round(targetWidth));
  const safeTargetHeight = Math.max(1, Math.round(targetHeight));
  const mirrorX = wrapModeX === "mirror";
  const mirrorY = wrapModeY === "mirror";
  const tileWidthWithMirror = safeTileWidth * (mirrorX ? 2 : 1);
  const tileHeightWithMirror = safeTileHeight * (mirrorY ? 2 : 1);
  const key = [
    textureName,
    src.x,
    src.y,
    src.width,
    src.height,
    wrapModeX,
    wrapModeY,
    safeTileWidth,
    safeTileHeight,
    safeTargetWidth,
    safeTargetHeight,
  ].join(":");

  const cached = this.patternTextureCache.get(key);
  if (cached) {
    // Refresh insertion order for LRU eviction.
    this.patternTextureCache.delete(key);
    this.patternTextureCache.set(key, cached);
    return cached;
  }

  const surface = document.createElement("canvas");

  if (repeatX && repeatY) {
    surface.width = tileWidthWithMirror;
    surface.height = tileHeightWithMirror;
  } else if (repeatX) {
    surface.width = tileWidthWithMirror;
    surface.height = safeTargetHeight;
  } else {
    surface.width = safeTargetWidth;
    surface.height = tileHeightWithMirror;
  }

  const drawContext = surface.getContext("2d");
  const cellWidth = repeatX ? safeTileWidth : surface.width;
  const cellHeight = repeatY ? safeTileHeight : surface.height;
  const drawCell = (x, y, flipX, flipY) => {
    drawContext.save();
    drawContext.translate(x + (flipX ? cellWidth : 0), y + (flipY ? cellHeight : 0));
    drawContext.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    drawContext.drawImage(texture, src.x, src.y, src.width, src.height, 0, 0, cellWidth, cellHeight);
    drawContext.restore();
  };

  drawCell(0, 0, false, false);
  if (mirrorX) {
    drawCell(cellWidth, 0, true, false);
  }
  if (mirrorY) {
    drawCell(0, cellHeight, false, true);
  }
  if (mirrorX && mirrorY) {
    drawCell(cellWidth, cellHeight, true, true);
  }

  this.patternTextureCache.set(key, surface);
  while (this.patternTextureCache.size > this.patternTextureCacheLimit) {
    const oldestKey = this.patternTextureCache.keys().next().value;
    if (oldestKey == null) {
      break;
    }
    this.patternTextureCache.delete(oldestKey);
  }
  return surface;
}

export function drawPaneTextureWithVerticalClamp(context, binding, pane, width, height) {
  const texture = binding.texture;
  const textureSRT = binding.textureSRT ?? null;
  const texCoordIndex = binding.texCoordIndex ?? 0;
  const transformed = this.getTransformedTexCoords(pane, textureSRT, texCoordIndex);
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

  const wrapModeS = resolveWrapMode(binding.wrapS);
  const wrapModeT = resolveWrapMode(binding.wrapT);
  const repeatX = wrapModeS !== "clamp";
  const repeatY = wrapModeT !== "clamp";
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
      texCoordIndex,
    }) ?? { x: 0, y: 0, width: texture.width, height: texture.height };

  const spans = this.getTexCoordSpans(pane, textureSRT, texCoordIndex);
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
      wrapModeS,
      "clamp",
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
  const wrapModeS = resolveWrapMode(binding.wrapS);
  const wrapModeT = resolveWrapMode(binding.wrapT);
  const repeatX = isTiledWrapMode(binding.wrapS);
  const repeatY = isTiledWrapMode(binding.wrapT);
  const textureSRT = binding.textureSRT ?? null;
  const texCoordIndex = binding.texCoordIndex ?? 0;

  if (this.drawPaneTextureWithVerticalClamp(context, binding, pane, width, height)) {
    return;
  }

  const sourceRect = this.getSourceRectForPane(pane, texture, {
    forceNormalized: repeatX || repeatY,
    repeatX,
    repeatY,
    textureSRT,
    texCoordIndex,
  });
  if (repeatX || repeatY) {
    const spans = this.getTexCoordSpans(pane, textureSRT, texCoordIndex);
    const sSpan = repeatX ? spans?.spanS ?? 1 : 1;
    const tSpan = repeatY ? spans?.spanT ?? 1 : 1;
    const tileWidth = repeatX ? Math.abs(width) / sSpan : Math.abs(width);
    const tileHeight = repeatY ? Math.abs(height) / tSpan : Math.abs(height);
    const surface = this.getWrappedSurface(
      texture,
      binding.textureName,
      sourceRect,
      wrapModeS,
      wrapModeT,
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
      context.fillRect(-0.5, -0.5, width + 1, height + 1);
      context.restore();
      return;
    }
  }

  // Expand by 0.5px on each side to cover Canvas 2D anti-aliasing seams between adjacent panes
  const pad = 0.5;
  if (sourceRect) {
    context.drawImage(
      texture,
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      -width / 2 - pad,
      -height / 2 - pad,
      width + 2 * pad,
      height + 2 * pad,
    );
    return;
  }

  context.drawImage(texture, -width / 2 - pad, -height / 2 - pad, width + 2 * pad, height + 2 * pad);
}
