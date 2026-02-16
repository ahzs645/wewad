import { buildCssColor } from "./renderColorUtils";
import { getProjectedTransform2D } from "./transformMethods";

function resolveBlendCompositeOp(pane, materials) {
  if (!Number.isInteger(pane?.materialIndex) || pane.materialIndex < 0 || pane.materialIndex >= materials.length) {
    return null;
  }

  const blendMode = materials[pane.materialIndex]?.blendMode;
  if (!blendMode) {
    // Default blend mode: src=srcAlpha(4), dst=1-srcAlpha(5), func=blend(1)
    // This is standard alpha blending → null (Canvas 2D default).
    return null;
  }

  // func=0: blending disabled → replace (overwrite destination).
  if (blendMode.func === 0) {
    return "copy";
  }

  // GX blend factors:
  //   0=ZERO, 1=ONE, 2=srcColor, 3=1-srcColor,
  //   4=srcAlpha, 5=1-srcAlpha, 6=dstAlpha, 7=1-dstAlpha
  const src = blendMode.srcFactor & 0x7;
  const dst = blendMode.dstFactor & 0x7;

  // func=1: ADD — (pixel × srcFactor) + (dest × dstFactor)
  if (blendMode.func === 1) {
    // Standard alpha blend: src×srcAlpha + dst×(1-srcAlpha) → Canvas default
    if (src === 4 && dst === 5) {
      return null;
    }

    // Additive blending: src×1 + dst×1, or src×srcAlpha + dst×1
    if ((src === 1 && dst === 1) || (src === 4 && dst === 1)) {
      return "lighter";
    }

    // Replace: src×1 + dst×0
    if (src === 1 && dst === 0) {
      return "copy";
    }

    // src×0 + dst×srcAlpha → multiply destination by source alpha
    if (src === 0 && dst === 4) {
      return "destination-in";
    }

    // src×dstAlpha + dst×(1-srcAlpha) — premultiplied-style
    if (src === 6 && dst === 5) {
      return null; // Best approximation is standard alpha blend
    }

    // src×srcAlpha + dst×srcColor — screen-like additive
    if (src === 4 && dst === 2) {
      return "lighter";
    }

    // src×0 + dst×1 — no-op (destination unchanged)
    if (src === 0 && dst === 1) {
      return null;
    }

    // src×1 + dst×(1-srcAlpha) — premultiplied alpha
    if (src === 1 && dst === 5) {
      return null; // Standard Canvas 2D handles premultiplied fine
    }

    // Fallback: if dst is zero, it's a replace regardless of src
    if (dst === 0) {
      return "copy";
    }

    // Fallback: if both contribute, closest Canvas 2D op is default compositing
    return null;
  }

  // func=2: REVERSE_SUBTRACT — dest - src (GX_BM_LOGIC mapped to subtract by reference)
  if (blendMode.func === 2) {
    return "difference";
  }

  // func=3: SUBTRACT — dest - src
  if (blendMode.func === 3) {
    return "difference";
  }

  return null;
}

function drawPaneWithResolvedState(renderer, context, pane, paneState, localPaneStates, layoutWidth, layoutHeight) {
  let alpha = 1;
  let visible = true;
  const transformChain = renderer.getPaneTransformChain(pane);

  context.save();
  context.translate(layoutWidth / 2, layoutHeight / 2);

  for (const chainPane of transformChain) {
    const chainState = localPaneStates.get(chainPane);
    if (!chainState) {
      continue;
    }

    if (chainPane !== pane && chainState.propagatesVisibility && chainState.visible === false) {
      visible = false;
    }
    if (chainPane === pane || chainState.propagatesAlpha) {
      alpha *= chainState.alpha;
    }

    context.translate(chainState.tx, -chainState.ty);

    const projected = getProjectedTransform2D(renderer, chainState);
    context.transform(projected.a, projected.b, projected.c, projected.d, 0, 0);
  }

  // Apply origin offset ONLY for the pane being drawn, AFTER all transforms.
  // Reference: origin is inside Quad::Draw() with its own push/pop matrix,
  // so it does NOT propagate to children.  Origin must come after scale so
  // the anchor point scales correctly with the pane.
  const originOffset = renderer.getPaneOriginOffset(pane, paneState.width, paneState.height);
  if (originOffset.x !== 0 || originOffset.y !== 0) {
    context.translate(originOffset.x, originOffset.y);
  }

  if (!visible || alpha <= 0) {
    context.restore();
    return;
  }

  context.globalAlpha = Math.max(0, Math.min(1, alpha));

  const blendOp = resolveBlendCompositeOp(pane, renderer.layout?.materials ?? []);
  if (blendOp) {
    context.globalCompositeOperation = blendOp;
  }

  if (pane.type === "pic1" || pane.type === "wnd1") {
    // Try the TEV pipeline first for materials with non-trivial TEV stages.
    if (renderer.shouldUseTevPipeline(pane)) {
      const tevResult = renderer.runTevPipeline(pane, paneState, paneState.width, paneState.height);
      if (tevResult) {
        renderer.drawTevResult(context, tevResult, paneState.width, paneState.height);
        context.restore();
        return;
      }
    }

    // Fallback to Canvas 2D heuristic path.
    const binding = renderer.getTextureBindingForPane(pane, paneState);
    if (binding) {
      renderer.drawPane(context, binding, pane, paneState, paneState.width, paneState.height);
    } else {
      // No texture — draw vertex-colored rectangle (reference always draws quad).
      renderer.drawVertexColoredPane(context, pane, paneState, paneState.width, paneState.height);
    }
  } else if (pane.type === "txt1") {
    renderer.drawTextPane(context, pane, paneState.width, paneState.height);
  }

  context.restore();
}

// Draw a pane that has no texture binding — render as a vertex-colored rectangle.
// Reference Quad::Draw always draws the quad even without textures.
export function drawVertexColoredPane(context, pane, paneState, width, height) {
  const colors = paneState?.vertexColors ?? pane?.vertexColors;
  if (!colors || colors.length < 4) {
    return;
  }

  // Check if all vertex colors are fully transparent — skip if so.
  const allTransparent = colors.every((c) => (c.a ?? 255) === 0);
  if (allTransparent) {
    return;
  }

  const halfW = width / 2;
  const halfH = height / 2;

  // For uniform color, draw a simple filled rect.
  const tl = colors[0];
  const tr = colors[1];
  const bl = colors[2];
  const br = colors[3];
  const sameColor =
    tl.r === tr.r && tl.r === bl.r && tl.r === br.r &&
    tl.g === tr.g && tl.g === bl.g && tl.g === br.g &&
    tl.b === tr.b && tl.b === bl.b && tl.b === br.b &&
    tl.a === tr.a && tl.a === bl.a && tl.a === br.a;

  if (sameColor) {
    context.fillStyle = buildCssColor(tl);
    context.fillRect(-halfW, -halfH, width, height);
  } else {
    // Vertical gradient approximation (top to bottom).
    const topAvg = {
      r: (tl.r + tr.r) / 2,
      g: (tl.g + tr.g) / 2,
      b: (tl.b + tr.b) / 2,
      a: (tl.a + tr.a) / 2,
    };
    const botAvg = {
      r: (bl.r + br.r) / 2,
      g: (bl.g + br.g) / 2,
      b: (bl.b + br.b) / 2,
      a: (bl.a + br.a) / 2,
    };
    const gradient = context.createLinearGradient(0, -halfH, 0, halfH);
    gradient.addColorStop(0, buildCssColor(topAvg));
    gradient.addColorStop(1, buildCssColor(botAvg));
    context.fillStyle = gradient;
    context.fillRect(-halfW, -halfH, width, height);
  }
}

export function drawPane(context, binding, pane, paneState, width, height) {
  if (this.shouldDrawCustomTemperatureForPane(pane)) {
    if (this.drawCustomTemperaturePane(context, pane, width, height)) {
      return;
    }
  }

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

  const vertexModulation = this.getPaneVertexColorModulation(pane, paneState, this.frame, width, height);
  const materialModulation = binding?.skipMaterialColorModulation ? null : this.getPaneMaterialColorModulation(pane);
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
  this.applyPaneVertexColorModulation(paneContext, pane, paneState, surfaceWidth, surfaceHeight);
  paneContext.restore();

  // Expand to cover Canvas 2D anti-aliasing seams between adjacent panes
  const pad = 4;
  context.drawImage(this.paneCompositeSurface, -width / 2 - pad, -height / 2 - pad, width + 2 * pad, height + 2 * pad);
}

// Resolve effective text colors by multiplying textTopColor/textBottomColor with material color2.
// On the real Wii, txt1 text is rendered through the full material pipeline — material colors
// modulate the per-vertex text colors. Without this, white textTopColor + black material = white text.
function resolveTextPaneColors(renderer, pane) {
  const material = renderer.getMaterialForPane?.(pane);
  if (!material) {
    return pane;
  }

  const color2 = material.color2;
  if (!Array.isArray(color2) || color2.length < 4) {
    return pane;
  }

  const clamp = (v) => Math.max(0, Math.min(255, Math.round(Number.isFinite(v) ? v : 255)));
  const staticColor = { r: clamp(color2[0]), g: clamp(color2[1]), b: clamp(color2[2]), a: clamp(color2[3]) };
  const animatedColor = renderer.getPaneMaterialAnimColor?.(pane.name, renderer.frame) ?? {};

  const matR = animatedColor.r ?? staticColor.r;
  const matG = animatedColor.g ?? staticColor.g;
  const matB = animatedColor.b ?? staticColor.b;
  const matA = animatedColor.a ?? staticColor.a;

  if (matR === 255 && matG === 255 && matB === 255 && matA === 255) {
    return pane;
  }

  const modulateColor = (base) => {
    if (!base) {
      return base;
    }
    return {
      r: Math.round((base.r * matR) / 255),
      g: Math.round((base.g * matG) / 255),
      b: Math.round((base.b * matB) / 255),
      a: Math.round((base.a * matA) / 255),
    };
  };

  return {
    ...pane,
    textTopColor: modulateColor(pane.textTopColor),
    textBottomColor: modulateColor(pane.textBottomColor),
  };
}

export function drawTextPane(context, pane, width, height) {
  const customText = this.getCustomWeatherTextForPane(pane) ?? this.getCustomNewsTextForPane?.(pane);
  const rawText = typeof customText === "string" ? customText : typeof pane?.text === "string" ? pane.text : "";
  if (rawText.length === 0) {
    return;
  }

  const absWidth = Math.abs(width);
  const absHeight = Math.abs(height);
  if (absWidth < 1e-6 || absHeight < 1e-6) {
    return;
  }

  // Apply material color modulation to text colors before rendering.
  const effectivePane = resolveTextPaneColors(this, pane);

  // Try bitmap font rendering if a font file is available.
  const fontData = this.getFontForPane?.(pane);
  if (fontData && fontData.sheets.length > 0) {
    this.drawBitmapTextPane(context, effectivePane, fontData, rawText, width, height);
    return;
  }

  // Fallback: Canvas 2D fillText.
  this.drawFillTextPane(context, effectivePane, rawText, width, height);
}

export function drawFillTextPane(context, pane, rawText, width, height) {
  const absWidth = Math.abs(width);
  const absHeight = Math.abs(height);

  const paragraphs = rawText.replace(/\r/g, "").split("\n");
  if (paragraphs.length === 0) {
    return;
  }

  const lineSpacing = Number.isFinite(pane?.lineSpacing) ? pane.lineSpacing : 0;

  // Wii bitmap fonts render at scale = textSize.y / fontHeight, producing glyphs
  // smaller than textSize.y. Without the font file, estimate the effective rendering
  // height as textSize.x² / textSize.y (derived from the cell aspect ratio).
  // When textSize.x == textSize.y, this simplifies to textSize.y (no adjustment).
  const textSizeX = pane?.textSize?.x;
  const textSizeY = pane?.textSize?.y;
  let fontSize;
  if (Number.isFinite(textSizeX) && Number.isFinite(textSizeY) && textSizeY > 0 && textSizeX > 0) {
    fontSize = Math.max(1, textSizeX < textSizeY ? (textSizeX * textSizeX) / textSizeY : textSizeY);
  } else {
    fontSize = Math.max(1, Number.isFinite(textSizeY) ? textSizeY : absHeight * 0.45);
  }

  // Byte +8 in txt1 is the text origin/position (benzin: "alignment").
  // Encodes hAlign = value % 3: 0=left, 1=center, 2=right.
  // Encodes vAlign = floor(value / 3): 0=top, 1=center, 2=bottom.
  const posFlags = pane?.textPositionFlags ?? 0;
  const hOrigin = posFlags % 3;
  const vOrigin = Math.floor(posFlags / 3);
  let textAlign = "left";
  if (hOrigin === 1) {
    textAlign = "center";
  } else if (hOrigin === 2) {
    textAlign = "right";
  }

  // Horizontal compression: Wii bitmap fonts have a specific width-to-height ratio
  // encoded in textSize (x=cell width, y=cell height). Apply this ratio to compress
  // the fallback font horizontally so text proportions match the Wii layout.
  const xRatio = (Number.isFinite(textSizeX) && Number.isFinite(textSizeY) && textSizeY > 0 && textSizeX < textSizeY)
    ? textSizeX / textSizeY
    : 1;

  const boxLeft = -width / 2;
  const boxTop = -height / 2;

  const topColor = pane?.textTopColor ?? { r: 32, g: 32, b: 32, a: 255 };
  const bottomColor = pane?.textBottomColor ?? topColor;

  context.save();

  // Clip text to pane bounds — on the Wii, text is rendered as textured quads
  // within the pane geometry, so it never overflows the pane rectangle.
  context.beginPath();
  context.rect(boxLeft, boxTop, absWidth, absHeight);
  context.clip();

  // Apply horizontal compression to match Wii font proportions.
  // Scale X axis, then adjust all X coordinates by dividing by xRatio.
  if (xRatio < 1) {
    context.scale(xRatio, 1);
  }
  const effectiveWidth = absWidth / xRatio;
  const textX = textAlign === "center" ? 0 : textAlign === "right" ? effectiveWidth / 2 : -effectiveWidth / 2;

  context.textBaseline = "top";
  context.textAlign = textAlign;
  context.font = `${fontSize}px sans-serif`;

  // Vertical fit: ensure all lines fit within the pane height.
  const rawLineHeight = Math.max(1, fontSize + lineSpacing);
  const rawContentHeight = rawLineHeight * paragraphs.length;
  if (rawContentHeight > absHeight && rawContentHeight > 0) {
    fontSize = Math.max(1, fontSize * (absHeight / rawContentHeight));
    context.font = `${fontSize}px sans-serif`;
  }

  // Horizontal fit: ensure widest line fits within the effective (compressed) width.
  let maxLineWidth = 0;
  for (let i = 0; i < paragraphs.length; i += 1) {
    const measured = context.measureText(paragraphs[i]);
    if (measured.width > maxLineWidth) {
      maxLineWidth = measured.width;
    }
  }
  if (maxLineWidth > effectiveWidth && maxLineWidth > 0) {
    fontSize = Math.max(1, fontSize * (effectiveWidth / maxLineWidth));
    context.font = `${fontSize}px sans-serif`;
  }

  const lineHeight = Math.max(1, fontSize + lineSpacing);

  // Wii does NOT word-wrap text — only explicit \n causes line breaks.
  const lines = paragraphs;
  if (lines.length === 0) {
    context.restore();
    return;
  }
  const contentHeight = lineHeight * lines.length;

  // Vertical alignment within pane bounds.
  let textY;
  if (vOrigin === 0) {
    textY = boxTop;
  } else if (vOrigin === 2) {
    textY = boxTop + absHeight - contentHeight;
  } else {
    textY = boxTop + Math.max(0, (absHeight - contentHeight) / 2);
  }

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
    context.fillText(lines[i], textX, textY + i * lineHeight, effectiveWidth);
  }
  context.restore();
}

export function renderFrame(frame) {
  const context = this.ctx;
  this.textureSrtAnimationCache.clear();
  const layoutWidth = this.layout.width || this.canvas.clientWidth || this.canvas.width;
  const layoutHeight = this.layout.height || this.canvas.clientHeight || this.canvas.height;
  const referenceAspect = Number.isFinite(this.referenceAspectRatio) && this.referenceAspectRatio > 0
    ? this.referenceAspectRatio
    : 4 / 3;
  const displayAspect = Number.isFinite(this.displayAspectRatio) && this.displayAspectRatio > 0
    ? this.displayAspectRatio
    : null;
  const displayScaleX = displayAspect ? displayAspect / referenceAspect : 1;
  const outputWidth = layoutWidth * displayScaleX;
  const outputHeight = layoutHeight;
  const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.round(outputWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(outputHeight * dpr));

  if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
  }
  if (this.canvas.style) {
    this.canvas.style.width = `${outputWidth}px`;
    this.canvas.style.height = `${outputHeight}px`;
  }

  context.setTransform(dpr * displayScaleX, 0, 0, dpr, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  context.clearRect(0, 0, layoutWidth, layoutHeight);

  const localPaneStates = new Map();
  for (const pane of this.layout.panes) {
    localPaneStates.set(pane, this.getLocalPaneState(pane, frame));
  }

  const renderablePanes = this.layout.panes.filter((pane) =>
    pane.type === "pic1" || pane.type === "txt1" || pane.type === "wnd1"
  );
  const orderedRenderablePanes = this.getCustomWeatherOrderedPanes?.(renderablePanes) ?? renderablePanes;
  const shouldUseWiiShopBackdropMask =
    this.panesByName?.has("backCLs") &&
    this.panesByName?.has("mask_01") &&
    this.panesByName?.has("logo_base") &&
    this.layout?.textures?.includes("logo_pic01.tpl") &&
    this.layout?.textures?.includes("logo_pic02.tpl");

  let backdropContext = null;
  let hasBackdropContent = false;

  const ensureBackdropSurface = () => {
    if (!this.wiiShopBackdropSurface) {
      this.wiiShopBackdropSurface = document.createElement("canvas");
      this.wiiShopBackdropContext = this.wiiShopBackdropSurface.getContext("2d");
    }

    if (this.wiiShopBackdropSurface.width !== pixelWidth || this.wiiShopBackdropSurface.height !== pixelHeight) {
      this.wiiShopBackdropSurface.width = pixelWidth;
      this.wiiShopBackdropSurface.height = pixelHeight;
    }

    if (!backdropContext) {
      backdropContext = this.wiiShopBackdropContext;
      backdropContext.setTransform(dpr * displayScaleX, 0, 0, dpr, 0, 0);
      backdropContext.imageSmoothingEnabled = true;
      backdropContext.imageSmoothingQuality = "high";
      backdropContext.clearRect(0, 0, layoutWidth, layoutHeight);
    }

    return backdropContext;
  };

  const flushBackdropLayer = () => {
    if (!hasBackdropContent || !backdropContext || !this.wiiShopBackdropSurface) {
      return;
    }

    const maskPane = this.panesByName.get("mask_01");
    const maskPaneState = maskPane ? localPaneStates.get(maskPane) : null;
    if (maskPane && maskPaneState) {
      backdropContext.save();
      backdropContext.globalCompositeOperation = "destination-out";
      drawPaneWithResolvedState(this, backdropContext, maskPane, maskPaneState, localPaneStates, layoutWidth, layoutHeight);
      backdropContext.restore();
    }

    context.drawImage(this.wiiShopBackdropSurface, 0, 0, layoutWidth, layoutHeight);
    hasBackdropContent = false;
    backdropContext.clearRect(0, 0, layoutWidth, layoutHeight);
  };

  for (const pane of orderedRenderablePanes) {
    if (!this.shouldRenderPaneForLocale(pane)) {
      continue;
    }
    if (!this.shouldRenderPaneForState(pane)) {
      continue;
    }
    if (!this.shouldRenderPaneForPaneState(pane)) {
      continue;
    }
    if (!this.shouldRenderPaneForCustomWeather(pane)) {
      continue;
    }
    if (!this.shouldRenderPaneForCustomNews?.(pane)) {
      continue;
    }

    const paneState = localPaneStates.get(pane);
    if (!paneState) {
      continue;
    }

    if (shouldUseWiiShopBackdropMask) {
      const paneName = String(pane?.name ?? "");
      if (/^CL[A-Z_-]/i.test(paneName)) {
        const targetContext = ensureBackdropSurface();
        drawPaneWithResolvedState(this, targetContext, pane, paneState, localPaneStates, layoutWidth, layoutHeight);
        hasBackdropContent = true;
        continue;
      }

      if (paneName === "mask_01" || paneName === "mask_02") {
        continue;
      }

      if (paneName === "effects" && hasBackdropContent) {
        flushBackdropLayer();
      }
    }

    drawPaneWithResolvedState(this, context, pane, paneState, localPaneStates, layoutWidth, layoutHeight);
  }

  if (shouldUseWiiShopBackdropMask && hasBackdropContent) {
    flushBackdropLayer();
  }
}
