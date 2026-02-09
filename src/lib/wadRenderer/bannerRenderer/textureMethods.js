import { isLikelyAlphaOnlyTitleMask } from "./locale";

function mergeTextureSRT(base, animated) {
  if (!base && !animated) {
    return null;
  }

  return {
    xTrans: Number.isFinite(animated?.xTrans) ? animated.xTrans : base?.xTrans ?? 0,
    yTrans: Number.isFinite(animated?.yTrans) ? animated.yTrans : base?.yTrans ?? 0,
    rotation: Number.isFinite(animated?.rotation) ? animated.rotation : base?.rotation ?? 0,
    xScale: Number.isFinite(animated?.xScale) ? animated.xScale : base?.xScale ?? 1,
    yScale: Number.isFinite(animated?.yScale) ? animated.yScale : base?.yScale ?? 1,
  };
}

export function prepareTextures() {
  for (const [name, images] of Object.entries(this.tplImages)) {
    if (!images.length) {
      continue;
    }

    const image = images[0];
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;

    const context = canvas.getContext("2d");
    context.putImageData(new ImageData(image.imageData, image.width, image.height), 0, 0);

    this.textureCanvases[name] = canvas;
    this.textureFormats[name] = image.format;
  }
}

export function getTextureFormat(textureName) {
  return this.textureFormats[textureName] ?? null;
}

export function getLumaAlphaTexture(textureName, options = {}) {
  const mode = options.mode ?? "threshold";
  const alphaScale = Number.isFinite(options.alphaScale) ? Math.max(0, options.alphaScale) : 1;
  const key = `${textureName}|luma-alpha|${mode}|scale:${alphaScale}`;
  const cached = this.lumaAlphaTextureCache.get(key);
  if (cached) {
    return cached;
  }

  const source = this.textureCanvases[textureName];
  if (!source) {
    return null;
  }

  const width = source.width;
  const height = source.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(source, 0, 0);

  const imageData = context.getImageData(0, 0, width, height);
  const out = imageData.data;
  let maxLuma = 0;
  for (let i = 0; i < out.length; i += 4) {
    const luma = Math.max(out[i], out[i + 1], out[i + 2]);
    if (luma > maxLuma) {
      maxLuma = luma;
    }
  }

  // Different panes need different luma -> alpha behavior:
  // - threshold: preserve soft AA edges but avoid interior dark shading (Ch2)
  // - linear: preserve grayscale scanline/translucency patterns (logoBg/TVline)
  // - binary: keep every non-zero texel fully opaque
  const softEdgeLuma = Math.max(1, Math.round(maxLuma * 0.08));
  for (let i = 0; i < out.length; i += 4) {
    const luma = Math.max(out[i], out[i + 1], out[i + 2]);
    let alpha;
    if (mode === "linear") {
      alpha = luma;
    } else if (mode === "binary") {
      alpha = luma > 0 ? 255 : 0;
    } else {
      alpha = 0;
      if (luma > 0) {
        alpha = luma >= softEdgeLuma ? 255 : Math.round((luma * 255) / softEdgeLuma);
      }
    }
    out[i] = 255;
    out[i + 1] = 255;
    out[i + 2] = 255;
    out[i + 3] = clampByte(alpha * alphaScale);
  }

  context.putImageData(imageData, 0, 0);
  this.lumaAlphaTextureCache.set(key, canvas);
  return canvas;
}

function clampByte(value, fallback = 0) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseKeyColor(color) {
  if (!Array.isArray(color) || color.length < 3) {
    return null;
  }
  return {
    r: clampByte(color[0]),
    g: clampByte(color[1]),
    b: clampByte(color[2]),
  };
}

function hasStandaloneAlphaMaskModulation(pane, material) {
  const paneAlpha = clampByte(pane?.alpha ?? 255);
  if (paneAlpha !== 255) {
    return true;
  }

  const vertexColors = pane?.vertexColors;
  if (Array.isArray(vertexColors) && vertexColors.length === 4) {
    for (const color of vertexColors) {
      if (
        clampByte(color?.r, 255) !== 255 ||
        clampByte(color?.g, 255) !== 255 ||
        clampByte(color?.b, 255) !== 255 ||
        clampByte(color?.a, 255) !== 255
      ) {
        return true;
      }
    }
  }

  const color2 = Array.isArray(material?.color2) ? material.color2 : null;
  if (color2 && color2.length >= 4) {
    if (
      clampByte(color2[0]) !== 255 ||
      clampByte(color2[1]) !== 255 ||
      clampByte(color2[2]) !== 255 ||
      clampByte(color2[3]) !== 255
    ) {
      return true;
    }
  }

  return false;
}

function shouldSkipStandaloneAlphaMask(pane, material, textureName, format) {
  if (format !== 0 || !isLikelyAlphaOnlyTitleMask(textureName)) {
    return false;
  }

  // Keep alpha-only masks when the pane/material applies tint/alpha modulation,
  // which is how locale title shadows are authored (e.g. N_ShaUS_00 letters).
  return !hasStandaloneAlphaMaskModulation(pane, material);
}

function shouldTreatI4AsLumaAlphaMask(pane, material, textureName, format) {
  if (format !== 0) {
    return false;
  }

  const paneNameLower = String(pane?.name ?? "").toLowerCase();
  const textureLower = String(textureName ?? "").toLowerCase();
  if (paneNameLower.includes("ninlogo") || textureLower.includes("nintendo")) {
    return true;
  }

  if (isLikelyAlphaOnlyTitleMask(textureName)) {
    return true;
  }

  const color1 = Array.isArray(material?.color1) ? material.color1 : null;
  if (!color1 || color1.length < 4 || clampByte(color1[3], 255) !== 0) {
    return false;
  }

  const color2 = Array.isArray(material?.color2) ? material.color2 : null;
  if (color2 && color2.length >= 3) {
    const r = clampByte(color2[0], 255);
    const g = clampByte(color2[1], 255);
    const b = clampByte(color2[2], 255);
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    // Avoid solid-dark art like the Nintendo badge where I4 is not used as a mask.
    if (luma < 24) {
      return false;
    }
  }

  return true;
}

function getCornerAverageColor(data, width, height) {
  const points = [
    [0, 0],
    [Math.max(0, width - 1), 0],
    [0, Math.max(0, height - 1)],
    [Math.max(0, width - 1), Math.max(0, height - 1)],
  ];

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (const [x, y] of points) {
    const offset = (y * width + x) * 4;
    sumR += data[offset];
    sumG += data[offset + 1];
    sumB += data[offset + 2];
  }

  return {
    r: clampByte(sumR / points.length),
    g: clampByte(sumG / points.length),
    b: clampByte(sumB / points.length),
  };
}

export function getChromaKeyTexture(textureName, options = {}) {
  const lowThreshold = Number.isFinite(options.lowThreshold) ? Math.max(0, options.lowThreshold) : 10;
  const highThreshold = Number.isFinite(options.highThreshold) ? Math.max(lowThreshold + 1, options.highThreshold) : 42;
  const maskTextureName = typeof options.maskTextureName === "string" && options.maskTextureName.length > 0 ? options.maskTextureName : null;
  const outlineThreshold = Number.isFinite(options.outlineThreshold) ? Math.max(0, options.outlineThreshold) : 240;
  const outlineStrength = Number.isFinite(options.outlineStrength) ? Math.max(0, options.outlineStrength) : 5;
  const maxOutlineAlpha = Number.isFinite(options.maxOutlineAlpha) ? Math.max(0, options.maxOutlineAlpha) : 96;
  const explicitKey = parseKeyColor(options.keyColor);
  const keyColorPart = explicitKey ? `${explicitKey.r},${explicitKey.g},${explicitKey.b}` : "auto";
  const key = [
    textureName,
    "chroma",
    keyColorPart,
    lowThreshold,
    highThreshold,
    maskTextureName ?? "no-mask",
    outlineThreshold,
    outlineStrength,
    maxOutlineAlpha,
  ].join("|");
  const cached = this.textureMaskCache.get(key);
  if (cached) {
    return cached;
  }

  const source = this.textureCanvases[textureName];
  if (!source) {
    return null;
  }

  const width = source.width;
  const height = source.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(source, 0, 0);

  const imageData = context.getImageData(0, 0, width, height);
  const out = imageData.data;
  const keyColor = explicitKey ?? getCornerAverageColor(out, width, height);
  const thresholdRange = Math.max(1, highThreshold - lowThreshold);
  let maskData = null;
  if (maskTextureName) {
    const maskSource = this.textureCanvases[maskTextureName];
    if (maskSource && maskSource.width === width && maskSource.height === height) {
      maskData = maskSource.getContext("2d").getImageData(0, 0, width, height).data;
    }
  }

  for (let i = 0; i < out.length; i += 4) {
    const dr = out[i] - keyColor.r;
    const dg = out[i + 1] - keyColor.g;
    const db = out[i + 2] - keyColor.b;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    let alpha = 0;
    if (distance >= highThreshold) {
      alpha = 255;
    } else if (distance > lowThreshold) {
      alpha = Math.round(((distance - lowThreshold) * 255) / thresholdRange);
    }

    if (maskData) {
      const maskLuma = Math.max(maskData[i], maskData[i + 1], maskData[i + 2]);
      const outlineAlpha = Math.min(maxOutlineAlpha, Math.max(0, Math.round((maskLuma - outlineThreshold) * outlineStrength)));
      if (outlineAlpha > alpha) {
        alpha = outlineAlpha;
      }
    }

    out[i + 3] = alpha;
  }

  context.putImageData(imageData, 0, 0);
  this.textureMaskCache.set(key, canvas);
  return canvas;
}

export function getMaskedTexture(baseTextureName, maskTextureName, options = {}) {
  const invertMask = options.invertMask === true;
  const key = `${baseTextureName}|${maskTextureName}|inv:${invertMask ? 1 : 0}`;
  const cached = this.textureMaskCache.get(key);
  if (cached) {
    return cached;
  }

  const base = this.textureCanvases[baseTextureName];
  const mask = this.textureCanvases[maskTextureName];
  if (!base || !mask || base.width !== mask.width || base.height !== mask.height) {
    return null;
  }

  const width = base.width;
  const height = base.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(base, 0, 0);

  const baseImageData = context.getImageData(0, 0, width, height);
  const maskData = mask.getContext("2d").getImageData(0, 0, width, height).data;
  const out = baseImageData.data;

  for (let i = 0; i < out.length; i += 4) {
    let maskAlpha = Math.max(maskData[i], maskData[i + 1], maskData[i + 2]);
    if (invertMask) {
      maskAlpha = 255 - maskAlpha;
    }
    out[i + 3] = (out[i + 3] * maskAlpha) / 255;
  }

  context.putImageData(baseImageData, 0, 0);
  this.textureMaskCache.set(key, canvas);
  return canvas;
}

export function getLumaRemapTexture(textureName, options = {}) {
  const dark = parseKeyColor(options.darkColor);
  const light = parseKeyColor(options.lightColor);
  if (!dark || !light) {
    return null;
  }

  const key = `${textureName}|luma-remap|${dark.r},${dark.g},${dark.b}|${light.r},${light.g},${light.b}`;
  const cached = this.textureMaskCache.get(key);
  if (cached) {
    return cached;
  }

  const source = this.textureCanvases[textureName];
  if (!source) {
    return null;
  }

  const width = source.width;
  const height = source.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(source, 0, 0);

  const imageData = context.getImageData(0, 0, width, height);
  const out = imageData.data;
  for (let i = 0; i < out.length; i += 4) {
    const luma = Math.max(out[i], out[i + 1], out[i + 2]) / 255;
    out[i] = clampByte(dark.r + (light.r - dark.r) * luma);
    out[i + 1] = clampByte(dark.g + (light.g - dark.g) * luma);
    out[i + 2] = clampByte(dark.b + (light.b - dark.b) * luma);
  }

  context.putImageData(imageData, 0, 0);
  this.textureMaskCache.set(key, canvas);
  return canvas;
}

function shouldApplyLumaRemap(pane, textureName, material, format) {
  const paneName = String(pane?.name ?? "");
  const textureKey = String(textureName ?? "");
  const isFaceTexture = /icon_face/i.test(textureKey) || /^P_face_/i.test(paneName);
  const isTitleLogoTexture = /titlelogo/i.test(textureKey) || /^P_title(?:Sh)?[A-Z]_/i.test(paneName);
  if (!isFaceTexture && !isTitleLogoTexture) {
    return false;
  }

  // Restrict remap to luma-encoded sources (IA8/CMPR used as grayscale masks).
  // Keeping this narrow avoids desaturating authored full-color atlases.
  if (format !== 2 && format !== 14) {
    return false;
  }

  const color1 = Array.isArray(material?.color1) ? material.color1 : null;
  const color2 = Array.isArray(material?.color2) ? material.color2 : null;
  if (!color1 || color1.length < 4 || !color2 || color2.length < 4) {
    return false;
  }

  if (clampByte(color1[3], 255) !== 0) {
    return false;
  }

  const c1r = clampByte(color1[0]);
  const c1g = clampByte(color1[1]);
  const c1b = clampByte(color1[2]);
  const c2r = clampByte(color2[0], 255);
  const c2g = clampByte(color2[1], 255);
  const c2b = clampByte(color2[2], 255);
  return c1r !== c2r || c1g !== c2g || c1b !== c2b;
}

function getLumaRemapColors(pane, material, textureName) {
  const color1 = Array.isArray(material?.color1) ? material.color1 : null;
  const color2 = Array.isArray(material?.color2) ? material.color2 : null;
  if (!color1 || color1.length < 3 || !color2 || color2.length < 3) {
    return null;
  }

  const paneName = String(pane?.name ?? "");
  const isFaceTexture = /icon_face/i.test(String(textureName ?? "")) || /^P_face_/i.test(paneName);
  if (isFaceTexture) {
    // Face atlases use darker texels for fill and brighter texels for line art.
    // Map dark -> color1 (white) and bright -> color2 (blue) for Wii Speak.
    return {
      darkColor: color1,
      lightColor: color2,
    };
  }

  return {
    darkColor: color1,
    lightColor: color2,
  };
}

export function getTextureBindingForPane(pane, paneState = null) {
  const animatedTextureSRTs = this.getPaneTextureSRTAnimations?.(pane?.name, this.frame) ?? null;
  const animatedTextureIndex = paneState?.textureIndex ?? null;

  if (pane.materialIndex >= 0 && pane.materialIndex < this.layout.materials.length) {
    const material = this.layout.materials[pane.materialIndex];
    const textureMaps = material?.textureMaps ?? [];
    const textureSRTs = material?.textureSRTs ?? [];
    const bindings = [];
    for (let mapIndex = 0; mapIndex < textureMaps.length; mapIndex += 1) {
      const textureMap = textureMaps[mapIndex];
      // RLTP animation overrides the texture index on the first map.
      const textureIndex = (animatedTextureIndex != null && mapIndex === 0)
        ? animatedTextureIndex
        : textureMap.textureIndex;
      if (textureIndex < 0 || textureIndex >= this.layout.textures.length) {
        continue;
      }

      const textureName = this.layout.textures[textureIndex];
      if (this.textureCanvases[textureName]) {
        const animatedTextureSRT = animatedTextureSRTs?.get(mapIndex) ?? null;
        bindings.push({
          texture: this.textureCanvases[textureName],
          textureName,
          material,
          wrapS: textureMap.wrapS ?? 0,
          wrapT: textureMap.wrapT ?? 0,
          textureSRT: mergeTextureSRT(textureSRTs[mapIndex] ?? null, animatedTextureSRT),
          texCoordIndex: mapIndex,
        });
      }
    }

    if (bindings.length > 0) {
      const primary =
        bindings.find((binding) => this.getTextureFormat(binding.textureName) !== 0) ?? bindings[0];
      const mask = bindings.find(
        (binding) =>
          binding.textureName !== primary.textureName &&
          this.getTextureFormat(binding.textureName) === 0 &&
          binding.texture.width === primary.texture.width &&
          binding.texture.height === primary.texture.height,
      );

      if (mask) {
        const color1 = Array.isArray(material?.color1) ? material.color1 : null;
        const paneName = String(pane?.name ?? "");
        const primaryFormat = this.getTextureFormat(primary.textureName);
        const maskFormat = this.getTextureFormat(mask.textureName);
        const shouldUseLogoChromaKey =
          /logo/i.test(paneName) &&
          primaryFormat === 14 &&
          maskFormat === 0 &&
          Array.isArray(color1) &&
          color1.length >= 4 &&
          color1[3] === 0;
        if (shouldUseLogoChromaKey) {
          const keyed = this.getChromaKeyTexture(primary.textureName, {
            lowThreshold: 10,
            highThreshold: 42,
            maskTextureName: mask.textureName,
            outlineThreshold: 240,
            outlineStrength: 5,
            maxOutlineAlpha: 96,
          });
          if (keyed) {
            return {
              ...primary,
              texture: keyed,
              textureName: `${primary.textureName}|chroma`,
            };
          }
        }

        const shouldInvertMask =
          /logo/i.test(paneName) &&
          Array.isArray(color1) &&
          color1.length >= 4 &&
          color1[3] === 0 &&
          color1[0] > 0 &&
          color1[1] > 0 &&
          color1[2] > 0 &&
          (color1[0] < 245 || color1[1] < 245 || color1[2] < 245);

        const combined = this.getMaskedTexture(primary.textureName, mask.textureName, {
          invertMask: shouldInvertMask,
        });
        if (combined) {
          return {
            ...primary,
            texture: combined,
            textureName: `${primary.textureName}|masked:${mask.textureName}`,
          };
        }
      }

      if (
        bindings.length === 1 &&
        shouldSkipStandaloneAlphaMask(pane, material, primary.textureName, this.getTextureFormat(primary.textureName))
      ) {
        return null;
      }

      if (
        bindings.length === 1 &&
        shouldTreatI4AsLumaAlphaMask(pane, material, primary.textureName, this.getTextureFormat(primary.textureName))
      ) {
        const isTitleShadowPane = /^N_Sha/i.test(String(pane?.parent ?? ""));
        const lumaMask = this.getLumaAlphaTexture(primary.textureName, {
          mode: "linear",
          alphaScale: isTitleShadowPane ? 0.42 : 1,
        });
        if (lumaMask) {
          return {
            ...primary,
            texture: lumaMask,
            textureName: `${primary.textureName}|luma-alpha`,
          };
        }
      }

      if (
        bindings.length === 1 &&
        shouldApplyLumaRemap(pane, primary.textureName, material, this.getTextureFormat(primary.textureName))
      ) {
        const remapColors = getLumaRemapColors(pane, material, primary.textureName);
        const remapped = remapColors ? this.getLumaRemapTexture(primary.textureName, remapColors) : null;
        if (remapped) {
          return {
            ...primary,
            texture: remapped,
            textureName: `${primary.textureName}|luma-remap`,
            skipMaterialColorModulation: true,
          };
        }
      }

      return primary;
    }

    // Fallback: try textureIndices (from textureMaps) with basic single binding.
    const textureIndices = material?.textureIndices ?? [];
    for (const textureIndex of textureIndices) {
      if (textureIndex < 0 || textureIndex >= this.layout.textures.length) {
        continue;
      }
      const textureName = this.layout.textures[textureIndex];
      if (this.textureCanvases[textureName]) {
        if (shouldSkipStandaloneAlphaMask(pane, material, textureName, this.getTextureFormat(textureName))) {
          return null;
        }
        return {
          texture: this.textureCanvases[textureName],
          textureName,
          material,
          wrapS: 0,
          wrapT: 0,
          textureSRT: null,
          texCoordIndex: 0,
        };
      }
    }
  }

  // Fallback: try materialIndex as texture index (legacy compatibility).
  if (pane.materialIndex >= 0 && pane.materialIndex < this.layout.textures.length) {
    const textureName = this.layout.textures[pane.materialIndex];
    if (this.textureCanvases[textureName]) {
      return {
        texture: this.textureCanvases[textureName],
        textureName,
        material: null,
        wrapS: 0,
        wrapT: 0,
        textureSRT: null,
        texCoordIndex: 0,
      };
    }
  }

  // Last resort: first available texture.
  for (const textureName of this.layout.textures) {
    if (this.textureCanvases[textureName]) {
      return {
        texture: this.textureCanvases[textureName],
        textureName,
        material: null,
        wrapS: 0,
        wrapT: 0,
        textureSRT: null,
        texCoordIndex: 0,
      };
    }
  }

  return null;
}

export function getTextureForPane(pane) {
  return this.getTextureBindingForPane(pane)?.texture ?? null;
}

export function transformTexCoord(point, textureSRT) {
  if (!textureSRT) {
    return { s: point.s, t: point.t };
  }

  const xScale = Number.isFinite(textureSRT.xScale) ? textureSRT.xScale : 1;
  const yScale = Number.isFinite(textureSRT.yScale) ? textureSRT.yScale : 1;
  const xTrans = Number.isFinite(textureSRT.xTrans) ? textureSRT.xTrans : 0;
  const yTrans = Number.isFinite(textureSRT.yTrans) ? textureSRT.yTrans : 0;
  const rotation = Number.isFinite(textureSRT.rotation) ? textureSRT.rotation : 0;

  // Match wii-banner-player / OpenGL texture matrix order:
  // T(0.5) * R(rot) * S(scale) * T(trans/scale - 0.5)
  // In OpenGL this is applied as matrix multiplication right-to-left.
  // For per-vertex math we apply left-to-right on the point:
  //   1. offset by (trans/scale - 0.5)
  //   2. scale
  //   3. rotate
  //   4. translate back by +0.5
  const safeXScale = xScale !== 0 ? xScale : 1;
  const safeYScale = yScale !== 0 ? yScale : 1;

  let s = point.s + xTrans / safeXScale - 0.5;
  let t = point.t + yTrans / safeYScale - 0.5;

  s *= xScale;
  t *= yScale;

  if (rotation !== 0) {
    const radians = (rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const nextS = s * cos - t * sin;
    const nextT = s * sin + t * cos;
    s = nextS;
    t = nextT;
  }

  s += 0.5;
  t += 0.5;

  return { s, t };
}

export function getTransformedTexCoords(pane, textureSRT = null, texCoordIndex = 0) {
  if (!pane.texCoords || pane.texCoords.length === 0) {
    return null;
  }

  const safeTexCoordIndex = Number.isFinite(texCoordIndex)
    ? Math.max(0, Math.min(pane.texCoords.length - 1, Math.floor(texCoordIndex)))
    : 0;
  const coords = pane.texCoords[safeTexCoordIndex];
  if (!coords?.tl || !coords?.tr || !coords?.bl || !coords?.br) {
    return null;
  }

  return {
    tl: this.transformTexCoord(coords.tl, textureSRT),
    tr: this.transformTexCoord(coords.tr, textureSRT),
    bl: this.transformTexCoord(coords.bl, textureSRT),
    br: this.transformTexCoord(coords.br, textureSRT),
  };
}

export function getTransformedTexCoordValues(pane, textureSRT = null, texCoordIndex = 0) {
  const transformed = this.getTransformedTexCoords(pane, textureSRT, texCoordIndex);
  if (!transformed) {
    return null;
  }

  const points = [transformed.tl, transformed.tr, transformed.bl, transformed.br];
  const sValues = points.map((point) => point.s);
  const tValues = points.map((point) => point.t);
  if (sValues.some((value) => !Number.isFinite(value)) || tValues.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return { sValues, tValues };
}

export function getTexCoordSpans(pane, textureSRT = null, texCoordIndex = 0) {
  if (!pane.texCoords || pane.texCoords.length === 0) {
    return null;
  }

  const values = this.getTransformedTexCoordValues(pane, textureSRT, texCoordIndex);
  if (!values) {
    return null;
  }

  const { sValues, tValues } = values;

  const minS = Math.min(...sValues);
  const maxS = Math.max(...sValues);
  const minT = Math.min(...tValues);
  const maxT = Math.max(...tValues);

  return {
    minS,
    maxS,
    minT,
    maxT,
    spanS: Math.max(1e-6, Math.abs(maxS - minS)),
    spanT: Math.max(1e-6, Math.abs(maxT - minT)),
    maxAbs: Math.max(...sValues.map((value) => Math.abs(value)), ...tValues.map((value) => Math.abs(value))),
  };
}

export function getSourceRectForPane(pane, texture, options = {}) {
  const forceNormalized = options.forceNormalized ?? false;
  const repeatX = options.repeatX ?? false;
  const repeatY = options.repeatY ?? false;
  const textureSRT = options.textureSRT ?? null;
  const texCoordIndex = options.texCoordIndex ?? 0;

  if (!pane.texCoords || pane.texCoords.length === 0) {
    return null;
  }

  const values = this.getTransformedTexCoordValues(pane, textureSRT, texCoordIndex);
  if (!values) {
    return null;
  }

  let { sValues, tValues } = values;

  const maxAbs = Math.max(...sValues.map((value) => Math.abs(value)), ...tValues.map((value) => Math.abs(value)));
  const normalizedCoords = forceNormalized || maxAbs <= 2;

  if (normalizedCoords) {
    sValues = sValues.map((value) => value * texture.width);
    tValues = tValues.map((value) => value * texture.height);
  }

  const clampAxis = (valuesInput, size, repeat) => {
    if (repeat) {
      return { min: 0, max: size };
    }

    const minRaw = Math.min(...valuesInput);
    const maxRaw = Math.max(...valuesInput);
    const minClamped = Math.max(0, Math.min(size, minRaw));
    const maxClamped = Math.max(0, Math.min(size, maxRaw));

    if (maxClamped - minClamped >= 1) {
      return { min: minClamped, max: maxClamped };
    }

    // Entirely outside range: clamp to a 1-pixel edge sample.
    if (maxRaw <= 0) {
      return { min: 0, max: Math.min(size, 1) };
    }
    if (minRaw >= size) {
      return { min: Math.max(0, size - 1), max: size };
    }

    // Very narrow in-range sample.
    const center = Math.max(0, Math.min(size - 1, (minClamped + maxClamped) * 0.5));
    const start = Math.floor(center);
    return { min: start, max: Math.min(size, start + 1) };
  };

  const xRange = clampAxis(sValues, texture.width, repeatX);
  const yRange = clampAxis(tValues, texture.height, repeatY);
  const left = xRange.min;
  const right = xRange.max;
  const top = yRange.min;
  const bottom = yRange.max;

  const srcWidth = right - left;
  const srcHeight = bottom - top;
  if (srcWidth < 1 || srcHeight < 1) {
    return null;
  }

  return { x: left, y: top, width: srcWidth, height: srcHeight };
}

export function getMaterialForPane(pane) {
  if (!Number.isInteger(pane?.materialIndex) || pane.materialIndex < 0) {
    return null;
  }
  return this.layout?.materials?.[pane.materialIndex] ?? null;
}
