import { withLogger } from "../shared/index";
import { decodeTPLImage } from "./tpl";

// BRFNT / RFNT binary font parser.
// Parses Wii bitmap font files containing glyph texture sheets, character maps, and widths.
// Reference: giantpune/wii-system-menu-player WiiFont.h / WiiFont.cpp

const MAGIC_RFNT = 0x52464E54; // 'RFNT'
const MAGIC_RFNA = 0x52464E41; // 'RFNA' (font archive, compressed sheets)
const MAGIC_VERSION = 0xFEFF0104;

const MAGIC_FINF = 0x46494E46; // 'FINF'
const MAGIC_TGLP = 0x54474C50; // 'TGLP'
const MAGIC_CMAP = 0x434D4150; // 'CMAP'
const MAGIC_CWDH = 0x43574448; // 'CWDH'
const MAGIC_GLGR = 0x474C4752; // 'GLGR'

export function parseBRFNT(buffer, loggerInput) {
  const logger = withLogger(loggerInput);

  if (!buffer || buffer.byteLength < 16) {
    logger.warn("BRFNT: buffer too small");
    return null;
  }

  const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset ?? 0, buffer.byteLength);
  let offset = 0;

  const magic = view.getUint32(offset, false);
  offset += 4;

  if (magic === MAGIC_RFNA) {
    logger.warn("BRFNT: RFNA (font archive) format not supported — compressed glyph sheets require Decompress_0x28");
    return null;
  }

  if (magic !== MAGIC_RFNT) {
    logger.warn(`BRFNT: unexpected magic 0x${magic.toString(16)}`);
    return null;
  }

  const version = view.getUint32(offset, false);
  offset += 4;
  if (version !== MAGIC_VERSION) {
    logger.warn(`BRFNT: unexpected version 0x${version.toString(16)}`);
    return null;
  }

  const filesize = view.getUint32(offset, false);
  offset += 4;
  const headerLen = view.getUint16(offset, false);
  offset += 2;
  const sectionCount = view.getUint16(offset, false);
  offset += 2;

  logger.info(`BRFNT: filesize=${filesize}, headerLen=${headerLen}, sections=${sectionCount}`);

  let fontInfo = null;
  let glyphInfo = null;
  const charWidths = new Map();
  const charMap = new Map();
  let tglpRaw = null; // raw TGLP data for sheet decoding

  let pos = headerLen;

  for (let i = 0; i < sectionCount; i += 1) {
    if (pos + 8 > view.byteLength) {
      break;
    }

    const sectionMagic = view.getUint32(pos, false);
    const sectionSize = view.getUint32(pos + 4, false);

    if (sectionSize < 8 || pos + sectionSize > view.byteLength) {
      logger.warn(`BRFNT: section ${i} has invalid size ${sectionSize}`);
      break;
    }

    const sectionDataStart = pos + 8;

    if (sectionMagic === MAGIC_FINF) {
      fontInfo = parseFINF(view, sectionDataStart, logger);
    } else if (sectionMagic === MAGIC_TGLP) {
      tglpRaw = parseTGLP(view, sectionDataStart, logger);
      if (tglpRaw) {
        glyphInfo = {
          cellWidth: tglpRaw.cellWidth,
          cellHeight: tglpRaw.cellHeight,
          baselinePos: tglpRaw.baselinePos,
          maxCharWidth: tglpRaw.maxCharWidth,
          texSize: tglpRaw.texSize,
          texCnt: tglpRaw.texCnt,
          texFormat: tglpRaw.texFormat,
          charColumns: tglpRaw.charColumns,
          charRows: tglpRaw.charRows,
          sheetWidth: tglpRaw.sheetWidth,
          sheetHeight: tglpRaw.sheetHeight,
        };
      }
    } else if (sectionMagic === MAGIC_CMAP) {
      parseCMAP(view, sectionDataStart, charMap, logger);
    } else if (sectionMagic === MAGIC_CWDH) {
      parseCWDH(view, sectionDataStart, charWidths, logger);
    } else if (sectionMagic === MAGIC_GLGR) {
      logger.info("BRFNT: GLGR section found (font archive metadata), skipping");
    } else {
      const magicStr = String.fromCharCode(
        (sectionMagic >> 24) & 0xFF,
        (sectionMagic >> 16) & 0xFF,
        (sectionMagic >> 8) & 0xFF,
        sectionMagic & 0xFF,
      );
      logger.info(`BRFNT: unknown section '${magicStr}', skipping`);
    }

    pos += sectionSize;
  }

  if (!fontInfo) {
    logger.warn("BRFNT: missing FINF section");
    return null;
  }

  if (!glyphInfo || !tglpRaw) {
    logger.warn("BRFNT: missing TGLP section");
    return null;
  }

  // Decode glyph texture sheets using the TPL decoder.
  const sheets = decodeGlyphSheets(view, tglpRaw, logger);

  logger.info(
    `BRFNT: ${fontInfo.height}px font, ${sheets.length} sheet(s), ${charMap.size} mapped chars, ${charWidths.size} widths`,
  );

  return { fontInfo, glyphInfo, charWidths, charMap, sheets };
}

function parseFINF(view, offset, logger) {
  if (offset + 19 > view.byteLength) {
    logger.warn("BRFNT: FINF section too small");
    return null;
  }

  let o = offset;
  const fontType = view.getUint8(o);
  o += 1;
  const leading = view.getInt8(o);
  o += 1;
  const defaultChar = view.getUint16(o, false);
  o += 2;
  const leftMargin = view.getUint8(o);
  o += 1;
  const charWidth = view.getUint8(o);
  o += 1;
  const fullWidth = view.getUint8(o);
  o += 1;
  const encoding = view.getUint8(o);
  o += 1;
  const tglpOffset = view.getUint32(o, false);
  o += 4;
  const cwdhOffset = view.getUint32(o, false);
  o += 4;
  const cmapOffset = view.getUint32(o, false);
  o += 4;
  const height = view.getUint8(o);
  o += 1;
  const width = view.getUint8(o);
  o += 1;
  const ascent = view.getUint8(o);

  logger.info(
    `BRFNT FINF: ${width}x${height}, ascent=${ascent}, defaultChar=0x${defaultChar.toString(16)}, encoding=${encoding}`,
  );

  return {
    fontType,
    leading,
    defaultChar,
    leftMargin,
    charWidth,
    fullWidth,
    encoding,
    tglpOffset,
    cwdhOffset,
    cmapOffset,
    height,
    width,
    ascent,
  };
}

function parseTGLP(view, offset, logger) {
  if (offset + 24 > view.byteLength) {
    logger.warn("BRFNT: TGLP section too small");
    return null;
  }

  let o = offset;
  // cellWidth and cellHeight are stored as value-1 (ref: WiiFont.h "font width - 1")
  const cellWidth = view.getUint8(o) + 1;
  o += 1;
  const cellHeight = view.getUint8(o) + 1;
  o += 1;
  const baselinePos = view.getInt8(o);
  o += 1;
  const maxCharWidth = view.getUint8(o);
  o += 1;
  const texSize = view.getUint32(o, false);
  o += 4;
  const texCnt = view.getUint16(o, false);
  o += 2;
  const texFormat = view.getUint16(o, false);
  o += 2;
  const charColumns = view.getUint16(o, false);
  o += 2;
  const charRows = view.getUint16(o, false);
  o += 2;
  const sheetWidth = view.getUint16(o, false);
  o += 2;
  const sheetHeight = view.getUint16(o, false);
  o += 2;
  const dataOffset = view.getUint32(o, false);

  logger.info(
    `BRFNT TGLP: cell=${cellWidth}x${cellHeight}, sheets=${texCnt}, format=${texFormat & 0x7FFF}, ` +
      `grid=${charColumns}x${charRows}, sheet=${sheetWidth}x${sheetHeight}, dataOffset=0x${dataOffset.toString(16)}`,
  );

  return {
    cellWidth,
    cellHeight,
    baselinePos,
    maxCharWidth,
    texSize,
    texCnt,
    texFormat,
    charColumns,
    charRows,
    sheetWidth,
    sheetHeight,
    dataOffset,
  };
}

function parseCMAP(view, offset, charMap, logger) {
  // CMAP sections can be chained via pos field.
  // We parse the first one here; chained sections appear as separate CMAP sections in the file.
  if (offset + 12 > view.byteLength) {
    logger.warn("BRFNT: CMAP entry too small");
    return;
  }

  let o = offset;
  const start = view.getUint16(o, false);
  o += 2;
  const end = view.getUint16(o, false);
  o += 2;
  const type = view.getUint16(o, false);
  o += 2;
  o += 2; // padding
  const nextPos = view.getUint32(o, false);
  o += 4;

  if (type === 0) {
    // DIRECT: linear mapping starting at firstIndex
    const firstIndex = view.getUint16(o, false);
    for (let code = start; code < end; code += 1) {
      const glyphIndex = firstIndex + (code - start);
      charMap.set(code, glyphIndex);
    }
    logger.info(`BRFNT CMAP type=DIRECT: [0x${start.toString(16)}..0x${end.toString(16)}) -> start=${firstIndex}`);
  } else if (type === 1) {
    // TABLE: array of u16, one per code
    for (let code = start; code < end; code += 1) {
      if (o + 2 > view.byteLength) {
        break;
      }
      const glyphIndex = view.getUint16(o, false);
      o += 2;
      if (glyphIndex !== 0xFFFF) {
        charMap.set(code, glyphIndex);
      }
    }
    logger.info(`BRFNT CMAP type=TABLE: [0x${start.toString(16)}..0x${end.toString(16)})`);
  } else if (type === 2) {
    // SCAN: numEntries pairs of (charCode, glyphIndex)
    const numEntries = view.getUint16(o, false);
    o += 2;
    for (let i = 0; i < numEntries; i += 1) {
      if (o + 4 > view.byteLength) {
        break;
      }
      const charCode = view.getUint16(o, false);
      o += 2;
      const glyphIndex = view.getUint16(o, false);
      o += 2;
      charMap.set(charCode, glyphIndex);
    }
    logger.info(`BRFNT CMAP type=SCAN: ${numEntries} entries`);
  } else {
    logger.warn(`BRFNT CMAP: unknown type ${type}`);
  }
}

function parseCWDH(view, offset, charWidths, logger) {
  if (offset + 8 > view.byteLength) {
    logger.warn("BRFNT: CWDH section too small");
    return;
  }

  let o = offset;
  const startIdx = view.getUint16(o, false);
  o += 2;
  const endIdx = view.getUint16(o, false);
  o += 2;
  const next = view.getUint32(o, false);
  o += 4;

  // Each entry is 3 bytes: advanceKerning (s8), glyphWidth (u8), advanceGlyphX (s8)
  for (let idx = startIdx; idx <= endIdx; idx += 1) {
    if (o + 3 > view.byteLength) {
      break;
    }
    const kerning = view.getInt8(o);
    o += 1;
    const glyphWidth = view.getUint8(o);
    o += 1;
    const advance = view.getInt8(o);
    o += 1;
    charWidths.set(idx, { kerning, glyphWidth, advance });
  }

  logger.info(`BRFNT CWDH: indices [${startIdx}..${endIdx}], ${endIdx - startIdx + 1} entries`);
}

function decodeGlyphSheets(view, tglp, logger) {
  const sheets = [];
  const format = tglp.texFormat & 0x7FFF;
  const { sheetWidth, sheetHeight, texSize, texCnt, dataOffset } = tglp;

  for (let i = 0; i < texCnt; i += 1) {
    const sheetOffset = dataOffset + i * texSize;
    if (sheetOffset + texSize > view.byteLength) {
      logger.warn(`BRFNT: sheet ${i} extends beyond buffer`);
      break;
    }

    const src = new Uint8Array(view.buffer, view.byteOffset + sheetOffset, texSize);

    try {
      const imageData = decodeTPLImage(src, sheetWidth, sheetHeight, format, null, logger);
      sheets.push({ width: sheetWidth, height: sheetHeight, imageData });
    } catch (error) {
      logger.warn(`BRFNT: failed to decode sheet ${i}: ${error.message}`);
    }
  }

  return sheets;
}
