import { withLogger } from "./logger.js";

// Decompress raw Nintendo LZ (no "LZ77" tag). Used for .LZ files.
// Header: type(u8) + decompressed_size(u24 LE).
export function decodeLzRaw(data) {
  if (data.byteLength < 4) {
    throw new Error("LZ raw payload too small");
  }

  const type = data[0];
  if (type !== 0x10 && type !== 0x11) {
    throw new Error(`Unsupported LZ type 0x${type.toString(16)}`);
  }

  const outSize = data[1] | (data[2] << 8) | (data[3] << 16);
  if (outSize <= 0) {
    throw new Error("Invalid LZ output size");
  }

  return decodeLzCore(data, 4, outSize, type);
}

export function decodeLz77(data, sizeMode = "be") {
  if (data.byteLength < 8) {
    throw new Error("LZ77 payload too small");
  }

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

  if (type !== 0x10 && type !== 0x11) {
    throw new Error(`Unsupported LZ77 type 0x${type.toString(16)}`);
  }

  return decodeLzCore(data, 8, outSize, type);
}

function decodeLzCore(data, startOffset, outSize, type) {
  const out = new Uint8Array(outSize);
  let src = startOffset;
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

export function decodeYaz0(data) {
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

function readAsciiTag(buffer) {
  if (!buffer || buffer.byteLength < 4) {
    return "";
  }

  const bytes = new Uint8Array(buffer, 0, 4);
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
}

function matchesExpectedMagic(buffer, expectedMagic) {
  if (!expectedMagic) {
    return true;
  }

  const allowed = Array.isArray(expectedMagic) ? expectedMagic : [expectedMagic];
  const tag = readAsciiTag(buffer);
  return allowed.includes(tag);
}

// Strip common Wii/Nintendo wrappers so parsers can operate on the real payload.
export function unwrapBinaryAsset(buffer, options = {}, loggerInput) {
  const logger = withLogger(loggerInput);
  const { expectedMagic = null, maxDepth = 8 } = options;
  let sourceBuffer = buffer;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const tag = readAsciiTag(sourceBuffer);
    if (!tag) {
      return sourceBuffer;
    }

    if (tag === "IMD5") {
      logger.info("Found IMD5 header, skipping 32 bytes");
      sourceBuffer = sourceBuffer.slice(32);
      continue;
    }

    if (tag === "Yaz0") {
      logger.info("Found Yaz0 stream, decompressing");
      sourceBuffer = decodeYaz0(new Uint8Array(sourceBuffer));
      continue;
    }

    if (tag === "LZ77") {
      logger.info("Found LZ77 stream, decompressing");

      const attempts = [
        { mode: "be", label: "big-endian" },
        { mode: "le", label: "little-endian" },
      ];

      const candidates = [];
      let lastError = null;
      for (const attempt of attempts) {
        try {
          const decompressed = decodeLz77(new Uint8Array(sourceBuffer), attempt.mode);
          candidates.push({ ...attempt, decompressed });
        } catch (error) {
          lastError = error;
        }
      }

      const matchingCandidates = candidates.filter(({ decompressed }) =>
        matchesExpectedMagic(decompressed, expectedMagic),
      );

      const selected =
        matchingCandidates[0] ??
        (matchingCandidates.length === 0 && !expectedMagic ? candidates[0] : null);

      if (!selected) {
        throw new Error(
          expectedMagic
            ? `Failed to decompress LZ77 stream to expected magic ${JSON.stringify(expectedMagic)}`
            : `Failed to decompress LZ77 stream: ${lastError?.message ?? "unknown error"}`,
        );
      }

      logger.info(`LZ77 decompressed using ${selected.label} size mode`);
      sourceBuffer = selected.decompressed;
      continue;
    }

    return sourceBuffer;
  }

  throw new Error("Exceeded wrapper recursion limit while unwrapping binary asset");
}
