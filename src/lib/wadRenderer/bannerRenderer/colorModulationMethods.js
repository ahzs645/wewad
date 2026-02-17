import { normalizePaneVertexColors, normalizeMaterialColor, lerpChannel, writePixel } from "./renderColorUtils";

function buildVertexColorCanvas(colors, mode, widthHint = 48, heightHint = 48) {
  const gradientWidth = Math.max(8, Math.min(256, Math.ceil(Math.abs(widthHint))));
  const gradientHeight = Math.max(8, Math.min(256, Math.ceil(Math.abs(heightHint))));
  const canvas = document.createElement("canvas");
  canvas.width = gradientWidth;
  canvas.height = gradientHeight;

  const context = canvas.getContext("2d");
  const imageData = context.createImageData(gradientWidth, gradientHeight);
  const pixels = imageData.data;
  const [tl, tr, bl, br] = colors;

  for (let y = 0; y < gradientHeight; y += 1) {
    const v = gradientHeight <= 1 ? 0 : y / (gradientHeight - 1);
    for (let x = 0; x < gradientWidth; x += 1) {
      const u = gradientWidth <= 1 ? 0 : x / (gradientWidth - 1);
      const top = {
        r: lerpChannel(tl.r, tr.r, u),
        g: lerpChannel(tl.g, tr.g, u),
        b: lerpChannel(tl.b, tr.b, u),
        a: lerpChannel(tl.a, tr.a, u),
      };
      const bottom = {
        r: lerpChannel(bl.r, br.r, u),
        g: lerpChannel(bl.g, br.g, u),
        b: lerpChannel(bl.b, br.b, u),
        a: lerpChannel(bl.a, br.a, u),
      };
      const sampled = {
        r: Math.round(lerpChannel(top.r, bottom.r, v)),
        g: Math.round(lerpChannel(top.g, bottom.g, v)),
        b: Math.round(lerpChannel(top.b, bottom.b, v)),
        a: Math.round(lerpChannel(top.a, bottom.a, v)),
      };

      const offset = (y * gradientWidth + x) * 4;
      if (mode === "color") {
        writePixel(pixels, offset, sampled.r, sampled.g, sampled.b, 255);
      } else {
        writePixel(pixels, offset, 255, 255, 255, sampled.a);
      }
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function getModulationScratch(renderer, width, height) {
  if (!renderer.modulationScratchSurface) {
    renderer.modulationScratchSurface = document.createElement("canvas");
    renderer.modulationScratchContext = renderer.modulationScratchSurface.getContext("2d");
  }

  if (
    renderer.modulationScratchSurface.width !== width ||
    renderer.modulationScratchSurface.height !== height
  ) {
    renderer.modulationScratchSurface.width = width;
    renderer.modulationScratchSurface.height = height;
  }

  return {
    surface: renderer.modulationScratchSurface,
    context: renderer.modulationScratchContext,
  };
}

function applyColorBlendPreservingAlpha(renderer, context, width, height, drawBlend) {
  const scratch = getModulationScratch(renderer, width, height);
  scratch.context.setTransform(1, 0, 0, 1, 0, 0);
  scratch.context.clearRect(0, 0, width, height);
  scratch.context.drawImage(context.canvas, 0, 0, width, height, 0, 0, width, height);

  drawBlend();

  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = "destination-in";
  context.drawImage(scratch.surface, -width / 2, -height / 2, width, height);
  context.restore();
}

export function getPaneVertexColorModulation(pane, paneState = null, frame = this.frame, widthHint = 48, heightHint = 48) {
  const colors = paneState?.vertexColors ? normalizePaneVertexColors({ vertexColors: paneState.vertexColors }) : normalizePaneVertexColors(pane);
  if (!colors) {
    this.vertexColorModulationCache.set(pane, { cacheKey: "", signature: "", modulation: null });
    return null;
  }

  const hasColorTint = colors.some((color) => color.r !== 255 || color.g !== 255 || color.b !== 255);
  const hasAlphaTint = colors.some((color) => color.a !== 255);
  if (!hasColorTint && !hasAlphaTint) {
    this.vertexColorModulationCache.set(pane, { cacheKey: "", signature: "", modulation: null });
    return null;
  }

  const sizeKey = `${Math.max(1, Math.round(Math.abs(widthHint)))}x${Math.max(1, Math.round(Math.abs(heightHint)))}`;
  const colorSignature = colors.map((color) => `${color.r},${color.g},${color.b},${color.a}`).join("|");
  const cacheKey = `${frame.toFixed(4)}|${sizeKey}`;
  const cached = this.vertexColorModulationCache.get(pane);
  if (cached && cached.cacheKey === cacheKey && cached.signature === colorSignature) {
    return cached.modulation;
  }

  const modulation = {
    hasColorTint,
    hasAlphaTint,
    colorCanvas: hasColorTint ? buildVertexColorCanvas(colors, "color", widthHint, heightHint) : null,
    alphaCanvas: hasAlphaTint ? buildVertexColorCanvas(colors, "alpha", widthHint, heightHint) : null,
  };
  this.vertexColorModulationCache.set(pane, {
    cacheKey,
    signature: colorSignature,
    modulation,
  });
  return modulation;
}

export function getPaneMaterialColorModulation(pane, frame = this.frame) {
  const cached = this.materialColorModulationCache.get(pane);
  if (cached && cached.frame === frame) {
    return cached.modulation;
  }

  if (!Number.isInteger(pane?.materialIndex) || pane.materialIndex < 0 || pane.materialIndex >= this.layout.materials.length) {
    this.materialColorModulationCache.set(pane, { frame, modulation: null });
    return null;
  }

  const material = this.layout.materials[pane.materialIndex];
  const staticColor = normalizeMaterialColor(material?.color2) ?? { r: 255, g: 255, b: 255, a: 255 };
  const animatedColor = this.getPaneMaterialAnimColor(pane.name, frame);

  // RLMC types 0x04+ animate TEV color registers (TEVREG0/1/2) which only feed
  // TEV stage inputs.  For materials without explicit TEV stages these registers
  // have no visual effect on real hardware, so use only the material-color
  // animation (color1, RLMC types 0x00-0x03) in the Canvas 2D fallback path.
  const hasTevStages = (material?.tevStages?.length ?? 0) > 0;
  const animated = hasTevStages ? animatedColor : animatedColor.color1;

  const color = {
    r: animated.r ?? staticColor.r,
    g: animated.g ?? staticColor.g,
    b: animated.b ?? staticColor.b,
    a: animated.a ?? staticColor.a,
  };

  const hasColorTint = color.r !== 255 || color.g !== 255 || color.b !== 255;
  const hasAlphaTint = color.a !== 255;
  if (!hasColorTint && !hasAlphaTint) {
    this.materialColorModulationCache.set(pane, { frame, modulation: null });
    return null;
  }

  const modulation = { ...color, hasColorTint, hasAlphaTint };
  this.materialColorModulationCache.set(pane, { frame, modulation });
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
    applyColorBlendPreservingAlpha(this, context, width, height, () => {
      context.save();
      context.globalAlpha = 1;
      context.globalCompositeOperation = "multiply";
      context.fillStyle = `rgba(${modulation.r}, ${modulation.g}, ${modulation.b}, 1)`;
      context.fillRect(x, y, width, height);
      context.restore();
    });
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


export function applyPaneVertexColorModulation(context, pane, paneState, width, height) {
  const modulation = this.getPaneVertexColorModulation(pane, paneState, this.frame, width, height);
  if (!modulation) {
    return;
  }

  const x = -width / 2;
  const y = -height / 2;

  if (modulation.hasColorTint && modulation.colorCanvas) {
    applyColorBlendPreservingAlpha(this, context, width, height, () => {
      context.save();
      context.globalAlpha = 1;
      context.globalCompositeOperation = "multiply";
      context.drawImage(modulation.colorCanvas, x, y, width, height);
      context.restore();
    });
  }

  if (modulation.hasAlphaTint && modulation.alphaCanvas) {
    context.save();
    context.globalAlpha = 1;
    context.globalCompositeOperation = "destination-in";
    context.drawImage(modulation.alphaCanvas, x, y, width, height);
    context.restore();
  }
}
