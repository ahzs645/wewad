import { evaluateTevPipeline, isTevIdentityPassthrough, isTevModulatePattern, getDefaultTevStages, getModulateTevStages } from "./tevEvaluator.js";
import { normalizePaneVertexColors } from "./renderColorUtils.js";

// Resolve the effective TEV stages for a material.
// If the material has explicit stages, use them. Otherwise, use the default 2-stage setup.
function getEffectiveTevStages(material) {
  const stages = material?.tevStages;
  if (stages && stages.length > 0) {
    return stages;
  }
  return getDefaultTevStages();
}

// Check whether an alpha compare setting always passes (trivial / no-op).
function isAlphaCompareAlwaysPass(alphaCompare) {
  if (!alphaCompare) {
    return true;
  }
  const alwaysPasses = (condition, ref) => {
    if (condition === 7) return true;             // ALWAYS
    if (condition === 6 && ref === 0) return true; // GEQUAL 0 (alpha is always >= 0)
    if (condition === 3 && ref === 255) return true; // LEQUAL 255 (alpha is always <= 255)
    return false;
  };
  const pass0 = alwaysPasses(alphaCompare.condition0, alphaCompare.value0);
  const pass1 = alwaysPasses(alphaCompare.condition1, alphaCompare.value1);
  if (pass0 && pass1) return true;
  // OR: if either always passes, combined result always passes.
  if (alphaCompare.operation === 1 && (pass0 || pass1)) return true;
  return false;
}

// Check whether a pane's material should use the per-pixel TEV pipeline.
// Activates for:
//   - Materials with explicit non-trivial TEV stages (any texture count)
//   - Materials with non-trivial alpha compare (alpha test only runs in TEV pipeline)
// Simple materials without alpha compare use the Canvas 2D heuristic path.
export function shouldUseTevPipeline(pane) {
  if (!Number.isInteger(pane?.materialIndex) || pane.materialIndex < 0) {
    return false;
  }
  const material = this.layout?.materials?.[pane.materialIndex];
  if (!material) {
    return false;
  }

  const needsAlphaCompare = !isAlphaCompareAlwaysPass(material?.alphaCompare);
  const explicitStages = material.tevStages;
  const hasExplicitStages = explicitStages && explicitStages.length > 0;
  const textureMaps = material.textureMaps ?? [];

  if (hasExplicitStages) {
    // Skip trivial identity passthrough — Canvas 2D handles it fine (unless alpha compare is needed).
    if (isTevIdentityPassthrough(explicitStages) && !needsAlphaCompare) {
      return false;
    }
    // Skip common modulate pattern for single-texture — Canvas 2D handles it well (unless alpha compare is needed).
    if (textureMaps.length <= 1 && isTevModulatePattern(explicitStages) && !needsAlphaCompare) {
      return false;
    }
    return true;
  }

  // No explicit stages: use TEV pipeline only if alpha compare requires per-pixel processing.
  if (needsAlphaCompare) {
    return true;
  }

  return false;
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

// Build a cache key for the TEV result of a pane at its current visual state.
function buildTevCacheKey(pane, paneState, bindings, w, h) {
  let key = `${w}|${h}`;
  const colors = paneState?.vertexColors ?? pane?.vertexColors;
  if (colors) {
    for (let i = 0; i < colors.length; i += 1) {
      const c = colors[i];
      key += `|${c.r},${c.g},${c.b},${c.a}`;
    }
  }
  for (let i = 0; i < bindings.length; i += 1) {
    const b = bindings[i];
    if (!b) { key += "|null"; continue; }
    key += `|${b.textureName}|${b.wrapS},${b.wrapT}`;
    const srt = b.textureSRT;
    if (srt) {
      key += `|${srt.xTrans ?? 0},${srt.yTrans ?? 0},${srt.rotation ?? 0},${srt.xScale ?? 1},${srt.yScale ?? 1}`;
    }
  }
  return key;
}

// Run the full TEV pipeline for a pane and return the result ImageData.
export function runTevPipeline(pane, paneState, width, height) {
  if (width < 1 || height < 1) {
    return null;
  }

  const material = this.layout?.materials?.[pane.materialIndex];
  if (!material) {
    return null;
  }

  // Use explicit stages; modulate fallback (tex × ras) for materials routed here only for alpha compare.
  const stages = material.tevStages?.length > 0 ? material.tevStages : getModulateTevStages();
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));

  // Get all texture bindings.
  const bindings = this.getAllTextureBindingsForPane(pane, paneState);

  // In "fast" mode: check result cache and downscale evaluation resolution.
  const useFastPath = this.tevQuality === "fast";
  let cacheKey = null;
  if (useFastPath) {
    cacheKey = buildTevCacheKey(pane, paneState, bindings, w, h);
    const cached = this.tevResultCache.get(pane.name);
    if (cached && cached.key === cacheKey) {
      return cached.result;
    }
  }

  // Compute evaluation dimensions (downscale in fast mode).
  const maxRes = this.tevMaxResolution ?? Infinity;
  const maxDim = Math.max(w, h);
  const scale = maxDim > maxRes ? maxRes / maxDim : 1;
  const evalW = Math.max(1, Math.round(w * scale));
  const evalH = Math.max(1, Math.round(h * scale));

  // Sample each texture into a buffer at evaluation resolution.
  const textureBuffers = [];
  for (let i = 0; i < bindings.length; i += 1) {
    textureBuffers.push(sampleTextureToBuffer(this, bindings[i], pane, evalW, evalH));
  }

  // Build rasterized vertex color buffer at evaluation resolution.
  const rasBuffer = buildRasterizedColorBuffer(pane, paneState, evalW, evalH);

  // Run per-pixel TEV evaluation with effective stages (may be default if none defined).
  const result = evaluateTevPipeline(stages, material, textureBuffers, rasBuffer, evalW, evalH);

  if (useFastPath && cacheKey) {
    this.tevResultCache.set(pane.name, { key: cacheKey, result });
  }

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
