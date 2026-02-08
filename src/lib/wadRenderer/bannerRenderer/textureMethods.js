import { isLikelyAlphaOnlyTitleMask } from "./locale";

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

export function getLumaAlphaTexture(textureName) {
  const key = `${textureName}|luma-alpha`;
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
  for (let i = 0; i < out.length; i += 4) {
    const alpha = Math.max(out[i], out[i + 1], out[i + 2]);
    out[i] = 255;
    out[i + 1] = 255;
    out[i + 2] = 255;
    out[i + 3] = alpha;
  }

  context.putImageData(imageData, 0, 0);
  this.lumaAlphaTextureCache.set(key, canvas);
  return canvas;
}

export function getMaskedTexture(baseTextureName, maskTextureName) {
  const key = `${baseTextureName}|${maskTextureName}`;
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
    const maskAlpha = Math.max(maskData[i], maskData[i + 1], maskData[i + 2]);
    out[i + 3] = (out[i + 3] * maskAlpha) / 255;
  }

  context.putImageData(baseImageData, 0, 0);
  this.textureMaskCache.set(key, canvas);
  return canvas;
}

export function getTextureBindingForPane(pane) {
  if (pane.materialIndex >= 0 && pane.materialIndex < this.layout.materials.length) {
    const material = this.layout.materials[pane.materialIndex];
    const textureMaps = material?.textureMaps ?? [];
    const textureSRTs = material?.textureSRTs ?? [];
    const bindings = [];
    for (let mapIndex = 0; mapIndex < textureMaps.length; mapIndex += 1) {
      const textureMap = textureMaps[mapIndex];
      const textureIndex = textureMap.textureIndex;
      if (textureIndex < 0 || textureIndex >= this.layout.textures.length) {
        continue;
      }

      const textureName = this.layout.textures[textureIndex];
      if (this.textureCanvases[textureName]) {
        bindings.push({
          texture: this.textureCanvases[textureName],
          textureName,
          material,
          wrapS: textureMap.wrapS ?? 0,
          wrapT: textureMap.wrapT ?? 0,
          textureSRT: textureSRTs[mapIndex] ?? null,
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
        const combined = this.getMaskedTexture(primary.textureName, mask.textureName);
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
        this.getTextureFormat(primary.textureName) === 0 &&
        isLikelyAlphaOnlyTitleMask(primary.textureName)
      ) {
        return null;
      }

      return primary;
    }

    const textureIndices = material?.textureIndices ?? [];
    for (const textureIndex of textureIndices) {
      if (textureIndex < 0 || textureIndex >= this.layout.textures.length) {
        continue;
      }
      const textureName = this.layout.textures[textureIndex];
      if (this.textureCanvases[textureName]) {
        if (this.getTextureFormat(textureName) === 0 && isLikelyAlphaOnlyTitleMask(textureName)) {
          return null;
        }
        return { texture: this.textureCanvases[textureName], textureName, material, wrapS: 0, wrapT: 0, textureSRT: null };
      }
    }
  }

  if (pane.materialIndex >= 0 && pane.materialIndex < this.layout.textures.length) {
    const textureName = this.layout.textures[pane.materialIndex];
    if (this.textureCanvases[textureName]) {
      return { texture: this.textureCanvases[textureName], textureName, material: null, wrapS: 0, wrapT: 0, textureSRT: null };
    }
  }

  for (const textureName of this.layout.textures) {
    if (this.textureCanvases[textureName]) {
      return { texture: this.textureCanvases[textureName], textureName, material: null, wrapS: 0, wrapT: 0, textureSRT: null };
    }
  }

  const textureKeys = Object.keys(this.textureCanvases);
  if (textureKeys.length === 0) {
    return null;
  }

  const textureName = textureKeys[0];
  return { texture: this.textureCanvases[textureName], textureName, material: null, wrapS: 0, wrapT: 0, textureSRT: null };
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

  // Match Alameda/OpenGL texture matrix order:
  // T(0.5) * T(trans) * R(rot) * S(scale) * T(-0.5)
  let s = point.s - 0.5;
  let t = point.t - 0.5;

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

  s += xTrans + 0.5;
  t += yTrans + 0.5;

  return { s, t };
}

export function getTransformedTexCoords(pane, textureSRT = null) {
  if (!pane.texCoords || pane.texCoords.length === 0) {
    return null;
  }

  const coords = pane.texCoords[0];
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

export function getTransformedTexCoordValues(pane, textureSRT = null) {
  const transformed = this.getTransformedTexCoords(pane, textureSRT);
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

export function getTexCoordSpans(pane, textureSRT = null) {
  if (!pane.texCoords || pane.texCoords.length === 0) {
    return null;
  }

  const values = this.getTransformedTexCoordValues(pane, textureSRT);
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

  if (!pane.texCoords || pane.texCoords.length === 0) {
    return null;
  }

  const values = this.getTransformedTexCoordValues(pane, textureSRT);
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
