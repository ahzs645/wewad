import { normalizeMaterialColor } from "./renderColorUtils";

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
  if (color1 && !(color1.a === 0 && color1.r >= 200 && color1.g >= 200 && color1.b >= 200)) {
    return false;
  }

  // A proper frame/mask texture has high peak intensity (near 255) creating clear
  // opaque borders.  Low-intensity I8 textures (e.g. max ~119) are glow/highlight
  // overlays and should NOT be used as destination-in clipping masks — doing so
  // erases content in areas not covered by other panes, producing black bars.
  const maxLuma = getMaxTextureIntensity(this, baseTextureName);
  if (maxLuma < 200) {
    return false;
  }

  return true;
}

function getMaxTextureIntensity(renderer, textureName) {
  if (!renderer._textureMaxIntensityCache) {
    renderer._textureMaxIntensityCache = new Map();
  }
  const cached = renderer._textureMaxIntensityCache.get(textureName);
  if (cached !== undefined) {
    return cached;
  }

  const source = renderer.textureCanvases[textureName];
  if (!source) {
    renderer._textureMaxIntensityCache.set(textureName, 0);
    return 0;
  }

  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0);
  const data = ctx.getImageData(0, 0, source.width, source.height).data;

  let maxVal = 0;
  for (let i = 0; i < data.length; i += 4) {
    const luma = Math.max(data[i], data[i + 1], data[i + 2]);
    if (luma > maxVal) {
      maxVal = luma;
      if (maxVal >= 255) {
        break;
      }
    }
  }

  renderer._textureMaxIntensityCache.set(textureName, maxVal);
  return maxVal;
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
