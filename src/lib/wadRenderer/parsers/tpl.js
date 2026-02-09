import { BinaryReader, withLogger } from "../shared/index";
import { TPL_FORMATS } from "./constants";

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
      const red = Math.trunc((((value >> 10) & 0x1f) * 255) / 31);
      const green = Math.trunc((((value >> 5) & 0x1f) * 255) / 31);
      const blue = Math.trunc(((value & 0x1f) * 255) / 31);
      return [red, green, blue, 255];
    }

    const alpha = Math.trunc((((value >> 12) & 0x7) * 255) / 7);
    const red = Math.trunc((((value >> 8) & 0xf) * 255) / 15);
    const green = Math.trunc((((value >> 4) & 0xf) * 255) / 15);
    const blue = Math.trunc(((value & 0xf) * 255) / 15);
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
      const red = ((value >> 11) & 0x1f) * 8;
      const green = ((value >> 5) & 0x3f) * 4;
      const blue = (value & 0x1f) * 8;
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

              const red = ((value >> 11) & 0x1f) * 8;
              const green = ((value >> 5) & 0x3f) * 4;
              const blue = (value & 0x1f) * 8;
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

    case 10: {
      // CI14X2: 14-bit palette index packed into a u16 (lowest 2 bits unused).
      for (let blockY = 0; blockY < height; blockY += 4) {
        for (let blockX = 0; blockX < width; blockX += 4) {
          for (let y = 0; y < 4; y += 1) {
            for (let x = 0; x < 4; x += 1) {
              if (srcOffset + 1 >= src.length) {
                break;
              }

              const packed = (src[srcOffset] << 8) | src[srcOffset + 1];
              srcOffset += 2;
              const index = (packed >> 2) & 0x3fff;
              const [red, green, blue, alpha] = decodePaletteColor(palette, index);
              setPixel(blockX + x, blockY + y, red, green, blue, alpha);
            }
          }
        }
      }
      break;
    }

    case 14: {
      // Benzin-style weighted average in RGB565 space (Segher Boessenkool).
      function avg565(w0, w1, c0, c1) {
        const r = Math.trunc((w0 * (c0 >> 11) + w1 * (c1 >> 11)) / (w0 + w1));
        const g = Math.trunc((w0 * ((c0 >> 5) & 63) + w1 * ((c1 >> 5) & 63)) / (w0 + w1));
        const b = Math.trunc((w0 * (c0 & 31) + w1 * (c1 & 31)) / (w0 + w1));
        return (r << 11) | (g << 5) | b;
      }

      // Benzin-style shift-and-mask extraction from RGB565 to 8-bit channels.
      function rgb565ToArray(raw) {
        return [
          (raw >> 8) & 0xf8,
          (raw >> 3) & 0xf8,
          (raw << 3) & 0xf8,
        ];
      }

      function decodeDXT1Block(offset) {
        if (offset + 7 >= src.length) {
          return null;
        }

        const c0 = (src[offset] << 8) | src[offset + 1];
        const c1 = (src[offset + 2] << 8) | src[offset + 3];

        const rawColors = [c0, c1];
        if (c0 > c1) {
          rawColors[2] = avg565(2, 1, c0, c1);
          rawColors[3] = avg565(1, 2, c0, c1);
        } else {
          rawColors[2] = avg565(1, 1, c0, c1);
          rawColors[3] = rawColors[2];
        }

        const colors = rawColors.map(rgb565ToArray);
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
