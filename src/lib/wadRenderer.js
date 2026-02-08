import { gsap } from "gsap";

const NOOP_LOGGER = {
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  clear: () => {},
};

function withLogger(logger) {
  return logger ?? NOOP_LOGGER;
}

class BinaryReader {
  constructor(buffer, offset = 0) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.offset = offset;
  }

  u8() {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  u16() {
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  u32() {
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  f32() {
    const value = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return value;
  }

  skip(count) {
    this.offset += count;
  }

  seek(position) {
    this.offset = position;
  }

  slice(length) {
    const value = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  string(length) {
    let value = "";
    for (let i = 0; i < length; i += 1) {
      const code = this.view.getUint8(this.offset + i);
      if (code === 0) {
        break;
      }
      value += String.fromCharCode(code);
    }
    this.offset += length;
    return value;
  }

  nullString() {
    let value = "";
    while (this.offset < this.buffer.byteLength) {
      const code = this.view.getUint8(this.offset);
      this.offset += 1;
      if (code === 0) {
        break;
      }
      value += String.fromCharCode(code);
    }
    return value;
  }
}

function align(offset, alignment) {
  return Math.ceil(offset / alignment) * alignment;
}

const WII_COMMON_KEYS = [
  "ebe42a225e8593e448d9c5457381aaf7",
  "63b82bb4f4614e2e13f2fefbba4c9b7e",
  "30bfc76e7c19afbb23163330ced7c28d",
];

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function concatBytes(left, right) {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

function xorBytes(left, right) {
  const out = new Uint8Array(left.length);
  for (let i = 0; i < left.length; i += 1) {
    out[i] = left[i] ^ right[i];
  }
  return out;
}

function hasSubtleCrypto() {
  return Boolean(globalThis.crypto?.subtle);
}

async function importAesCbcKey(rawKeyBytes) {
  return globalThis.crypto.subtle.importKey("raw", rawKeyBytes, { name: "AES-CBC" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptAesBlockNoPadding(key, inputBlock) {
  const iv = new Uint8Array(16);
  const encrypted = await globalThis.crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, inputBlock);
  return new Uint8Array(encrypted).slice(0, 16);
}

async function decryptAesCbcNoPadding(key, ciphertextBytes, ivBytes) {
  if (ciphertextBytes.length === 0) {
    return new Uint8Array();
  }

  if (ciphertextBytes.length % 16 !== 0) {
    throw new Error(`AES-CBC ciphertext length must be a multiple of 16 (got ${ciphertextBytes.length})`);
  }

  // WebCrypto AES-CBC only supports PKCS#7 padding. We append one synthetic
  // block that decrypts to a full padding block, then trim it away.
  const padBlock = new Uint8Array(16);
  padBlock.fill(16);
  const lastCipherBlock = ciphertextBytes.slice(ciphertextBytes.length - 16);
  const syntheticInput = xorBytes(lastCipherBlock, padBlock);
  const syntheticCipherBlock = await encryptAesBlockNoPadding(key, syntheticInput);
  const extendedCiphertext = concatBytes(ciphertextBytes, syntheticCipherBlock);

  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: "AES-CBC", iv: ivBytes },
    key,
    extendedCiphertext,
  );

  return new Uint8Array(plaintext);
}

function decodeLz77(data, sizeMode = "be") {
  if (data.byteLength < 8) {
    throw new Error("LZ77 payload too small");
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (tag !== "LZ77") {
    throw new Error(`Invalid LZ77 tag: ${tag}`);
  }

  const type = data[4];
  const outSize =
    sizeMode === "be"
      ? (data[5] << 16) | (data[6] << 8) | data[7]
      : (data[7] << 16) | (data[6] << 8) | data[5];
  if (outSize <= 0) {
    throw new Error("Invalid LZ77 output size");
  }

  // Only type 0x10/0x11 are expected in Wii assets.
  if (type !== 0x10 && type !== 0x11) {
    throw new Error(`Unsupported LZ77 type 0x${type.toString(16)}`);
  }

  const out = new Uint8Array(outSize);
  let src = 8;
  let dst = 0;

  while (dst < outSize && src < data.byteLength) {
    const flags = data[src];
    src += 1;

    for (let bit = 0; bit < 8 && dst < outSize && src < data.byteLength; bit += 1) {
      const compressed = ((flags >> (7 - bit)) & 1) !== 0;
      if (!compressed) {
        out[dst] = data[src];
        dst += 1;
        src += 1;
        continue;
      }

      if (src + 1 >= data.byteLength) {
        break;
      }

      const b1 = data[src];
      const b2 = data[src + 1];
      src += 2;

      const disp = ((b1 & 0x0f) << 8) | b2;
      let length;
      if (type === 0x11) {
        // LZ11 variant.
        const hi = b1 >> 4;
        if (hi === 0) {
          if (src >= data.byteLength) {
            break;
          }
          length = data[src] + 0x11;
          src += 1;
        } else if (hi === 1) {
          if (src + 1 >= data.byteLength) {
            break;
          }
          length = ((data[src] << 8) | data[src + 1]) + 0x111;
          src += 2;
        } else {
          length = hi + 1;
        }
      } else {
        // LZ10 variant.
        length = (b1 >> 4) + 3;
      }

      let ref = dst - (disp + 1);
      for (let i = 0; i < length && dst < outSize; i += 1) {
        out[dst] = ref >= 0 ? out[ref] : 0;
        dst += 1;
        ref += 1;
      }
    }
  }

  return out.buffer;
}

function decodeYaz0(data) {
  if (data.byteLength < 16) {
    throw new Error("Yaz0 payload too small");
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (magic !== "Yaz0") {
    throw new Error(`Invalid Yaz0 magic: ${magic}`);
  }

  const outSize = view.getUint32(4, false);
  const out = new Uint8Array(outSize);

  let src = 16;
  let dst = 0;
  let validBits = 0;
  let code = 0;

  while (dst < outSize && src < data.byteLength) {
    if (validBits === 0) {
      code = data[src];
      src += 1;
      validBits = 8;
    }

    if ((code & 0x80) !== 0) {
      out[dst] = data[src];
      dst += 1;
      src += 1;
    } else {
      if (src + 1 >= data.byteLength) {
        break;
      }

      const b1 = data[src];
      const b2 = data[src + 1];
      src += 2;

      const dist = ((b1 & 0x0f) << 8) | b2;
      let copyLen = b1 >> 4;
      if (copyLen === 0) {
        if (src >= data.byteLength) {
          break;
        }
        copyLen = data[src] + 0x12;
        src += 1;
      } else {
        copyLen += 2;
      }

      let ref = dst - (dist + 1);
      for (let i = 0; i < copyLen && dst < outSize; i += 1) {
        out[dst] = ref >= 0 ? out[ref] : 0;
        dst += 1;
        ref += 1;
      }
    }

    code = (code << 1) & 0xff;
    validBits -= 1;
  }

  return out.buffer;
}

export const TPL_FORMATS = {
  0: "I4",
  1: "I8",
  2: "IA4",
  3: "IA8",
  4: "RGB565",
  5: "RGB5A3",
  6: "RGBA8",
  8: "CI4",
  9: "CI8",
  10: "CI14X2",
  14: "CMPR",
};

export const ANIM_TYPES = {
  0x00: "X Translation",
  0x01: "Y Translation",
  0x02: "Z Translation",
  0x03: "X Rotation",
  0x04: "Y Rotation",
  0x05: "Z Rotation",
  0x06: "X Scale",
  0x07: "Y Scale",
  0x08: "Width",
  0x09: "Height",
  0x0a: "Alpha",
};

export function parseWAD(buffer, loggerInput) {
  const logger = withLogger(loggerInput);
  const reader = new BinaryReader(buffer);

  const headerSize = reader.u32();
  const wadType = reader.u32();
  const certChainSize = reader.u32();
  reader.skip(4); // reserved
  const ticketSize = reader.u32();
  const tmdSize = reader.u32();
  const dataSize = reader.u32();
  reader.skip(4); // footer size

  logger.info(
    `WAD header: type=0x${wadType.toString(16)}, certChain=${certChainSize}, ticket=${ticketSize}, tmd=${tmdSize}, data=${dataSize}`,
  );

  let offset = align(headerSize, 64);
  offset += align(certChainSize, 64);
  const ticketOffset = offset;
  offset += align(ticketSize, 64);
  const tmdOffset = offset;

  const tmdReader = new BinaryReader(buffer, tmdOffset);
  tmdReader.skip(0x1de);
  const numContents = tmdReader.u16();

  logger.info(`TMD: ${numContents} content(s)`);

  const contentRecords = [];
  tmdReader.seek(tmdOffset + 0x1e4);
  for (let i = 0; i < numContents; i += 1) {
    const contentId = tmdReader.u32();
    const index = tmdReader.u16();
    const type = tmdReader.u16();
    const sizeHigh = tmdReader.u32();
    const sizeLow = tmdReader.u32();
    tmdReader.slice(20); // hash

    const size = Number((BigInt(sizeHigh) << 32n) | BigInt(sizeLow));
    contentRecords.push({ contentId, index, type, size });
  }

  offset += align(tmdSize, 64);
  const dataOffset = offset;

  const contents = {};
  let contentOffset = dataOffset;
  for (const record of contentRecords) {
    const name = `${record.contentId.toString(16).padStart(8, "0")}.app`;
    record.name = name;
    record.offset = contentOffset;
    record.encryptedSize = align(record.size, 16);
    contents[name] = buffer.slice(contentOffset, contentOffset + record.size);
    logger.info(`Content: ${name} (${record.size} bytes)`);
    contentOffset += align(record.size, 64);
  }

  const ticketBytes = new Uint8Array(buffer, ticketOffset, ticketSize);
  const titleIdBytes = ticketBytes.slice(0x1dc, 0x1dc + 8);
  const encryptedTitleKey = ticketBytes.slice(0x1bf, 0x1bf + 16);
  const commonKeyIndex = ticketBytes.length > 0x1f1 ? ticketBytes[0x1f1] : 0;

  let titleId = "";
  for (let i = 4; i < 8; i += 1) {
    const code = titleIdBytes[i];
    titleId += code >= 32 && code < 127 ? String.fromCharCode(code) : "?";
  }

  return {
    sourceBuffer: buffer,
    contents,
    contentRecords,
    numContents,
    titleId,
    wadType,
    ticket: {
      encryptedTitleKey,
      titleIdBytes,
      commonKeyIndex,
      ticketSize,
      ticketOffset,
    },
  };
}

export function parseU8(buffer, loggerInput) {
  const logger = withLogger(loggerInput);
  const reader = new BinaryReader(buffer);

  const magic = reader.u32();
  if (magic !== 0x55aa382d) {
    reader.seek(0);
    const tag = reader.string(4);
    reader.seek(0);

    if (tag === "IMD5") {
      logger.info("Found IMD5 header, skipping 32 bytes");
      return parseU8(buffer.slice(32), logger);
    }

    if (tag === "LZ77") {
      logger.info("Found LZ77 stream, decompressing");
      const source = new Uint8Array(buffer);

      const attempts = [
        { mode: "be", label: "big-endian" },
        { mode: "le", label: "little-endian" },
      ];

      function scoreParsedFiles(files) {
        const entries = Object.entries(files);
        if (entries.length === 0) {
          return -1;
        }

        let nonEmpty = 0;
        let totalBytes = 0;
        let renderableNonEmpty = 0;

        for (const [path, data] of entries) {
          const size = data.byteLength;
          if (size > 0) {
            nonEmpty += 1;
            totalBytes += size;
          }

          const lower = path.toLowerCase();
          const isRenderable =
            lower.endsWith(".tpl") ||
            lower.endsWith(".brlyt") ||
            lower.endsWith(".brlan") ||
            lower.endsWith(".bin") ||
            lower.endsWith(".szs");
          if (isRenderable && size > 0) {
            renderableNonEmpty += 1;
          }
        }

        // Prioritize attempts that produce actual non-empty renderable payloads.
        return renderableNonEmpty * 1_000_000 + nonEmpty * 10_000 + Math.min(totalBytes, 9_999);
      }

      let bestAttempt = null;
      let lastError = null;
      for (const attempt of attempts) {
        try {
          const decompressed = decodeLz77(source, attempt.mode);
          const parsed = parseU8(decompressed, NOOP_LOGGER);
          const score = scoreParsedFiles(parsed);

          if (
            !bestAttempt ||
            score > bestAttempt.score ||
            (score === bestAttempt.score && decompressed.byteLength < bestAttempt.decompressed.byteLength)
          ) {
            bestAttempt = { ...attempt, score, decompressed };
          }
        } catch (error) {
          lastError = error;
        }
      }

      if (bestAttempt) {
        logger.info(`LZ77 decompressed using ${bestAttempt.label} size mode`);
        return parseU8(bestAttempt.decompressed, logger);
      }

      throw new Error(`Failed to decompress LZ77 stream: ${lastError?.message ?? "unknown error"}`);
    }

    if (tag === "Yaz0") {
      logger.info("Found Yaz0 stream, decompressing");
      const decompressed = decodeYaz0(new Uint8Array(buffer));
      return parseU8(decompressed, logger);
    }

    const view = new DataView(buffer);
    const maxOffset = buffer.byteLength - 4;
    for (let i = 0; i <= maxOffset; i += 1) {
      if (view.getUint32(i, false) !== 0x55aa382d) {
        continue;
      }

      // Validate likely U8 structure before recursing.
      if (i + 16 > buffer.byteLength) {
        continue;
      }

      const rootNodeOffset = view.getUint32(i + 4, false);
      if (rootNodeOffset < 0x10 || i + rootNodeOffset + 12 > buffer.byteLength) {
        continue;
      }

      const rootType = view.getUint8(i + rootNodeOffset);
      const rootNumEntries = view.getUint32(i + rootNodeOffset + 8, false);
      if (rootType !== 1 || rootNumEntries < 1) {
        continue;
      }

      const stringTableOffset = i + rootNodeOffset + rootNumEntries * 12;
      if (stringTableOffset >= buffer.byteLength) {
        continue;
      }

      logger.info(`Found U8 magic at offset ${i}`);
      return parseU8(buffer.slice(i), logger);
    }

    throw new Error(`Not a U8 archive (magic: 0x${magic.toString(16)})`);
  }

  const rootNodeOffset = reader.u32();
  reader.u32(); // nodesSize
  reader.u32(); // dataOffset

  reader.seek(rootNodeOffset);

  const rootType = reader.u8();
  const rootNameOffset = (reader.u8() << 16) | reader.u16();
  const rootDataOffset = reader.u32();
  const rootNumEntries = reader.u32();

  const stringTableOffset = rootNodeOffset + rootNumEntries * 12;

  const nodes = [
    {
      type: rootType,
      nameOffset: rootNameOffset,
      dataOffset: rootDataOffset,
      size: rootNumEntries,
    },
  ];

  for (let i = 1; i < rootNumEntries; i += 1) {
    const type = reader.u8();
    const nameOffset = (reader.u8() << 16) | reader.u16();
    const dataOffset = reader.u32();
    const size = reader.u32();
    nodes.push({ type, nameOffset, dataOffset, size });
  }

  const files = {};
  const dirStack = [{ name: "", end: rootNumEntries }];

  for (let i = 1; i < rootNumEntries; i += 1) {
    const node = nodes[i];

    while (dirStack.length > 1 && i >= dirStack[dirStack.length - 1].end) {
      dirStack.pop();
    }

    const pathPrefix = dirStack
      .map((dir) => dir.name)
      .filter(Boolean)
      .join("/");

    const nameReader = new BinaryReader(buffer, stringTableOffset + node.nameOffset);
    const name = nameReader.nullString();

    if (node.type === 1) {
      dirStack.push({ name, end: node.size });
      continue;
    }

    const fullPath = pathPrefix ? `${pathPrefix}/${name}` : name;
    files[fullPath] = buffer.slice(node.dataOffset, node.dataOffset + node.size);
    logger.info(`  U8 file: ${fullPath} (${node.size} bytes)`);
  }

  return files;
}

function decodeTPLImage(src, width, height, format, palette, logger) {
  const pixels = new Uint8ClampedArray(width * height * 4);

  function setPixel(x, y, red, green, blue, alpha) {
    if (x >= width || y >= height) {
      return;
    }

    const index = (y * width + x) * 4;
    pixels[index] = red;
    pixels[index + 1] = green;
    pixels[index + 2] = blue;
    pixels[index + 3] = alpha;
  }

  function decodeRGB5A3(value) {
    if (value & 0x8000) {
      const red = (((value >> 10) & 0x1f) * 255) / 31;
      const green = (((value >> 5) & 0x1f) * 255) / 31;
      const blue = ((value & 0x1f) * 255) / 31;
      return [red, green, blue, 255];
    }

    const alpha = (((value >> 12) & 0x7) * 255) / 7;
    const red = (((value >> 8) & 0xf) * 255) / 15;
    const green = (((value >> 4) & 0xf) * 255) / 15;
    const blue = ((value & 0xf) * 255) / 15;
    return [red, green, blue, alpha];
  }

  function decodePaletteColor(activePalette, index) {
    if (!activePalette || index >= activePalette.count) {
      return [0, 0, 0, 255];
    }

    const value = activePalette.data.getUint16(index * 2, false);

    if (activePalette.format === 0) {
      const intensity = (value >> 8) & 0xff;
      const alpha = value & 0xff;
      return [intensity, intensity, intensity, alpha];
    }

    if (activePalette.format === 1) {
      const red = (((value >> 11) & 0x1f) * 255) / 31;
      const green = (((value >> 5) & 0x3f) * 255) / 63;
      const blue = ((value & 0x1f) * 255) / 31;
      return [red, green, blue, 255];
    }

    return decodeRGB5A3(value);
  }

  let srcOffset = 0;

  switch (format) {
    case 0: {
      for (let blockY = 0; blockY < height; blockY += 8) {
        for (let blockX = 0; blockX < width; blockX += 8) {
          for (let y = 0; y < 8; y += 1) {
            for (let x = 0; x < 8; x += 2) {
              if (srcOffset >= src.length) {
                break;
              }
              const byte = src[srcOffset];
              srcOffset += 1;

              const i1 = ((byte >> 4) & 0xf) * 17;
              const i2 = (byte & 0xf) * 17;
              setPixel(blockX + x, blockY + y, i1, i1, i1, 255);
              setPixel(blockX + x + 1, blockY + y, i2, i2, i2, 255);
            }
          }
        }
      }
      break;
    }

    case 1: {
      for (let blockY = 0; blockY < height; blockY += 4) {
        for (let blockX = 0; blockX < width; blockX += 8) {
          for (let y = 0; y < 4; y += 1) {
            for (let x = 0; x < 8; x += 1) {
              if (srcOffset >= src.length) {
                break;
              }

              const intensity = src[srcOffset];
              srcOffset += 1;
              setPixel(blockX + x, blockY + y, intensity, intensity, intensity, 255);
            }
          }
        }
      }
      break;
    }

    case 2: {
      for (let blockY = 0; blockY < height; blockY += 4) {
        for (let blockX = 0; blockX < width; blockX += 8) {
          for (let y = 0; y < 4; y += 1) {
            for (let x = 0; x < 8; x += 1) {
              if (srcOffset >= src.length) {
                break;
              }

              const byte = src[srcOffset];
              srcOffset += 1;
              const alpha = ((byte >> 4) & 0xf) * 17;
              const intensity = (byte & 0xf) * 17;
              setPixel(blockX + x, blockY + y, intensity, intensity, intensity, alpha);
            }
          }
        }
      }
      break;
    }

    case 3: {
      for (let blockY = 0; blockY < height; blockY += 4) {
        for (let blockX = 0; blockX < width; blockX += 4) {
          for (let y = 0; y < 4; y += 1) {
            for (let x = 0; x < 4; x += 1) {
              if (srcOffset + 1 >= src.length) {
                break;
              }

              const alpha = src[srcOffset];
              const intensity = src[srcOffset + 1];
              srcOffset += 2;
              setPixel(blockX + x, blockY + y, intensity, intensity, intensity, alpha);
            }
          }
        }
      }
      break;
    }

    case 4: {
      for (let blockY = 0; blockY < height; blockY += 4) {
        for (let blockX = 0; blockX < width; blockX += 4) {
          for (let y = 0; y < 4; y += 1) {
            for (let x = 0; x < 4; x += 1) {
              if (srcOffset + 1 >= src.length) {
                break;
              }

              const value = (src[srcOffset] << 8) | src[srcOffset + 1];
              srcOffset += 2;

              const red = (((value >> 11) & 0x1f) * 255) / 31;
              const green = (((value >> 5) & 0x3f) * 255) / 63;
              const blue = ((value & 0x1f) * 255) / 31;
              setPixel(blockX + x, blockY + y, red, green, blue, 255);
            }
          }
        }
      }
      break;
    }

    case 5: {
      for (let blockY = 0; blockY < height; blockY += 4) {
        for (let blockX = 0; blockX < width; blockX += 4) {
          for (let y = 0; y < 4; y += 1) {
            for (let x = 0; x < 4; x += 1) {
              if (srcOffset + 1 >= src.length) {
                break;
              }

              const value = (src[srcOffset] << 8) | src[srcOffset + 1];
              srcOffset += 2;
              const [red, green, blue, alpha] = decodeRGB5A3(value);
              setPixel(blockX + x, blockY + y, red, green, blue, alpha);
            }
          }
        }
      }
      break;
    }

    case 6: {
      for (let blockY = 0; blockY < height; blockY += 4) {
        for (let blockX = 0; blockX < width; blockX += 4) {
          const ar = [];
          for (let i = 0; i < 16; i += 1) {
            if (srcOffset + 1 >= src.length) {
              ar.push([255, 0]);
              continue;
            }

            ar.push([src[srcOffset], src[srcOffset + 1]]);
            srcOffset += 2;
          }

          const gb = [];
          for (let i = 0; i < 16; i += 1) {
            if (srcOffset + 1 >= src.length) {
              gb.push([0, 0]);
              continue;
            }

            gb.push([src[srcOffset], src[srcOffset + 1]]);
            srcOffset += 2;
          }

          for (let y = 0; y < 4; y += 1) {
            for (let x = 0; x < 4; x += 1) {
              const idx = y * 4 + x;
              setPixel(blockX + x, blockY + y, ar[idx][1], gb[idx][0], gb[idx][1], ar[idx][0]);
            }
          }
        }
      }
      break;
    }

    case 8: {
      for (let blockY = 0; blockY < height; blockY += 8) {
        for (let blockX = 0; blockX < width; blockX += 8) {
          for (let y = 0; y < 8; y += 1) {
            for (let x = 0; x < 8; x += 2) {
              if (srcOffset >= src.length) {
                break;
              }

              const byte = src[srcOffset];
              srcOffset += 1;

              const [r1, g1, b1, a1] = decodePaletteColor(palette, (byte >> 4) & 0xf);
              const [r2, g2, b2, a2] = decodePaletteColor(palette, byte & 0xf);

              setPixel(blockX + x, blockY + y, r1, g1, b1, a1);
              setPixel(blockX + x + 1, blockY + y, r2, g2, b2, a2);
            }
          }
        }
      }
      break;
    }

    case 9: {
      for (let blockY = 0; blockY < height; blockY += 4) {
        for (let blockX = 0; blockX < width; blockX += 8) {
          for (let y = 0; y < 4; y += 1) {
            for (let x = 0; x < 8; x += 1) {
              if (srcOffset >= src.length) {
                break;
              }

              const index = src[srcOffset];
              srcOffset += 1;
              const [red, green, blue, alpha] = decodePaletteColor(palette, index);
              setPixel(blockX + x, blockY + y, red, green, blue, alpha);
            }
          }
        }
      }
      break;
    }

    case 14: {
      function decodeDXT1Block(offset) {
        if (offset + 7 >= src.length) {
          return null;
        }

        const c0 = (src[offset] << 8) | src[offset + 1];
        const c1 = (src[offset + 2] << 8) | src[offset + 3];

        function rgb565ToArray(color) {
          return [
            (((color >> 11) & 0x1f) * 255) / 31,
            (((color >> 5) & 0x3f) * 255) / 63,
            ((color & 0x1f) * 255) / 31,
          ];
        }

        const colors = [rgb565ToArray(c0), rgb565ToArray(c1)];
        if (c0 > c1) {
          colors[2] = colors[0].map((value, i) => (2 * value + colors[1][i]) / 3);
          colors[3] = colors[0].map((value, i) => (value + 2 * colors[1][i]) / 3);
        } else {
          colors[2] = colors[0].map((value, i) => (value + colors[1][i]) / 2);
          colors[3] = [0, 0, 0];
        }

        const indices = [];
        for (let i = 0; i < 4; i += 1) {
          const byte = src[offset + 4 + i];
          indices.push((byte >> 6) & 3, (byte >> 4) & 3, (byte >> 2) & 3, byte & 3);
        }

        return { colors, indices, transparent: c0 <= c1 };
      }

      for (let blockY = 0; blockY < height; blockY += 8) {
        for (let blockX = 0; blockX < width; blockX += 8) {
          for (let subBlock = 0; subBlock < 4; subBlock += 1) {
            const subX = (subBlock & 1) * 4;
            const subY = (subBlock >> 1) * 4;
            const block = decodeDXT1Block(srcOffset);
            srcOffset += 8;

            if (!block) {
              continue;
            }

            for (let py = 0; py < 4; py += 1) {
              for (let px = 0; px < 4; px += 1) {
                const colorIndex = block.indices[py * 4 + px];
                const color = block.colors[colorIndex];
                const alpha = block.transparent && colorIndex === 3 ? 0 : 255;
                setPixel(blockX + subX + px, blockY + subY + py, color[0], color[1], color[2], alpha);
              }
            }
          }
        }
      }
      break;
    }

    default: {
      logger.warn(`Unsupported TPL format: ${format} (${TPL_FORMATS[format] ?? "unknown"})`);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          setPixel(x, y, 255, 0, 255, 255);
        }
      }
    }
  }

  return pixels;
}

export function parseTPL(buffer, loggerInput) {
  const logger = withLogger(loggerInput);
  const reader = new BinaryReader(buffer);

  const magic = reader.u32();
  if (magic !== 0x0020af30) {
    throw new Error(`Not a TPL file (magic: 0x${magic.toString(16)})`);
  }

  const numImages = reader.u32();
  const imageTableOffset = reader.u32();

  const images = [];

  reader.seek(imageTableOffset);
  for (let i = 0; i < numImages; i += 1) {
    const imageHeaderOffset = reader.u32();
    const paletteHeaderOffset = reader.u32();
    const savedOffset = reader.offset;

    reader.seek(imageHeaderOffset);
    const height = reader.u16();
    const width = reader.u16();
    const format = reader.u32();
    const dataOffset = reader.u32();
    reader.skip(16); // wraps + filters
    reader.f32(); // lod bias
    reader.skip(4); // lod flags

    logger.info(`  TPL image ${i}: ${width}x${height}, format=${TPL_FORMATS[format] ?? format}`);

    let palette = null;
    if (paletteHeaderOffset !== 0) {
      reader.seek(paletteHeaderOffset);
      const count = reader.u16();
      reader.skip(2);
      const paletteFormat = reader.u32();
      const paletteDataOffset = reader.u32();
      palette = {
        count,
        format: paletteFormat,
        data: new DataView(buffer, paletteDataOffset, count * 2),
      };
    }

    const imageData = decodeTPLImage(new Uint8Array(buffer, dataOffset), width, height, format, palette, logger);
    images.push({ width, height, format, imageData });

    reader.seek(savedOffset);
  }

  return images;
}

export function parseBRLYT(buffer, loggerInput) {
  const logger = withLogger(loggerInput);
  const reader = new BinaryReader(buffer);

  const magic = reader.string(4);
  if (magic !== "RLYT") {
    throw new Error(`Not a BRLYT: ${magic}`);
  }

  reader.u16(); // BOM
  reader.u16(); // version
  reader.u32(); // file size
  const headerSize = reader.u16();
  const numSections = reader.u16();

  const layout = {
    textures: [],
    materials: [],
    panes: [],
    groups: [],
    width: 608,
    height: 456,
  };

  reader.seek(headerSize);
  const paneParentStack = [];
  let lastPaneName = null;

  for (let sectionIndex = 0; sectionIndex < numSections; sectionIndex += 1) {
    const sectionStart = reader.offset;
    const sectionMagic = reader.string(4);
    const sectionSize = reader.u32();

    switch (sectionMagic) {
      case "lyt1": {
        reader.u8(); // drawFromCenter
        reader.skip(3);
        layout.width = reader.f32();
        layout.height = reader.f32();
        logger.info(`  Layout size: ${layout.width}x${layout.height}`);
        break;
      }

      case "txl1": {
        const numTextures = reader.u16();
        reader.skip(2);

        const offsets = [];
        for (let i = 0; i < numTextures; i += 1) {
          offsets.push(reader.u32());
          reader.skip(4);
        }

        const stringBase = sectionStart + 12;
        for (const offset of offsets) {
          const nameReader = new BinaryReader(buffer, stringBase + offset);
          const textureName = nameReader.nullString();
          layout.textures.push(textureName);
          logger.info(`  Texture ref: ${textureName}`);
        }
        break;
      }

      case "mat1": {
        const numMaterials = reader.u16();
        reader.skip(2);

        const offsets = [];
        for (let i = 0; i < numMaterials; i += 1) {
          offsets.push(reader.u32());
        }

        for (let i = 0; i < numMaterials; i += 1) {
          // mat1 offsets are relative to section start (including section header).
          const materialStart = sectionStart + offsets[i];
          const materialEnd = i + 1 < numMaterials ? sectionStart + offsets[i + 1] : sectionStart + sectionSize;

          reader.seek(materialStart);
          const name = reader.string(20).replace(/\0+$/, "");
          const color1 = [];
          const color2 = [];
          const color3 = [];
          for (let colorIndex = 0; colorIndex < 4; colorIndex += 1) {
            color1.push(reader.view.getUint16(materialStart + 20 + colorIndex * 2, false));
            color2.push(reader.view.getUint16(materialStart + 28 + colorIndex * 2, false));
            color3.push(reader.view.getUint16(materialStart + 36 + colorIndex * 2, false));
          }
          const flagsOffset = materialStart + 60;
          const flags = flagsOffset + 4 <= materialEnd ? reader.view.getUint32(flagsOffset, false) : 0;

          // BRLYT mat1 low nibbles encode texture-map/SRT/coord-gen counts.
          const textureMapCount = flags & 0x0f;
          const textureSrtCount = (flags >> 4) & 0x0f;
          const texCoordGenCount = (flags >> 8) & 0x0f;

          const textureMaps = [];
          let cursor = materialStart + 64;
          for (let mapIndex = 0; mapIndex < textureMapCount && cursor + 3 < materialEnd; mapIndex += 1) {
            const textureIndex = reader.view.getUint16(cursor, false);
            const wrapS = reader.view.getUint8(cursor + 2);
            const wrapT = reader.view.getUint8(cursor + 3);

            textureMaps.push({ textureIndex, wrapS, wrapT });
            cursor += 4;
          }

          const textureSRTs = [];
          for (let srtIndex = 0; srtIndex < textureSrtCount && cursor + 19 < materialEnd; srtIndex += 1) {
            textureSRTs.push({
              xTrans: reader.view.getFloat32(cursor, false),
              yTrans: reader.view.getFloat32(cursor + 4, false),
              rotation: reader.view.getFloat32(cursor + 8, false),
              xScale: reader.view.getFloat32(cursor + 12, false),
              yScale: reader.view.getFloat32(cursor + 16, false),
            });
            cursor += 20;
          }

          // Skip texcoord-gen entries (4 bytes each). We do not consume them yet.
          cursor += texCoordGenCount * 4;

          const textureIndices = [];
          for (const textureMap of textureMaps) {
            const textureIndex = textureMap.textureIndex;
            if (textureIndex === 0xffff || textureIndex >= layout.textures.length) {
              continue;
            }
            if (!textureIndices.includes(textureIndex)) {
              textureIndices.push(textureIndex);
            }
          }

          layout.materials.push({ name, index: i, flags, textureMaps, textureSRTs, textureIndices, color1, color2, color3 });
          logger.info(`  Material: ${name}`);
        }
        break;
      }

      case "pas1": {
        if (lastPaneName) {
          paneParentStack.push(lastPaneName);
        }
        break;
      }

      case "pae1": {
        if (paneParentStack.length > 0) {
          paneParentStack.pop();
        }
        break;
      }

      case "pan1":
      case "pic1":
      case "txt1":
      case "bnd1":
      case "wnd1": {
        const paneFlags = reader.u8();
        const paneOrigin = reader.u8();
        const paneAlpha = reader.u8();
        reader.skip(1);
        const name = reader.string(16).replace(/\0+$/, "");
        reader.skip(8);

        const transX = reader.f32();
        const transY = reader.f32();
        const transZ = reader.f32();
        const rotX = reader.f32();
        const rotY = reader.f32();
        const rotZ = reader.f32();
        const scaleX = reader.f32();
        const scaleY = reader.f32();
        const sizeW = reader.f32();
        const sizeH = reader.f32();

        const pane = {
          type: sectionMagic,
          name,
          flags: paneFlags,
          origin: paneOrigin,
          alpha: paneAlpha,
          visible: (paneFlags & 0x01) !== 0,
          parent: paneParentStack.length > 0 ? paneParentStack[paneParentStack.length - 1] : null,
          translate: { x: transX, y: transY, z: transZ },
          rotate: { x: rotX, y: rotY, z: rotZ },
          scale: { x: scaleX, y: scaleY },
          size: { w: sizeW, h: sizeH },
          materialIndex: -1,
        };

        if (sectionMagic === "pic1") {
          // pic1 extends the 68-byte pan1 block:
          // +16 vertex colors, +2 material index, +1 tex coord count, +1 pad.
          reader.seek(sectionStart + 8 + 68);
          pane.vertexColors = [
            { r: reader.u8(), g: reader.u8(), b: reader.u8(), a: reader.u8() }, // tl
            { r: reader.u8(), g: reader.u8(), b: reader.u8(), a: reader.u8() }, // tr
            { r: reader.u8(), g: reader.u8(), b: reader.u8(), a: reader.u8() }, // bl
            { r: reader.u8(), g: reader.u8(), b: reader.u8(), a: reader.u8() }, // br
          ];
          pane.materialIndex = reader.u16();

          let texCoordCount = reader.u8();
          reader.skip(1);
          pane.texCoords = [];

          const remainingBytes = sectionStart + sectionSize - reader.offset;
          const maxTexCoordCount = Math.max(0, Math.floor(remainingBytes / 32));
          if (texCoordCount > maxTexCoordCount) {
            texCoordCount = maxTexCoordCount;
          }

          for (let i = 0; i < texCoordCount; i += 1) {
            pane.texCoords.push({
              tl: { s: reader.f32(), t: reader.f32() },
              tr: { s: reader.f32(), t: reader.f32() },
              bl: { s: reader.f32(), t: reader.f32() },
              br: { s: reader.f32(), t: reader.f32() },
            });
          }
        }

        layout.panes.push(pane);
        lastPaneName = name;

        if (sectionMagic === "pic1") {
          logger.info(
            `  Pane [pic1]: ${name} at (${transX.toFixed(1)},${transY.toFixed(1)}) size ${sizeW.toFixed(0)}x${sizeH.toFixed(0)} mat=${pane.materialIndex}`,
          );
        } else {
          logger.info(
            `  Pane [${sectionMagic}]: ${name} at (${transX.toFixed(1)},${transY.toFixed(1)}) size ${sizeW.toFixed(0)}x${sizeH.toFixed(0)}`,
          );
        }
        break;
      }

      default:
        break;
    }

    reader.seek(sectionStart + sectionSize);
  }

  return layout;
}

export function parseBRLAN(buffer, loggerInput) {
  const logger = withLogger(loggerInput);
  const reader = new BinaryReader(buffer);

  const magic = reader.string(4);
  if (magic !== "RLAN") {
    throw new Error(`Not a BRLAN: ${magic}`);
  }

  reader.u16(); // BOM
  reader.u16(); // version
  reader.u32(); // file size
  const headerSize = reader.u16();
  const numSections = reader.u16();

  const animation = { frameSize: 0, panes: [] };

  reader.seek(headerSize);

  for (let sectionIndex = 0; sectionIndex < numSections; sectionIndex += 1) {
    const sectionStart = reader.offset;
    const sectionMagic = reader.string(4);
    const sectionSize = reader.u32();

    if (sectionMagic === "pai1") {
      animation.frameSize = reader.u16();
      reader.u8(); // flags
      reader.skip(1);
      reader.u16(); // num timelines
      const numEntries = reader.u16();
      const paneOffsetTableOffset = reader.u32();

      logger.info(`  Animation: ${animation.frameSize} frames, ${numEntries} pane(s)`);

      const paneEntryOffsets = [];
      reader.seek(sectionStart + paneOffsetTableOffset);
      for (let i = 0; i < numEntries; i += 1) {
        paneEntryOffsets.push(reader.u32());
      }

      for (let paneIndex = 0; paneIndex < numEntries; paneIndex += 1) {
        const paneStart = sectionStart + paneEntryOffsets[paneIndex];
        reader.seek(paneStart);

        const paneName = reader.string(20).replace(/\0+$/, "");
        const numTags = reader.u8();
        reader.skip(3);

        const paneAnimation = { name: paneName, tags: [] };

        const tagOffsets = [];
        const tagOffsetsBase = reader.offset;
        for (let tagIndex = 0; tagIndex < numTags; tagIndex += 1) {
          tagOffsets.push(reader.u32());
        }

        for (let tagIndex = 0; tagIndex < numTags; tagIndex += 1) {
          const tagStart = paneStart + tagOffsets[tagIndex];
          reader.seek(tagStart);

          const tagType = reader.string(4);
          const numTagEntries = reader.u8();
          reader.skip(3);

          const tag = { type: tagType, entries: [] };

          const tagEntryOffsets = [];
          const tagEntryOffsetsBase = reader.offset;
          for (let i = 0; i < numTagEntries; i += 1) {
            tagEntryOffsets.push(reader.u32());
          }

          for (let entryIndex = 0; entryIndex < numTagEntries; entryIndex += 1) {
            const entryStart = tagStart + tagEntryOffsets[entryIndex];
            reader.seek(entryStart);

            reader.u8(); // target/type group (unused in current renderer)
            const animType = reader.u8();
            const dataType = reader.u8();
            reader.skip(1);
            const numKeyframes = reader.u16();
            reader.skip(2);
            const keyframeOffset = reader.u32();

            const entry = {
              type: animType,
              dataType,
              typeName: ANIM_TYPES[animType] ?? `0x${animType.toString(16)}`,
              keyframes: [],
            };

            reader.seek(entryStart + keyframeOffset);

            for (let keyframeIndex = 0; keyframeIndex < numKeyframes; keyframeIndex += 1) {
              if (dataType === 2) {
                entry.keyframes.push({ frame: reader.f32(), value: reader.f32(), blend: reader.f32() });
              } else {
                entry.keyframes.push({ frame: reader.f32(), value: reader.f32(), blend: 0 });
              }
            }

            if (entry.keyframes.length > 0) {
              const maxFrame = Math.max(...entry.keyframes.map((keyframe) => keyframe.frame));
              if (maxFrame <= 0 && animation.frameSize > 0) {
                for (const keyframe of entry.keyframes) {
                  keyframe.frame += animation.frameSize;
                }
              }

              entry.keyframes.sort((left, right) => left.frame - right.frame);
            }

            tag.entries.push(entry);
            logger.info(`    ${paneName}: ${entry.typeName} (${numKeyframes} keyframes)`);
          }

          paneAnimation.tags.push(tag);
        }

        animation.panes.push(paneAnimation);
      }
    }

    reader.seek(sectionStart + sectionSize);
  }

  return animation;
}

export function interpolateKeyframes(keyframes, frame) {
  if (keyframes.length === 0) {
    return 0;
  }

  if (keyframes.length === 1) {
    return keyframes[0].value;
  }

  if (frame <= keyframes[0].frame) {
    return keyframes[0].value;
  }

  if (frame >= keyframes[keyframes.length - 1].frame) {
    return keyframes[keyframes.length - 1].value;
  }

  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const left = keyframes[i];
    const right = keyframes[i + 1];

    if (frame < left.frame || frame > right.frame) {
      continue;
    }

    const t = (frame - left.frame) / (right.frame - left.frame);
    const t2 = t * t;
    const t3 = t2 * t;

    return (
      (2 * t3 - 3 * t2 + 1) * left.value +
      (t3 - 2 * t2 + t) * left.blend +
      (-2 * t3 + 3 * t2) * right.value +
      (t3 - t2) * right.blend
    );
  }

  return keyframes[keyframes.length - 1].value;
}

function mergePaneAnimations(panes = []) {
  const byName = new Map();
  for (const pane of panes) {
    const existing = byName.get(pane.name);
    if (!existing) {
      byName.set(pane.name, {
        name: pane.name,
        tags: pane.tags.map((tag) => ({
          type: tag.type,
          entries: tag.entries.map((entry) => ({
            type: entry.type,
            dataType: entry.dataType,
            typeName: entry.typeName,
            keyframes: entry.keyframes.map((keyframe) => ({ ...keyframe })),
          })),
        })),
      });
      continue;
    }

    const tagMap = new Map(existing.tags.map((tag) => [tag.type, tag]));
    for (const tag of pane.tags) {
      let targetTag = tagMap.get(tag.type);
      if (!targetTag) {
        targetTag = { type: tag.type, entries: [] };
        existing.tags.push(targetTag);
        tagMap.set(tag.type, targetTag);
      }

      const entryMap = new Map(targetTag.entries.map((entry) => [entry.type, entry]));
      for (const entry of tag.entries) {
        const existingEntry = entryMap.get(entry.type);
        if (!existingEntry) {
          targetTag.entries.push({
            type: entry.type,
            dataType: entry.dataType,
            typeName: entry.typeName,
            keyframes: entry.keyframes.map((keyframe) => ({ ...keyframe })),
          });
          entryMap.set(entry.type, targetTag.entries[targetTag.entries.length - 1]);
          continue;
        }

        existingEntry.keyframes.push(...entry.keyframes.map((keyframe) => ({ ...keyframe })));
        existingEntry.keyframes.sort((left, right) => left.frame - right.frame);

        const deduped = [];
        for (const keyframe of existingEntry.keyframes) {
          const prev = deduped[deduped.length - 1];
          if (prev && Math.abs(prev.frame - keyframe.frame) < 1e-6) {
            deduped[deduped.length - 1] = keyframe;
          } else {
            deduped.push(keyframe);
          }
        }
        existingEntry.keyframes = deduped;
      }
    }
  }

  return [...byName.values()];
}

function clonePane(pane) {
  return {
    ...pane,
    translate: pane.translate ? { ...pane.translate } : { x: 0, y: 0, z: 0 },
    rotate: pane.rotate ? { ...pane.rotate } : { x: 0, y: 0, z: 0 },
    scale: pane.scale ? { ...pane.scale } : { x: 1, y: 1 },
    size: pane.size ? { ...pane.size } : { w: 0, h: 0 },
    texCoords: pane.texCoords ? pane.texCoords.map((coords) => ({ ...coords })) : undefined,
  };
}

function createRenderableLayout(layout, tplImages, fallbackWidth, fallbackHeight, loggerInput) {
  const logger = withLogger(loggerInput);

  const renderLayout = layout
    ? {
        ...layout,
        width: layout.width || fallbackWidth,
        height: layout.height || fallbackHeight,
        textures: [...layout.textures],
        materials: [...layout.materials],
        panes: layout.panes.map((pane) => clonePane(pane)),
      }
    : {
        textures: [],
        materials: [],
        panes: [],
        groups: [],
        width: fallbackWidth,
        height: fallbackHeight,
      };

  const hasPicturePanes = renderLayout.panes.some((pane) => pane.type === "pic1");
  if (!hasPicturePanes) {
    logger.warn("No pic1 panes found, creating synthetic layout from textures");

    const textureNames = Object.keys(tplImages);
    for (let i = 0; i < textureNames.length; i += 1) {
      const textureName = textureNames[i];
      const images = tplImages[textureName];
      if (!images || images.length === 0) {
        continue;
      }

      const firstImage = images[0];
      renderLayout.panes.push({
        type: "pic1",
        name: `Picture_${String(i).padStart(2, "0")}`,
        flags: 0x01,
        origin: 4,
        alpha: 255,
        visible: true,
        parent: null,
        translate: { x: 0, y: 0, z: 0 },
        rotate: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        size: { w: firstImage.width, h: firstImage.height },
        materialIndex: i,
      });

      if (!renderLayout.textures.includes(textureName)) {
        renderLayout.textures.push(textureName);
      }
    }
  }

  return renderLayout;
}

function scoreArchiveFiles(files) {
  const paths = Object.keys(files).map((path) => path.toLowerCase());
  let score = 0;

  if (paths.some((path) => path.includes("banner.bin"))) {
    score += 200;
  }
  if (paths.some((path) => path.includes("icon.bin"))) {
    score += 180;
  }
  if (paths.some((path) => path.endsWith(".brlyt"))) {
    score += 80;
  }
  if (paths.some((path) => path.endsWith(".brlan"))) {
    score += 60;
  }
  if (paths.some((path) => path.endsWith(".tpl"))) {
    score += 40;
  }

  const szsCount = paths.filter((path) => path.endsWith(".szs")).length;
  if (szsCount > 0) {
    score += Math.min(szsCount * 25, 300);
  }

  if (paths.some((path) => path.includes("channel/screenall"))) {
    score += 260;
  }

  if (paths.some((path) => path.includes("homebutton"))) {
    score -= 120;
  }

  return score;
}

function tryFindMetaArchive(contents) {
  const appNames = Object.keys(contents).sort((left, right) => {
    if (left === "00000000.app") {
      return -1;
    }
    if (right === "00000000.app") {
      return 1;
    }
    return left.localeCompare(right);
  });

  let best = null;

  for (const appName of appNames) {
    let files;
    try {
      files = parseU8(contents[appName], NOOP_LOGGER);
    } catch {
      continue;
    }

    const score = scoreArchiveFiles(files);
    if (score <= 0) {
      continue;
    }

    if (!best || score > best.score) {
      best = { appName, files, score };
    }
  }

  return best;
}

function containsBannerPayload(files) {
  return Object.keys(files).some((path) => {
    const lower = path.toLowerCase();
    return (
      lower.endsWith("banner.bin") ||
      lower.endsWith("/banner.bin") ||
      lower.endsWith("icon.bin") ||
      lower.endsWith("/icon.bin") ||
      lower.endsWith("sound.bin") ||
      lower.endsWith("/sound.bin")
    );
  });
}

function tryFindBannerArchiveByTmdIndex(contents, contentRecords, loggerInput) {
  const logger = withLogger(loggerInput);
  const bannerRecord = contentRecords.find((record) => record.index === 0);
  if (!bannerRecord) {
    return null;
  }

  const appName = bannerRecord.name;
  const appData = contents[appName];
  if (!appData) {
    return null;
  }

  try {
    const files = parseU8(appData, NOOP_LOGGER);
    if (!containsBannerPayload(files)) {
      return null;
    }

    logger.info(`Using TMD index 0 content (${appName}) as banner archive`);
    return { appName, files, score: Number.MAX_SAFE_INTEGER };
  } catch {
    return null;
  }
}

function parseResourceSet(files, loggerInput) {
  const logger = withLogger(loggerInput);
  const sourceFiles = { ...files };

  // Expand SZS/Yaz0 layout packs into a flat lookup for tpl/brlyt/brlan scanning.
  for (const [filePath, data] of Object.entries(files)) {
    const lowerPath = filePath.toLowerCase();
    if (!lowerPath.endsWith(".szs")) {
      continue;
    }

    try {
      const innerFiles = parseU8(data, NOOP_LOGGER);
      let added = 0;
      for (const [innerPath, innerData] of Object.entries(innerFiles)) {
        sourceFiles[`${filePath}::${innerPath}`] = innerData;
        added += 1;
      }
      if (added > 0) {
        logger.info(`Expanded ${filePath} (${added} file(s))`);
      }
    } catch (error) {
      logger.warn(`Failed to expand ${filePath}: ${error.message}`);
    }
  }

  const tplImages = {};
  let decodedTextureCount = 0;
  const maxDecodedTextures = 200;
  let layout = null;
  let animation = null;
  let animationStart = null;
  let animationLoop = null;

  for (const [filePath, data] of Object.entries(sourceFiles)) {
    if (!filePath.toLowerCase().endsWith(".tpl")) {
      continue;
    }

    if (decodedTextureCount >= maxDecodedTextures) {
      logger.warn(`Texture decode limit reached (${maxDecodedTextures}); skipping remaining textures`);
      break;
    }

    const baseName = filePath.split("/").pop() ?? filePath;
    let textureName = baseName;
    if (tplImages[textureName]) {
      textureName = filePath;
    }

    try {
      tplImages[textureName] = parseTPL(data, logger);
      logger.success(`Decoded ${textureName}`);
      decodedTextureCount += 1;
    } catch (error) {
      logger.error(`Failed to decode ${textureName}: ${error.message}`);
    }
  }

  const brlytEntries = Object.entries(sourceFiles)
    .filter(([filePath]) => filePath.toLowerCase().endsWith(".brlyt"))
    .sort((left, right) => right[1].byteLength - left[1].byteLength);
  if (brlytEntries.length > 0) {
    const selectedLayoutEntry =
      brlytEntries.find(([filePath]) => !filePath.toLowerCase().includes("common")) ?? brlytEntries[0];
    const [layoutPath, layoutData] = selectedLayoutEntry;

    logger.info(`=== Parsing ${layoutPath} ===`);
    try {
      layout = parseBRLYT(layoutData, logger);
    } catch (error) {
      logger.error(`BRLYT parse error: ${error.message}`);
    }
  }

  const brlanEntries = Object.entries(sourceFiles).filter(([filePath]) => filePath.toLowerCase().endsWith(".brlan"));
  if (brlanEntries.length > 0) {
    const sortBySize = (left, right) => right[1].byteLength - left[1].byteLength;
    const parseAnimEntry = (entry) => {
      if (!entry) {
        return null;
      }
      const [animPath, animData] = entry;
      logger.info(`=== Parsing ${animPath} ===`);
      try {
        return parseBRLAN(animData, logger);
      } catch (error) {
        logger.warn(`BRLAN parse warning: ${error.message}`);
        return null;
      }
    };

    const loopEntry = brlanEntries.filter(([filePath]) => filePath.toLowerCase().includes("loop")).sort(sortBySize)[0] ?? null;
    const startEntry = brlanEntries.filter(([filePath]) => filePath.toLowerCase().includes("start")).sort(sortBySize)[0] ?? null;

    animationLoop = parseAnimEntry(loopEntry);
    animationStart = parseAnimEntry(startEntry);

    if (!animationLoop && !animationStart) {
      const selectedAnimEntry = brlanEntries.sort(sortBySize)[0];
      animation = parseAnimEntry(selectedAnimEntry);
    } else {
      animation = animationLoop ?? animationStart;
    }
  }

  return { tplImages, layout, anim: animation, animStart: animationStart, animLoop: animationLoop };
}

function hasDirectRenderableFiles(files) {
  return Object.keys(files).some((path) => {
    const lower = path.toLowerCase();
    return (
      lower.endsWith(".tpl") ||
      lower.endsWith(".brlyt") ||
      lower.endsWith(".brlan") ||
      lower.endsWith(".szs")
    );
  });
}

function extractTargetResources(metaFiles, target, loggerInput) {
  const logger = withLogger(loggerInput);
  const entries = Object.entries(metaFiles);
  const binEntry = entries.find(([path]) => path.toLowerCase().includes(`${target}.bin`));

  let sourceFiles = null;
  if (binEntry) {
    const [binPath, binData] = binEntry;
    logger.info(`=== Parsing ${binPath} ===`);
    try {
      sourceFiles = parseU8(binData, logger);
    } catch (error) {
      logger.warn(`Failed to parse ${binPath}: ${error.message}`);
      return null;
    }
  } else if (hasDirectRenderableFiles(metaFiles)) {
    logger.warn(`${target}.bin not found, using direct resources from selected content`);
    const entries = Object.entries(metaFiles);
    const screenAllEntries = entries.filter(([path]) => path.toLowerCase().includes("/screenall/"));

    if (screenAllEntries.length > 0) {
      const preferredSuffixes = [
        "/screenall/cmn/layout00.szs",
        "/screenall/usa/layout00.szs",
        "/screenall/eng/layout00.szs",
        "/screenall/jpn/layout00.szs",
      ];

      let selected = null;
      for (const suffix of preferredSuffixes) {
        selected = screenAllEntries.find(([path]) => path.toLowerCase().endsWith(suffix));
        if (selected) {
          break;
        }
      }

      if (!selected) {
        [selected] = screenAllEntries;
      }

      sourceFiles = { [selected[0]]: selected[1] };
      logger.info(`Selected ${selected[0]} as primary screen layout archive`);
    } else {
      sourceFiles = Object.fromEntries(
        entries.filter(([path]) => {
          const lower = path.toLowerCase();
          return !lower.includes("sofkeybd") && !lower.includes("homebutton");
        }),
      );
    }
  } else {
    logger.warn(`${target}.bin not found`);
    return null;
  }

  return parseResourceSet(sourceFiles, logger);
}

async function decryptWadContents(wad, loggerInput) {
  const logger = withLogger(loggerInput);

  if (!hasSubtleCrypto()) {
    logger.warn("WebCrypto API not available; cannot decrypt encrypted WAD contents in this environment");
    return null;
  }

  const commonKeyIndex = wad.ticket.commonKeyIndex;
  const commonKeyHex = WII_COMMON_KEYS[commonKeyIndex];
  if (!commonKeyHex) {
    logger.warn(`Unsupported common key index ${commonKeyIndex}`);
    return null;
  }

  const commonKeyBytes = hexToBytes(commonKeyHex);
  const commonKey = await importAesCbcKey(commonKeyBytes);

  const titleIv = new Uint8Array(16);
  titleIv.set(wad.ticket.titleIdBytes, 0);

  const decryptedTitleKey = await decryptAesCbcNoPadding(commonKey, wad.ticket.encryptedTitleKey, titleIv);
  const titleKeyBytes = decryptedTitleKey.slice(0, 16);
  const titleKey = await importAesCbcKey(titleKeyBytes);

  logger.info(`Decrypted title key using common key index ${commonKeyIndex}`);

  const decryptedContents = {};
  for (const record of wad.contentRecords) {
    const iv = new Uint8Array(16);
    iv[0] = (record.index >> 8) & 0xff;
    iv[1] = record.index & 0xff;

    const encryptedBytes = new Uint8Array(wad.sourceBuffer, record.offset, record.encryptedSize);
    const decryptedBytes = await decryptAesCbcNoPadding(titleKey, encryptedBytes, iv);
    decryptedContents[record.name] = decryptedBytes.slice(0, record.size).buffer;
  }

  return decryptedContents;
}

export async function processWAD(buffer, loggerInput) {
  const logger = withLogger(loggerInput);

  logger.info("=== Parsing WAD ===");
  const wad = parseWAD(buffer, logger);
  let contents = wad.contents;
  const selectMetaArchive = (candidateContents) =>
    tryFindBannerArchiveByTmdIndex(candidateContents, wad.contentRecords, logger) ??
    tryFindMetaArchive(candidateContents);

  let metaArchive = selectMetaArchive(contents);

  if (!metaArchive) {
    logger.info("No banner archive found in raw contents, attempting AES decryption");
    try {
      const decryptedContents = await decryptWadContents(wad, logger);
      if (decryptedContents) {
        contents = decryptedContents;
        metaArchive = selectMetaArchive(contents);
      }
    } catch (error) {
      logger.warn(`Content decryption failed: ${error.message}`);
    }
  }

  if (!metaArchive) {
    logger.warn("Could not find a renderable banner/icon archive in this WAD");
    logger.success("=== Done! ===");
    return { wad, results: {} };
  }

  logger.info(`=== Parsing content ${metaArchive.appName} ===`);
  const metaFiles = metaArchive.files;

  const results = {};

  for (const target of ["banner", "icon"]) {
    const parsedTarget = extractTargetResources(metaFiles, target, logger);
    if (!parsedTarget) {
      continue;
    }

    const fallbackSize = target === "banner" ? { width: 608, height: 456 } : { width: 128, height: 128 };

    results[target] = {
      tplImages: parsedTarget.tplImages,
      layout: parsedTarget.layout,
      anim: parsedTarget.anim,
      animStart: parsedTarget.animStart ?? null,
      animLoop: parsedTarget.animLoop ?? null,
      renderLayout: createRenderableLayout(
        parsedTarget.layout,
        parsedTarget.tplImages,
        fallbackSize.width,
        fallbackSize.height,
        logger,
      ),
    };
  }

  logger.success("=== Done! ===");

  return { wad, results };
}

export function flattenTextures(tplImages) {
  const entries = [];

  for (const [name, images] of Object.entries(tplImages)) {
    for (let i = 0; i < images.length; i += 1) {
      entries.push({
        key: `${name}-${i}`,
        name,
        image: images[i],
      });
    }
  }

  return entries;
}

const TITLE_LOCALE_CODES = ["JP", "NE", "GE", "SP", "IT", "FR", "US"];

function detectPreferredTitleLocale() {
  const locale =
    globalThis.navigator?.language ??
    globalThis.Intl?.DateTimeFormat?.().resolvedOptions?.().locale ??
    "en-US";
  const lower = String(locale).toLowerCase();

  if (lower.startsWith("ja")) {
    return "JP";
  }
  if (lower.startsWith("nl")) {
    return "NE";
  }
  if (lower.startsWith("de")) {
    return "GE";
  }
  if (lower.startsWith("es")) {
    return "SP";
  }
  if (lower.startsWith("it")) {
    return "IT";
  }
  if (lower.startsWith("fr")) {
    return "FR";
  }
  return "US";
}

function extractTitleLocaleCode(name) {
  if (!name) {
    return null;
  }

  let match = name.match(/^N_title(JP|NE|GE|SP|IT|FR|US)_/);
  if (match) {
    return match[1];
  }

  match = name.match(/^title_(JP|NE|GE|SP|IT|FR|US)_/);
  if (match) {
    return match[1];
  }

  match = name.match(/^(JP|NE|GE|SP|IT|FR|US)_/);
  if (match) {
    return match[1];
  }

  return null;
}

function isLikelyAlphaOnlyTitleMask(textureName) {
  if (!textureName) {
    return false;
  }

  return /nigaoetitlejpa/i.test(textureName) || /title_.*a_/i.test(textureName);
}

export class BannerRenderer {
  constructor(canvas, layout, anim, tplImages, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.layout = layout;
    this.anim = anim;
    this.tplImages = tplImages;
    this.startAnim = options.startAnim ?? null;
    this.loopAnim = options.loopAnim ?? anim ?? null;
    if (!this.startAnim && !this.loopAnim) {
      this.loopAnim = anim ?? null;
    }
    this.sequenceEnabled = Boolean(this.startAnim && this.loopAnim);
    this.phase = this.sequenceEnabled ? "start" : "loop";
    this.loopPlaybackStartFrame = 0;
    this.loopPlaybackEndFrame = this.getFrameCountForAnim(this.loopAnim);
    if (this.sequenceEnabled) {
      const startFrameCount = this.getFrameCountForAnim(this.startAnim);
      const loopFrameCount = this.getFrameCountForAnim(this.loopAnim);
      // Common Nintendo channel pattern: Start is the tail segment of Loop.
      // In that case, loop playback should exclude the intro tail to avoid replaying it.
      if (startFrameCount > 0 && startFrameCount < loopFrameCount) {
        this.loopPlaybackEndFrame = loopFrameCount - startFrameCount;
      }
    }
    if (this.loopPlaybackEndFrame <= this.loopPlaybackStartFrame) {
      this.loopPlaybackEndFrame = this.getFrameCountForAnim(this.loopAnim);
    }

    const requestedInitialFrame = Number.isFinite(options.initialFrame) ? Math.floor(options.initialFrame) : 0;
    this.startFrame = requestedInitialFrame;
    this.frame = requestedInitialFrame;
    this.playing = false;
    this.animationId = null;
    this.lastTime = 0;
    this.fps = options.fps ?? 60;
    this.useGsap = options.useGsap ?? true;
    this.onFrame = options.onFrame ?? (() => {});
    this.gsapTimeline = null;
    this.gsapDriver = { frame: 0 };
    this.patternTextureCache = new Map();
    this.textureMaskCache = new Map();

    this.textureCanvases = {};
    this.textureFormats = {};
    this.panesByName = new Map();
    this.paneTransformChains = new Map();
    this.animMapByAnim = new WeakMap();
    this.animByPaneName = new Map();
    this.titleLocalePreference = options.titleLocale ?? detectPreferredTitleLocale();
    this.availableTitleLocales = new Set();
    this.activeTitleLocale = null;

    for (const pane of this.layout?.panes ?? []) {
      if (!this.panesByName.has(pane.name)) {
        this.panesByName.set(pane.name, pane);
      }
    }

    this.availableTitleLocales = this.collectTitleLocales();
    this.activeTitleLocale = this.resolveActiveTitleLocale(this.titleLocalePreference);

    const initialAnim = this.sequenceEnabled ? this.startAnim : (this.loopAnim ?? this.startAnim ?? this.anim);
    this.setActiveAnim(initialAnim, this.phase);

    this.startFrame = this.normalizeFrame(this.startFrame);
    this.frame = this.startFrame;
    this.prepareTextures();
  }

  collectTitleLocales() {
    const locales = new Set();
    for (const pane of this.layout?.panes ?? []) {
      const locale = extractTitleLocaleCode(pane.name);
      if (locale && TITLE_LOCALE_CODES.includes(locale)) {
        locales.add(locale);
      }
    }
    return locales;
  }

  resolveActiveTitleLocale(preferredLocale) {
    if (this.availableTitleLocales.size === 0) {
      return null;
    }

    if (preferredLocale && this.availableTitleLocales.has(preferredLocale)) {
      return preferredLocale;
    }

    if (this.availableTitleLocales.has("US")) {
      return "US";
    }

    return this.availableTitleLocales.values().next().value ?? null;
  }

  getPaneTitleLocale(pane) {
    const directLocale = extractTitleLocaleCode(pane?.name);
    if (directLocale) {
      return directLocale;
    }

    const chain = this.getPaneTransformChain(pane);
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const locale = extractTitleLocaleCode(chain[i].name);
      if (locale) {
        return locale;
      }
    }

    return null;
  }

  shouldRenderPaneForLocale(pane) {
    if (!this.activeTitleLocale || this.availableTitleLocales.size <= 1) {
      return true;
    }

    const paneLocale = this.getPaneTitleLocale(pane);
    if (!paneLocale) {
      return true;
    }

    return paneLocale === this.activeTitleLocale;
  }

  buildAnimPaneMap(anim) {
    const paneMap = new Map();
    const mergedPaneAnimations = mergePaneAnimations(anim?.panes ?? []);
    for (const paneAnim of mergedPaneAnimations) {
      if (!paneMap.has(paneAnim.name)) {
        paneMap.set(paneAnim.name, paneAnim);
      }
    }
    return paneMap;
  }

  getAnimPaneMap(anim) {
    if (!anim) {
      return new Map();
    }
    const cached = this.animMapByAnim.get(anim);
    if (cached) {
      return cached;
    }
    const paneMap = this.buildAnimPaneMap(anim);
    this.animMapByAnim.set(anim, paneMap);
    return paneMap;
  }

  setActiveAnim(anim, phase = this.phase) {
    this.anim = anim ?? this.loopAnim ?? this.startAnim ?? null;
    this.phase = phase;
    this.animByPaneName = this.getAnimPaneMap(this.anim);
  }

  getFrameCountForAnim(anim) {
    return Math.max(1, anim?.frameSize || 120);
  }

  getTotalFrames() {
    return this.getFrameCountForAnim(this.anim);
  }

  getLoopPlaybackLength() {
    return Math.max(1, this.loopPlaybackEndFrame - this.loopPlaybackStartFrame);
  }

  normalizeFrameInRange(rawFrame, startFrame, endFrame) {
    const span = Math.max(1, endFrame - startFrame);
    const numeric = Number.isFinite(rawFrame) ? Math.floor(rawFrame) : startFrame;
    return startFrame + ((((numeric - startFrame) % span) + span) % span);
  }

  normalizeFrame(rawFrame) {
    const total = this.getTotalFrames();
    const numeric = Number.isFinite(rawFrame) ? Math.floor(rawFrame) : 0;
    return ((numeric % total) + total) % total;
  }

  applyFrame(rawFrame) {
    if (this.sequenceEnabled && this.phase === "loop") {
      const nextFrame = this.normalizeFrameInRange(rawFrame, this.loopPlaybackStartFrame, this.loopPlaybackEndFrame);
      const loopLength = this.getLoopPlaybackLength();
      this.frame = nextFrame;
      this.renderFrame(this.frame);
      this.onFrame(this.frame - this.loopPlaybackStartFrame, loopLength, this.phase);
      return;
    }

    const total = this.getTotalFrames();
    const nextFrame = this.normalizeFrame(rawFrame);
    this.frame = nextFrame;
    this.renderFrame(this.frame);
    this.onFrame(this.frame, total, this.phase);
  }

  setStartFrame(rawFrame) {
    if (this.sequenceEnabled && this.startAnim) {
      this.setActiveAnim(this.startAnim, "start");
    }
    const normalized = this.normalizeFrame(rawFrame);
    this.startFrame = normalized;
    this.stop();
    if (this.gsapTimeline) {
      this.gsapTimeline.kill();
      this.gsapTimeline = null;
    }
    this.gsapDriver.frame = normalized;
    this.applyFrame(normalized);
  }

  ensureGsapTimeline() {
    if (this.sequenceEnabled || !this.useGsap || this.gsapTimeline) {
      return;
    }

    const total = this.getTotalFrames();
    this.gsapDriver.frame = this.frame;

    this.gsapTimeline = gsap.timeline({
      paused: true,
      repeat: -1,
      defaults: { ease: "none" },
      onUpdate: () => {
        this.applyFrame(this.gsapDriver.frame);
      },
    });

    this.gsapTimeline.to(this.gsapDriver, {
      frame: total,
      duration: total / this.fps,
      ease: "none",
    });
  }

  advanceFrame() {
    if (this.sequenceEnabled && this.phase === "start") {
      const startFrames = this.getFrameCountForAnim(this.startAnim);
      const nextStartFrame = this.frame + 1;
      if (nextStartFrame >= startFrames) {
        this.setActiveAnim(this.loopAnim ?? this.startAnim, "loop");
        this.applyFrame(this.loopPlaybackStartFrame);
        return;
      }
      this.applyFrame(nextStartFrame);
      return;
    }

    this.applyFrame(this.frame + 1);
  }

  prepareTextures() {
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

  getTextureFormat(textureName) {
    return this.textureFormats[textureName] ?? null;
  }

  getMaskedTexture(baseTextureName, maskTextureName) {
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

  getTextureBindingForPane(pane) {
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
          return { texture: this.textureCanvases[textureName], textureName, wrapS: 0, wrapT: 0, textureSRT: null };
        }
      }
    }

    if (pane.materialIndex >= 0 && pane.materialIndex < this.layout.textures.length) {
      const textureName = this.layout.textures[pane.materialIndex];
      if (this.textureCanvases[textureName]) {
        return { texture: this.textureCanvases[textureName], textureName, wrapS: 0, wrapT: 0, textureSRT: null };
      }
    }

    for (const textureName of this.layout.textures) {
      if (this.textureCanvases[textureName]) {
        return { texture: this.textureCanvases[textureName], textureName, wrapS: 0, wrapT: 0, textureSRT: null };
      }
    }

    const textureKeys = Object.keys(this.textureCanvases);
    if (textureKeys.length === 0) {
      return null;
    }

    const textureName = textureKeys[0];
    return { texture: this.textureCanvases[textureName], textureName, wrapS: 0, wrapT: 0, textureSRT: null };
  }

  getTextureForPane(pane) {
    return this.getTextureBindingForPane(pane)?.texture ?? null;
  }

  transformTexCoord(point, textureSRT) {
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

  getTransformedTexCoords(pane, textureSRT = null) {
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

  getTransformedTexCoordValues(pane, textureSRT = null) {
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

  getTexCoordSpans(pane, textureSRT = null) {
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

  getSourceRectForPane(pane, texture, options = {}) {
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

  getAnimValues(paneName, frame) {
    const result = {
      transX: null,
      transY: null,
      rotZ: null,
      scaleX: null,
      scaleY: null,
      alpha: null,
      width: null,
      height: null,
    };

    if (!this.anim) {
      return result;
    }

    const paneAnimation = this.animByPaneName.get(paneName);
    if (!paneAnimation) {
      return result;
    }

    for (const tag of paneAnimation.tags) {
      for (const entry of tag.entries) {
        const keyframes = entry.keyframes ?? [];
        let sampleFrame = frame;
        if (this.anim.frameSize > 0 && keyframes.length > 0 && keyframes[0].frame >= 0 && frame < keyframes[0].frame) {
          sampleFrame += this.anim.frameSize;
        }

        const value = interpolateKeyframes(keyframes, sampleFrame);
        switch (entry.type) {
          case 0x00:
            result.transX = value;
            break;
          case 0x01:
            result.transY = value;
            break;
          case 0x05:
            result.rotZ = value;
            break;
          case 0x06:
            result.scaleX = value;
            break;
          case 0x07:
            result.scaleY = value;
            break;
          case 0x08:
            result.width = value;
            break;
          case 0x09:
            result.height = value;
            break;
          case 0x0a:
          case 0x10:
            result.alpha = value;
            break;
          default:
            break;
        }
      }
    }

    return result;
  }

  getPaneTransformChain(pane) {
    const cached = this.paneTransformChains.get(pane);
    if (cached) {
      return cached;
    }

    const chain = [];
    const seen = new Set();
    let current = pane;

    while (current && !seen.has(current.name)) {
      chain.push(current);
      seen.add(current.name);

      if (!current.parent) {
        break;
      }
      current = this.panesByName.get(current.parent) ?? null;
    }

    chain.reverse();
    this.paneTransformChains.set(pane, chain);
    return chain;
  }

  getLocalPaneState(pane, frame) {
    const animValues = this.getAnimValues(pane.name, frame);
    const tx = animValues.transX ?? pane.translate?.x ?? 0;
    const ty = animValues.transY ?? pane.translate?.y ?? 0;
    const sx = animValues.scaleX ?? pane.scale?.x ?? 1;
    const sy = animValues.scaleY ?? pane.scale?.y ?? 1;
    const rotation = animValues.rotZ ?? pane.rotate?.z ?? 0;
    const width = animValues.width ?? pane.size?.w ?? 0;
    const height = animValues.height ?? pane.size?.h ?? 0;

    const defaultAlpha = pane.visible === false ? 0 : (pane.alpha ?? 255) / 255;
    const alpha = animValues.alpha != null ? animValues.alpha / 255 : defaultAlpha;

    return {
      tx,
      ty,
      sx,
      sy,
      rotation,
      width,
      height,
      alpha: Math.max(0, Math.min(1, alpha)),
    };
  }

  getWrappedSurface(
    texture,
    textureName,
    sourceRect,
    repeatX,
    repeatY,
    tileWidth,
    tileHeight,
    targetWidth,
    targetHeight,
  ) {
    const src = sourceRect ?? { x: 0, y: 0, width: texture.width, height: texture.height };
    const safeTileWidth = Math.max(1, Math.round(tileWidth));
    const safeTileHeight = Math.max(1, Math.round(tileHeight));
    const safeTargetWidth = Math.max(1, Math.round(targetWidth));
    const safeTargetHeight = Math.max(1, Math.round(targetHeight));
    const key = [
      textureName,
      src.x,
      src.y,
      src.width,
      src.height,
      repeatX ? 1 : 0,
      repeatY ? 1 : 0,
      safeTileWidth,
      safeTileHeight,
      safeTargetWidth,
      safeTargetHeight,
    ].join(":");

    const cached = this.patternTextureCache.get(key);
    if (cached) {
      return cached;
    }

    const surface = document.createElement("canvas");

    if (repeatX && repeatY) {
      surface.width = safeTileWidth;
      surface.height = safeTileHeight;
      surface
        .getContext("2d")
        .drawImage(texture, src.x, src.y, src.width, src.height, 0, 0, surface.width, surface.height);
    } else if (repeatX) {
      surface.width = safeTileWidth;
      surface.height = safeTargetHeight;
      surface
        .getContext("2d")
        .drawImage(texture, src.x, src.y, src.width, src.height, 0, 0, surface.width, surface.height);
    } else {
      surface.width = safeTargetWidth;
      surface.height = safeTileHeight;
      surface
        .getContext("2d")
        .drawImage(texture, src.x, src.y, src.width, src.height, 0, 0, surface.width, surface.height);
    }

    this.patternTextureCache.set(key, surface);
    return surface;
  }

  drawPaneTextureWithVerticalClamp(context, binding, pane, width, height) {
    const texture = binding.texture;
    const textureSRT = binding.textureSRT ?? null;
    const transformed = this.getTransformedTexCoords(pane, textureSRT);
    if (!transformed) {
      return false;
    }

    const eps = 1e-6;
    const topDeltaT = Math.abs(transformed.tl.t - transformed.tr.t);
    const bottomDeltaT = Math.abs(transformed.bl.t - transformed.br.t);
    if (topDeltaT > eps || bottomDeltaT > eps) {
      return false;
    }

    const tTop = (transformed.tl.t + transformed.tr.t) * 0.5;
    const tBottom = (transformed.bl.t + transformed.br.t) * 0.5;
    if (!Number.isFinite(tTop) || !Number.isFinite(tBottom) || Math.abs(tBottom - tTop) <= eps) {
      return false;
    }

    const repeatX = binding.wrapS === 1 || binding.wrapS === 2;
    const repeatY = binding.wrapT === 1 || binding.wrapT === 2;
    if (!repeatX || repeatY) {
      return false;
    }

    // Only use segmented clamp mapping when vertical coordinates are actually outside [0, 1].
    if (Math.min(tTop, tBottom) >= 0 && Math.max(tTop, tBottom) <= 1) {
      return false;
    }

    const baseSourceRect =
      this.getSourceRectForPane(pane, texture, {
        forceNormalized: true,
        repeatX: true,
        repeatY: true,
        textureSRT,
      }) ?? { x: 0, y: 0, width: texture.width, height: texture.height };

    const spans = this.getTexCoordSpans(pane, textureSRT);
    const sSpan = spans?.spanS ?? 1;
    const tileWidth = Math.abs(width) / Math.max(1e-6, sSpan);
    const paneTop = -height / 2;
    const textureHeight = texture.height;

    const clamp01 = (value) => Math.max(0, Math.min(1, value));
    const tAtV = (v) => tTop + (tBottom - tTop) * v;

    const drawSegment = (vStart, vEnd, sourceY, sourceHeight) => {
      const segVStart = Math.max(0, Math.min(1, vStart));
      const segVEnd = Math.max(0, Math.min(1, vEnd));
      if (segVEnd - segVStart <= 1e-6) {
        return;
      }

      const destY = paneTop + segVStart * height;
      const destHeight = (segVEnd - segVStart) * height;
      if (destHeight <= 0.25) {
        return;
      }

      const safeSourceHeight = Math.max(1, sourceHeight);
      const segmentSourceRect = {
        x: baseSourceRect.x,
        y: Math.max(0, Math.min(textureHeight - 1, sourceY)),
        width: baseSourceRect.width,
        height: Math.min(textureHeight, safeSourceHeight),
      };

      const surface = this.getWrappedSurface(
        texture,
        binding.textureName,
        segmentSourceRect,
        true,
        false,
        tileWidth,
        destHeight,
        width,
        destHeight,
      );

      const pattern = context.createPattern(surface, "repeat-x");
      if (!pattern) {
        return;
      }
      context.save();
      context.translate(-width / 2, destY);
      context.fillStyle = pattern;
      context.fillRect(0, 0, width, destHeight);
      context.restore();
    };

    const drawEdgeSegment = (vStart, vEnd, edge) => {
      const sourceY = edge <= 0 ? 0 : textureHeight - 1;
      drawSegment(vStart, vEnd, sourceY, 1);
    };

    const drawMappedSegment = (vStart, vEnd) => {
      if (vEnd - vStart <= 1e-6) {
        return;
      }
      const tStart = clamp01(tAtV(vStart));
      const tEnd = clamp01(tAtV(vEnd));
      const yStart = tStart * textureHeight;
      const yEnd = tEnd * textureHeight;
      const sourceTop = Math.max(0, Math.min(textureHeight - 1, Math.floor(Math.min(yStart, yEnd))));
      const sourceBottom = Math.max(sourceTop + 1, Math.min(textureHeight, Math.ceil(Math.max(yStart, yEnd))));
      drawSegment(vStart, vEnd, sourceTop, sourceBottom - sourceTop);
    };

    const deltaT = tBottom - tTop;
    const vAt0 = clamp01((0 - tTop) / deltaT);
    const vAt1 = clamp01((1 - tTop) / deltaT);

    if (deltaT > 0) {
      let mappedStart = 0;
      if (tTop < 0) {
        drawEdgeSegment(0, vAt0, 0);
        mappedStart = vAt0;
      }

      let mappedEnd = 1;
      if (tBottom > 1) {
        mappedEnd = vAt1;
      }

      drawMappedSegment(mappedStart, mappedEnd);

      if (mappedEnd < 1) {
        drawEdgeSegment(mappedEnd, 1, 1);
      }
      return true;
    }

    let mappedStart = 0;
    if (tTop > 1) {
      drawEdgeSegment(0, vAt1, 1);
      mappedStart = vAt1;
    }

    let mappedEnd = 1;
    if (tBottom < 0) {
      mappedEnd = vAt0;
    }

    drawMappedSegment(mappedStart, mappedEnd);

    if (mappedEnd < 1) {
      drawEdgeSegment(mappedEnd, 1, 0);
    }

    return true;
  }

  drawPaneTexture(context, binding, pane, width, height) {
    const texture = binding.texture;
    const repeatX = binding.wrapS === 1 || binding.wrapS === 2;
    const repeatY = binding.wrapT === 1 || binding.wrapT === 2;
    const textureSRT = binding.textureSRT ?? null;

    if (this.drawPaneTextureWithVerticalClamp(context, binding, pane, width, height)) {
      return;
    }

    const sourceRect = this.getSourceRectForPane(pane, texture, {
      forceNormalized: repeatX || repeatY,
      repeatX,
      repeatY,
      textureSRT,
    });
    if (repeatX || repeatY) {
      const spans = this.getTexCoordSpans(pane, textureSRT);
      const sSpan = repeatX ? spans?.spanS ?? 1 : 1;
      const tSpan = repeatY ? spans?.spanT ?? 1 : 1;
      const tileWidth = repeatX ? Math.abs(width) / sSpan : Math.abs(width);
      const tileHeight = repeatY ? Math.abs(height) / tSpan : Math.abs(height);
      const surface = this.getWrappedSurface(
        texture,
        binding.textureName,
        sourceRect,
        repeatX,
        repeatY,
        tileWidth,
        tileHeight,
        width,
        height,
      );
      const repeatMode = repeatX && repeatY ? "repeat" : repeatX ? "repeat-x" : "repeat-y";
      const pattern = context.createPattern(surface, repeatMode);
      if (pattern) {
        context.save();
        context.translate(-width / 2, -height / 2);
        context.fillStyle = pattern;
        context.fillRect(0, 0, width, height);
        context.restore();
        return;
      }
    }

    if (sourceRect) {
      context.drawImage(
        texture,
        sourceRect.x,
        sourceRect.y,
        sourceRect.width,
        sourceRect.height,
        -width / 2,
        -height / 2,
        width,
        height,
      );
      return;
    }

    context.drawImage(texture, -width / 2, -height / 2, width, height);
  }

  renderFrame(frame) {
    const context = this.ctx;
    const layoutWidth = this.layout.width || this.canvas.clientWidth || this.canvas.width;
    const layoutHeight = this.layout.height || this.canvas.clientHeight || this.canvas.height;
    const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(layoutWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(layoutHeight * dpr));

    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    if (this.canvas.style) {
      this.canvas.style.width = `${layoutWidth}px`;
      this.canvas.style.height = `${layoutHeight}px`;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    context.clearRect(0, 0, layoutWidth, layoutHeight);

    const localPaneStates = new Map();
    for (const pane of this.layout.panes) {
      localPaneStates.set(pane, this.getLocalPaneState(pane, frame));
    }

    const picturePanes = this.layout.panes.filter((pane) => pane.type === "pic1");

    for (const pane of picturePanes) {
      if (!this.shouldRenderPaneForLocale(pane)) {
        continue;
      }

      const binding = this.getTextureBindingForPane(pane);
      if (!binding) {
        continue;
      }

      const paneState = localPaneStates.get(pane);
      if (!paneState) {
        continue;
      }

      let alpha = 1;
      const transformChain = this.getPaneTransformChain(pane);

      context.save();
      context.translate(layoutWidth / 2, layoutHeight / 2);

      for (const chainPane of transformChain) {
        const chainState = localPaneStates.get(chainPane);
        if (!chainState) {
          continue;
        }

        alpha *= chainState.alpha;
        if (alpha <= 0) {
          break;
        }

        context.translate(chainState.tx, -chainState.ty);
        if (chainState.rotation !== 0) {
          context.rotate((chainState.rotation * Math.PI) / 180);
        }
        context.scale(chainState.sx, chainState.sy);
      }

      if (alpha <= 0) {
        context.restore();
        continue;
      }

      context.globalAlpha = Math.max(0, Math.min(1, alpha));
      this.drawPaneTexture(context, binding, pane, paneState.width, paneState.height);
      context.restore();
    }
  }

  render() {
    this.applyFrame(this.frame);
  }

  play() {
    if (this.playing) {
      return;
    }

    this.playing = true;

    if (this.useGsap && !this.sequenceEnabled) {
      this.ensureGsapTimeline();
      if (this.gsapTimeline) {
        this.gsapTimeline.play();
        return;
      }
    }

    this.lastTime = performance.now();

    const tick = (now) => {
      if (!this.playing) {
        return;
      }

      const delta = now - this.lastTime;
      if (delta >= 1000 / this.fps) {
        this.lastTime = now;
        this.advanceFrame();
      }

      this.animationId = requestAnimationFrame(tick);
    };

    this.animationId = requestAnimationFrame(tick);
  }

  stop() {
    this.playing = false;
    if (this.gsapTimeline) {
      this.gsapTimeline.pause();
    }
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  reset() {
    if (this.sequenceEnabled && this.startAnim) {
      this.setActiveAnim(this.startAnim, "start");
    }
    this.frame = this.normalizeFrame(this.startFrame);
    this.gsapDriver.frame = this.frame;
    if (this.gsapTimeline) {
      this.gsapTimeline.pause(0);
    }
    this.applyFrame(this.frame);
  }

  dispose() {
    this.stop();
    if (this.gsapTimeline) {
      this.gsapTimeline.kill();
      this.gsapTimeline = null;
    }
    this.patternTextureCache.clear();
    this.textureMaskCache.clear();
  }
}
