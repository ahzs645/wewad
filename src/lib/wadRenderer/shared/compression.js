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
