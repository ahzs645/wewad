import { BinaryReader, withLogger } from "../shared/index";

function decodeUtf16BeString(view, start, end) {
  if (start < 0 || start >= end) {
    return "";
  }

  const chars = [];
  let cursor = start;
  while (cursor + 1 < end) {
    const code = view.getUint16(cursor, false);
    if (code === 0) {
      break;
    }
    chars.push(code);
    cursor += 2;
  }

  if (chars.length === 0) {
    return "";
  }

  let value = "";
  for (const code of chars) {
    value += String.fromCharCode(code);
  }
  return value;
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
    fonts: [],
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

      case "fnl1": {
        const numFonts = reader.u16();
        reader.skip(2);

        const offsets = [];
        for (let i = 0; i < numFonts; i += 1) {
          offsets.push(reader.u32());
          reader.skip(4);
        }

        const stringBase = sectionStart + 12;
        for (const offset of offsets) {
          const nameReader = new BinaryReader(buffer, stringBase + offset);
          const fontName = nameReader.nullString();
          layout.fonts.push(fontName);
          logger.info(`  Font ref: ${fontName}`);
        }
        break;
      }

      case "grp1": {
        const name = reader.string(16).replace(/\0+$/, "");
        const numPanes = reader.u16();
        reader.skip(2);

        const paneNames = [];
        const sectionEnd = sectionStart + sectionSize;
        for (let i = 0; i < numPanes && reader.offset + 16 <= sectionEnd; i += 1) {
          paneNames.push(reader.string(16).replace(/\0+$/, ""));
        }

        layout.groups.push({
          name,
          paneNames,
        });
        logger.info(`  Group: ${name} (${paneNames.length} pane(s))`);
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
        } else if (sectionMagic === "txt1") {
          // txt1 extends pan1 with text metadata and UTF-16BE payload.
          // Field order (big-endian):
          // +0  u16 textBufferBytes
          // +2  u16 textLengthBytes
          // +4  u16 material index
          // +6  u16 font index
          // +8  u8  text alignment/position flags
          // +9  u8  text line alignment
          // +10 u16 reserved
          // +12 u32 text offset (relative to section start)
          // +16 RGBA top color
          // +20 RGBA bottom color
          // +24 f32 font size x
          // +28 f32 font size y
          // +32 f32 char spacing
          // +36 f32 line spacing
          const txtBase = sectionStart + 8 + 68;
          const sectionEnd = sectionStart + sectionSize;

          if (txtBase + 40 <= sectionEnd) {
            pane.textBufferBytes = reader.view.getUint16(txtBase, false);
            pane.textLengthBytes = reader.view.getUint16(txtBase + 2, false);
            pane.materialIndex = reader.view.getUint16(txtBase + 4, false);
            pane.fontIndex = reader.view.getUint16(txtBase + 6, false);
            pane.textPositionFlags = reader.view.getUint8(txtBase + 8);
            pane.textAlignment = reader.view.getUint8(txtBase + 9);

            const textOffset = reader.view.getUint32(txtBase + 12, false);
            pane.textOffset = textOffset;
            pane.textTopColor = {
              r: reader.view.getUint8(txtBase + 16),
              g: reader.view.getUint8(txtBase + 17),
              b: reader.view.getUint8(txtBase + 18),
              a: reader.view.getUint8(txtBase + 19),
            };
            pane.textBottomColor = {
              r: reader.view.getUint8(txtBase + 20),
              g: reader.view.getUint8(txtBase + 21),
              b: reader.view.getUint8(txtBase + 22),
              a: reader.view.getUint8(txtBase + 23),
            };
            pane.textSize = {
              x: reader.view.getFloat32(txtBase + 24, false),
              y: reader.view.getFloat32(txtBase + 28, false),
            };
            pane.charSpacing = reader.view.getFloat32(txtBase + 32, false);
            pane.lineSpacing = reader.view.getFloat32(txtBase + 36, false);

            const textStart = sectionStart + textOffset;
            const textEnd = Math.min(sectionEnd, textStart + Math.max(0, pane.textBufferBytes));
            if (textStart >= sectionStart && textStart < sectionEnd && textEnd > textStart) {
              pane.text = decodeUtf16BeString(reader.view, textStart, textEnd);
            } else {
              pane.text = "";
            }

            if (pane.fontIndex >= 0 && pane.fontIndex < layout.fonts.length) {
              pane.fontName = layout.fonts[pane.fontIndex];
            }
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
