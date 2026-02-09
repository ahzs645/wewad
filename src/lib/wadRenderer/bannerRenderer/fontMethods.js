import { buildCssColor } from "./renderColorUtils";

// Prepare decoded font glyph sheets as Canvas elements for rendering.
export function prepareFonts() {
  if (!this.parsedFonts) {
    return;
  }

  for (const [fontName, fontData] of Object.entries(this.parsedFonts)) {
    if (!fontData?.sheets?.length) {
      continue;
    }

    const sheetCanvases = [];
    for (const sheet of fontData.sheets) {
      const canvas = document.createElement("canvas");
      canvas.width = sheet.width;
      canvas.height = sheet.height;
      const ctx = canvas.getContext("2d");
      const imageData = new ImageData(sheet.imageData, sheet.width, sheet.height);
      ctx.putImageData(imageData, 0, 0);
      sheetCanvases.push(canvas);
    }
    this.fontGlyphCanvases[fontName] = sheetCanvases;
  }
}

// Resolve the font data for a txt1 pane by fontName.
export function getFontForPane(pane) {
  const fontName = pane?.fontName;
  if (!fontName || !this.parsedFonts) {
    return null;
  }

  // Try exact match.
  if (this.parsedFonts[fontName]) {
    return { data: this.parsedFonts[fontName], sheets: this.fontGlyphCanvases[fontName] ?? [] };
  }

  // Try basename match (fonts may be referenced with or without path).
  for (const [key, data] of Object.entries(this.parsedFonts)) {
    const baseName = key.split("/").pop();
    if (baseName === fontName) {
      return { data, sheets: this.fontGlyphCanvases[key] ?? [] };
    }
  }

  // Try partial match (font name without extension).
  const fontBase = fontName.replace(/\.[^.]+$/, "");
  for (const [key, data] of Object.entries(this.parsedFonts)) {
    if (key.includes(fontBase)) {
      return { data, sheets: this.fontGlyphCanvases[key] ?? [] };
    }
  }

  return null;
}

// Look up character info: glyph index, UV coords, width data.
export function getGlyphInfo(fontData, charCode) {
  const data = fontData.data;
  let glyphIndex = data.charMap.get(charCode);

  if (glyphIndex === undefined || glyphIndex === 0xFFFF) {
    glyphIndex = data.fontInfo.defaultChar;
    if (glyphIndex === undefined) {
      return null;
    }
  }

  const widthInfo = data.charWidths.get(glyphIndex) ?? {
    kerning: 0,
    glyphWidth: data.fontInfo.charWidth,
    advance: data.fontInfo.fullWidth,
  };

  const gi = data.glyphInfo;
  const charsPerSheet = gi.charColumns * gi.charRows;
  if (charsPerSheet === 0) {
    return null;
  }

  const sheetIndex = Math.floor(glyphIndex / charsPerSheet);
  const indexInSheet = glyphIndex - sheetIndex * charsPerSheet;
  const row = Math.floor(indexInSheet / gi.charColumns);
  const col = indexInSheet % gi.charColumns;

  // UV coordinates (pixel-based, converted to normalized at render time).
  // cellWidth/cellHeight already have +1 applied by the parser.
  const s1 = (gi.cellWidth * col) / gi.sheetWidth;
  const t1 = (gi.cellHeight * row) / gi.sheetHeight;
  const s2 = s1 + gi.cellWidth / gi.sheetWidth;
  const t2 = t1 + gi.cellHeight / gi.sheetHeight;

  return {
    sheetIndex,
    s1,
    t1,
    s2,
    t2,
    kerning: widthInfo.kerning,
    glyphWidth: widthInfo.glyphWidth,
    advance: widthInfo.advance,
    cellWidth: gi.cellWidth,
    cellHeight: gi.cellHeight,
  };
}

// Measure the pixel width of a line of text using bitmap font widths.
export function measureBitmapTextLine(fontData, text, fontSize, charSpacing) {
  const fontHeight = fontData.data.fontInfo.height;
  if (fontHeight <= 0) {
    return 0;
  }

  const scale = fontSize / fontHeight;
  let width = 0;

  for (let i = 0; i < text.length; i += 1) {
    const charCode = text.charCodeAt(i);
    const glyph = this.getGlyphInfo(fontData, charCode);
    if (!glyph) {
      continue;
    }

    if (glyph.glyphWidth > 0) {
      width += glyph.kerning;
    }
    width += glyph.advance;

    if (i < text.length - 1) {
      width += charSpacing / scale;
    }
  }

  return width * scale;
}

// Word-wrap a paragraph using bitmap font measurements.
export function wrapBitmapTextParagraph(fontData, paragraph, fontSize, charSpacing, maxWidth) {
  const trimmed = String(paragraph ?? "");
  if (trimmed.length === 0) {
    return [""];
  }

  const words = trimmed.split(/\s+/);
  const wrapped = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const candidateWidth = this.measureBitmapTextLine(fontData, candidate, fontSize, charSpacing);

    if (candidateWidth <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    wrapped.push(current);
    current = word;
  }

  if (current) {
    wrapped.push(current);
  }
  return wrapped.length > 0 ? wrapped : [""];
}

// Render text using bitmap font glyphs onto the rendering context.
export function drawBitmapTextPane(context, pane, fontData, rawText, width, height) {
  const absWidth = Math.abs(width);
  const absHeight = Math.abs(height);

  const paragraphs = rawText.replace(/\r/g, "").split("\n");
  if (paragraphs.length === 0) {
    return;
  }

  const fontSize = Math.max(1, Number.isFinite(pane?.textSize?.y) ? pane.textSize.y : absHeight * 0.45);
  const charSpacing = Number.isFinite(pane?.charSpacing) ? pane.charSpacing : 0;
  const lineSpacing = Number.isFinite(pane?.lineSpacing) ? pane.lineSpacing : 0;
  const fontHeight = fontData.data.fontInfo.height;
  if (fontHeight <= 0) {
    return;
  }
  const scale = fontSize / fontHeight;

  let textAlign = 0; // 0=left, 1=center, 2=right
  if (pane?.textAlignment === 1) {
    textAlign = 1;
  } else if (pane?.textAlignment === 2) {
    textAlign = 2;
  }

  const topColor = pane?.textTopColor ?? { r: 32, g: 32, b: 32, a: 255 };
  const bottomColor = pane?.textBottomColor ?? topColor;

  // Wii does NOT word-wrap text — only explicit \n causes line breaks.
  const lines = paragraphs;
  if (lines.length === 0) {
    return;
  }

  const lineHeight = Math.max(1, fontSize + lineSpacing);
  const contentHeight = lineHeight * lines.length;

  // Use a scratch canvas so we can apply color tinting with source-in composite.
  const surfW = Math.max(1, Math.ceil(absWidth));
  const surfH = Math.max(1, Math.ceil(absHeight));

  if (!this.textScratchSurface) {
    this.textScratchSurface = document.createElement("canvas");
    this.textScratchContext = this.textScratchSurface.getContext("2d");
  }
  if (this.textScratchSurface.width !== surfW || this.textScratchSurface.height !== surfH) {
    this.textScratchSurface.width = surfW;
    this.textScratchSurface.height = surfH;
  }

  const scratchCtx = this.textScratchContext;
  scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
  scratchCtx.clearRect(0, 0, surfW, surfH);
  scratchCtx.save();

  // Draw in local coordinates (0,0 = top-left of pane).
  const textY = Math.max(0, (absHeight - contentHeight) / 2);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx];
    const lineWidth = this.measureBitmapTextLine(fontData, line, fontSize, charSpacing);

    let xPos;
    if (textAlign === 1) {
      xPos = (absWidth - lineWidth) / 2;
    } else if (textAlign === 2) {
      xPos = absWidth - lineWidth;
    } else {
      xPos = 0;
    }

    const yPos = textY + lineIdx * lineHeight;

    for (let i = 0; i < line.length; i += 1) {
      const charCode = line.charCodeAt(i);
      const glyph = this.getGlyphInfo(fontData, charCode);
      if (!glyph) {
        continue;
      }

      const sheet = fontData.sheets[glyph.sheetIndex];
      if (!sheet) {
        continue;
      }

      // Source rect in glyph sheet (pixel coords).
      const srcX = glyph.s1 * sheet.width;
      const srcY = glyph.t1 * sheet.height;
      const srcW = (glyph.s2 - glyph.s1) * sheet.width;
      const srcH = (glyph.t2 - glyph.t1) * sheet.height;

      // Destination rect.
      const dstW = srcW * scale;
      const dstH = srcH * scale;

      // Apply kerning only when glyph is visible.
      if (glyph.glyphWidth > 0) {
        xPos += glyph.kerning * scale;
      }

      scratchCtx.drawImage(sheet, srcX, srcY, srcW, srcH, xPos, yPos, dstW, dstH);

      xPos += glyph.advance * scale + charSpacing;
    }
  }

  // Apply top/bottom color gradient tinting.
  // Font textures are grayscale — tint the drawn glyphs using source-in composite.
  const sameColor =
    topColor.r === bottomColor.r &&
    topColor.g === bottomColor.g &&
    topColor.b === bottomColor.b &&
    topColor.a === bottomColor.a;

  scratchCtx.globalCompositeOperation = "source-in";
  if (sameColor) {
    scratchCtx.fillStyle = buildCssColor(topColor);
    scratchCtx.fillRect(0, 0, surfW, surfH);
  } else {
    const gradient = scratchCtx.createLinearGradient(0, 0, 0, surfH);
    gradient.addColorStop(0, buildCssColor(topColor));
    gradient.addColorStop(1, buildCssColor(bottomColor));
    scratchCtx.fillStyle = gradient;
    scratchCtx.fillRect(0, 0, surfW, surfH);
  }
  scratchCtx.globalCompositeOperation = "source-over";
  scratchCtx.restore();

  // Composite the tinted text onto the main context.
  context.drawImage(this.textScratchSurface, -width / 2, -height / 2, width, height);
}
