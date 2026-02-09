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
