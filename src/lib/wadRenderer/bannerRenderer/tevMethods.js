import { evaluateTevPipeline, isTevIdentityPassthrough, isTevModulatePattern } from "./tevEvaluator.js";
import { normalizePaneVertexColors } from "./renderColorUtils.js";

// Check whether a pane's material has non-trivial TEV stages that require the per-pixel pipeline.
// Only activates for multi-texture materials where the stages reference more than one texture,
// since single-texture materials are already handled well by the existing Canvas 2D heuristic path.
export function shouldUseTevPipeline(pane) {
  if (!Number.isInteger(pane?.materialIndex) || pane.materialIndex < 0) {
    return false;
  }
  const material = this.layout?.materials?.[pane.materialIndex];
  if (!material) {
    return false;
  }
  const stages = material.tevStages;
  if (!stages || stages.length === 0) {
    return false;
  }
  if (isTevIdentityPassthrough(stages)) {
    return false;
  }
  // Only use TEV for materials with multiple texture maps where stages reference different textures.
  // Single-texture materials are handled correctly by the existing Canvas path.
  const textureMaps = material.textureMaps ?? [];
  if (textureMaps.length <= 1) {
    return false;
  }
  // Check if stages actually reference more than one distinct texture slot.
  const referencedTexMaps = new Set();
  for (const stage of stages) {
    if (stage.texMap !== 0xff && stage.texMap < textureMaps.length) {
      referencedTexMaps.add(stage.texMap);
    }
  }
  if (referencedTexMaps.size <= 1) {
    return false;
  }
  return true;
}

// Get all texture bindings for a pane (one per texMap slot), needed for multi-texture TEV.
export function getAllTextureBindingsForPane(pane, paneState) {
  if (!Number.isInteger(pane?.materialIndex) || pane.materialIndex < 0) {
    return [];
  }
  const material = this.layout?.materials?.[pane.materialIndex];
  if (!material) {
    return [];
  }

  const animatedTextureSRTs = this.getPaneTextureSRTAnimations?.(pane?.name, this.frame) ?? null;
  const animatedTextureIndex = paneState?.textureIndex ?? null;
  const textureMaps = material.textureMaps ?? [];
  const textureSRTs = material.textureSRTs ?? [];
  const bindings = [];

  for (let mapIndex = 0; mapIndex < textureMaps.length; mapIndex += 1) {
    const textureMap = textureMaps[mapIndex];
    const textureIndex = (animatedTextureIndex != null && mapIndex === 0)
      ? animatedTextureIndex
      : textureMap.textureIndex;

    if (textureIndex < 0 || textureIndex >= this.layout.textures.length) {
      bindings.push(null);
      continue;
    }

    const textureName = this.layout.textures[textureIndex];
    if (!this.textureCanvases[textureName]) {
      bindings.push(null);
      continue;
    }

    const animatedTextureSRT = animatedTextureSRTs?.get(mapIndex) ?? null;
    const staticSRT = textureSRTs[mapIndex] ?? null;
    let mergedSRT = staticSRT;
    if (animatedTextureSRT) {
      mergedSRT = mergedSRT
        ? {
            xTrans: (mergedSRT.xTrans ?? 0) + (animatedTextureSRT.xTrans ?? 0),
            yTrans: (mergedSRT.yTrans ?? 0) + (animatedTextureSRT.yTrans ?? 0),
            rotation: (mergedSRT.rotation ?? 0) + (animatedTextureSRT.rotation ?? 0),
            xScale: (mergedSRT.xScale ?? 1) * (animatedTextureSRT.xScale ?? 1),
            yScale: (mergedSRT.yScale ?? 1) * (animatedTextureSRT.yScale ?? 1),
          }
        : animatedTextureSRT;
    }

    bindings.push({
      texture: this.textureCanvases[textureName],
      textureName,
      wrapS: textureMap.wrapS ?? 0,
      wrapT: textureMap.wrapT ?? 0,
      textureSRT: mergedSRT,
      texCoordIndex: mapIndex,
    });
  }

  return bindings;
}

// Build a rasterized vertex color buffer as ImageData-like object.
function buildRasterizedColorBuffer(pane, paneState, width, height) {
  const colors = paneState?.vertexColors
    ? normalizePaneVertexColors({ vertexColors: paneState.vertexColors })
    : normalizePaneVertexColors(pane);

  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const data = new Uint8ClampedArray(w * h * 4);

  if (!colors) {
    // Default: white opaque.
    data.fill(255);
    return { data, width: w, height: h };
  }

  const [tl, tr, bl, br] = colors;
  for (let y = 0; y < h; y += 1) {
    const v = h <= 1 ? 0 : y / (h - 1);
    for (let x = 0; x < w; x += 1) {
      const u = w <= 1 ? 0 : x / (w - 1);
      const topR = tl.r + (tr.r - tl.r) * u;
      const topG = tl.g + (tr.g - tl.g) * u;
      const topB = tl.b + (tr.b - tl.b) * u;
      const topA = tl.a + (tr.a - tl.a) * u;
      const botR = bl.r + (br.r - bl.r) * u;
      const botG = bl.g + (br.g - bl.g) * u;
      const botB = bl.b + (br.b - bl.b) * u;
      const botA = bl.a + (br.a - bl.a) * u;
      const idx = (y * w + x) * 4;
      data[idx] = Math.round(topR + (botR - topR) * v);
      data[idx + 1] = Math.round(topG + (botG - topG) * v);
      data[idx + 2] = Math.round(topB + (botB - topB) * v);
      data[idx + 3] = Math.round(topA + (botA - topA) * v);
    }
  }

  return { data, width: w, height: h };
}

// Sample a texture binding into an ImageData-like buffer at the given pane dimensions.
function sampleTextureToBuffer(renderer, binding, pane, width, height) {
  if (!binding?.texture) {
    return null;
  }

  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));

  // Use an offscreen canvas to render the texture with proper wrap modes and SRT transforms.
  if (!renderer.tevSampleSurface) {
    renderer.tevSampleSurface = document.createElement("canvas");
    renderer.tevSampleContext = renderer.tevSampleSurface.getContext("2d", { willReadFrequently: true });
  }

  if (renderer.tevSampleSurface.width !== w || renderer.tevSampleSurface.height !== h) {
    renderer.tevSampleSurface.width = w;
    renderer.tevSampleSurface.height = h;
  }

  const ctx = renderer.tevSampleContext;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.save();
  ctx.translate(w / 2, h / 2);
  renderer.drawPaneTexture(ctx, binding, pane, w, h);
  ctx.restore();

  return ctx.getImageData(0, 0, w, h);
}

// Run the full TEV pipeline for a pane and return the result ImageData.
export function runTevPipeline(pane, paneState, width, height) {
  if (width < 1 || height < 1) {
    return null;
  }

  const material = this.layout?.materials?.[pane.materialIndex];
  if (!material?.tevStages?.length) {
    return null;
  }

  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));

  // For the common modulate pattern (tex * ras), use the fast Canvas 2D path.
  if (isTevModulatePattern(material.tevStages)) {
    return null; // Fall through to existing heuristic path which handles modulate well.
  }

  // Get all texture bindings.
  const bindings = this.getAllTextureBindingsForPane(pane, paneState);

  // Sample each texture into a buffer.
  const textureBuffers = [];
  for (let i = 0; i < bindings.length; i += 1) {
    textureBuffers.push(sampleTextureToBuffer(this, bindings[i], pane, w, h));
  }

  // Build rasterized vertex color buffer.
  const rasBuffer = buildRasterizedColorBuffer(pane, paneState, w, h);

  // Run per-pixel TEV evaluation.
  const result = evaluateTevPipeline(material.tevStages, material, textureBuffers, rasBuffer, w, h);

  return result;
}

// Draw the TEV pipeline result to the rendering context.
export function drawTevResult(context, tevResult, width, height) {
  if (!tevResult) {
    return;
  }

  const w = tevResult.width;
  const h = tevResult.height;

  if (!this.tevResultSurface) {
    this.tevResultSurface = document.createElement("canvas");
    this.tevResultContext = this.tevResultSurface.getContext("2d");
  }

  if (this.tevResultSurface.width !== w || this.tevResultSurface.height !== h) {
    this.tevResultSurface.width = w;
    this.tevResultSurface.height = h;
  }

  const imageData = new ImageData(tevResult.data, w, h);
  this.tevResultContext.putImageData(imageData, 0, 0);
  context.drawImage(this.tevResultSurface, -width / 2, -height / 2, width, height);
}
