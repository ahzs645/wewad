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

function readTexturedPaneBlock(reader, sectionStart, sectionSize, includeVertexColors = true) {
  const sectionEnd = sectionStart + sectionSize;
  const dataStart = sectionStart + 8 + 68;
  if (dataStart >= sectionEnd) {
    return {
      vertexColors: includeVertexColors
        ? [
            { r: 255, g: 255, b: 255, a: 255 },
            { r: 255, g: 255, b: 255, a: 255 },
            { r: 255, g: 255, b: 255, a: 255 },
            { r: 255, g: 255, b: 255, a: 255 },
          ]
        : null,
      materialIndex: -1,
      texCoords: [],
    };
  }

  reader.seek(dataStart);

  let vertexColors = null;
  if (includeVertexColors && reader.offset + 16 <= sectionEnd) {
    vertexColors = [
      { r: reader.u8(), g: reader.u8(), b: reader.u8(), a: reader.u8() }, // tl
      { r: reader.u8(), g: reader.u8(), b: reader.u8(), a: reader.u8() }, // tr
      { r: reader.u8(), g: reader.u8(), b: reader.u8(), a: reader.u8() }, // bl
      { r: reader.u8(), g: reader.u8(), b: reader.u8(), a: reader.u8() }, // br
    ];
  }

  let materialIndex = -1;
  if (reader.offset + 2 <= sectionEnd) {
    materialIndex = reader.u16();
  }

  let texCoordCount = 0;
  if (reader.offset + 1 <= sectionEnd) {
    texCoordCount = reader.u8();
    reader.skip(1);
  }

  const texCoords = [];
  const remainingBytes = sectionEnd - reader.offset;
  const maxTexCoordCount = Math.max(0, Math.floor(remainingBytes / 32));
  const safeTexCoordCount = Math.min(texCoordCount, maxTexCoordCount);
  for (let i = 0; i < safeTexCoordCount; i += 1) {
    texCoords.push({
      tl: { s: reader.f32(), t: reader.f32() },
      tr: { s: reader.f32(), t: reader.f32() },
      bl: { s: reader.f32(), t: reader.f32() },
      br: { s: reader.f32(), t: reader.f32() },
    });
  }

  return {
    vertexColors,
    materialIndex,
    texCoords,
  };
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
  const fileSize = reader.u32();
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

  // Some BRLYTs have more sections than numSections indicates (group sub-sections
  // after grs1 are not counted in the header).  Use the file size as the boundary.
  const bufferLength = reader.buffer.byteLength;
  const fileEnd = fileSize > 0 ? Math.min(fileSize, bufferLength) : bufferLength;
  const maxSections = numSections + 200; // safety cap for extra group sections
  for (let sectionIndex = 0; (sectionIndex < numSections || reader.offset + 8 <= fileEnd) && sectionIndex < maxSections; sectionIndex += 1) {
    const sectionStart = reader.offset;
    const sectionMagic = reader.string(4);
    const sectionSize = reader.u32();

    if (sectionSize < 8) {
      break; // invalid section — stop parsing
    }

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
          // Fore Color, Back Color, Color Register 3: Int16[4] each
          const color1 = [];
          const color2 = [];
          const color3 = [];
          for (let colorIndex = 0; colorIndex < 4; colorIndex += 1) {
            color1.push(reader.view.getInt16(materialStart + 20 + colorIndex * 2, false));
            color2.push(reader.view.getInt16(materialStart + 28 + colorIndex * 2, false));
            color3.push(reader.view.getInt16(materialStart + 36 + colorIndex * 2, false));
          }
          // TEV Colors 1-4: Byte[4] RGBA each
          const tevColors = [];
          for (let tevIdx = 0; tevIdx < 4; tevIdx += 1) {
            const base = materialStart + 0x2c + tevIdx * 4;
            if (base + 3 < materialEnd) {
              tevColors.push({
                r: reader.view.getUint8(base),
                g: reader.view.getUint8(base + 1),
                b: reader.view.getUint8(base + 2),
                a: reader.view.getUint8(base + 3),
              });
            }
          }
          const flagsOffset = materialStart + 0x3c;
          const flags = flagsOffset + 4 <= materialEnd ? reader.view.getUint32(flagsOffset, false) : 0;

          // BRLYT mat1 flags bitfield: AAAA BCDE FGGG GGHH HIIJ KKKK LLLL MMMM
          // M=texMapCount, L=texSrtCount, K=texCoordGenCount, J=hasTevSwap,
          // I=indTexMatrixCount, H=indTexStageCount, G=tevStageCount,
          // F=hasAlphaCompare, E=hasBlendMode, D=hasChanControl, B=hasMatColor
          const textureMapCount = flags & 0x0f;
          const textureSrtCount = (flags >> 4) & 0x0f;
          const texCoordGenCount = (flags >> 8) & 0x0f;
          const hasTevSwapTable = (flags >> 12) & 0x01;
          const indTexMatrixCount = (flags >> 13) & 0x03;
          const indTexStageCount = (flags >> 15) & 0x07;
          const tevStageCount = (flags >> 18) & 0x1f;
          const hasAlphaCompare = (flags >> 23) & 0x01;
          const hasBlendMode = (flags >> 24) & 0x01;
          const hasChannelControl = (flags >> 25) & 0x01;
          const hasMaterialColor = (flags >> 27) & 0x01;

          const textureMaps = [];
          let cursor = materialStart + 64;
          for (let mapIndex = 0; mapIndex < textureMapCount && cursor + 3 < materialEnd; mapIndex += 1) {
            const textureIndex = reader.view.getUint16(cursor, false);
            // Texture setting bitfield: AAAB BBCC DDDD EEFF
            // FF=wrapT, EE=magFilter, DDDD=unused, CC=wrapS, BBB=minFilter
            const texSettings = reader.view.getUint16(cursor + 2, false);
            const wrapS = (texSettings >> 8) & 0x03;
            const wrapT = texSettings & 0x03;

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

          // TexCoordGen entries (4 bytes each).
          const texCoordGens = [];
          for (let tcg = 0; tcg < texCoordGenCount; tcg += 1) {
            if (cursor + 3 < materialEnd) {
              texCoordGens.push({
                texGenType: reader.view.getUint8(cursor),
                texGenSrc: reader.view.getUint8(cursor + 1),
                mtxSrc: reader.view.getUint8(cursor + 2),
              });
            }
            cursor += 4;
          }

          // Channel Control (4 bytes if present).
          let channelControl = null;
          if (hasChannelControl && cursor + 3 < materialEnd) {
            channelControl = {
              colorSource: reader.view.getUint8(cursor),
              alphaSource: reader.view.getUint8(cursor + 1),
            };
            cursor += 4;
          }

          // Material Color (4 bytes RGBA if present).
          let materialColor = null;
          if (hasMaterialColor && cursor + 3 < materialEnd) {
            materialColor = {
              r: reader.view.getUint8(cursor),
              g: reader.view.getUint8(cursor + 1),
              b: reader.view.getUint8(cursor + 2),
              a: reader.view.getUint8(cursor + 3),
            };
            cursor += 4;
          }

          // TEV Swap Table (4 bytes if present): 4 entries, 1 byte each.
          // Each byte: R(1:0), G(3:2), B(5:4), A(7:6) channel selectors.
          let tevSwapTable = null;
          if (hasTevSwapTable && cursor + 3 < materialEnd) {
            tevSwapTable = [];
            for (let sw = 0; sw < 4; sw += 1) {
              const b = reader.view.getUint8(cursor + sw);
              tevSwapTable.push({
                r: b & 3,
                g: (b >> 2) & 3,
                b: (b >> 4) & 3,
                a: (b >> 6) & 3,
              });
            }
            cursor += 4;
          }

          // Indirect Texture Matrix (20 bytes each): SRT transform.
          const indTexMatrices = [];
          for (let itm = 0; itm < indTexMatrixCount; itm += 1) {
            if (cursor + 19 < materialEnd) {
              indTexMatrices.push({
                xTrans: reader.view.getFloat32(cursor, false),
                yTrans: reader.view.getFloat32(cursor + 4, false),
                rotation: reader.view.getFloat32(cursor + 8, false),
                xScale: reader.view.getFloat32(cursor + 12, false),
                yScale: reader.view.getFloat32(cursor + 16, false),
              });
            }
            cursor += 20;
          }

          // Indirect Texture Stage (4 bytes each).
          const indTexStages = [];
          for (let its = 0; its < indTexStageCount; its += 1) {
            if (cursor + 3 < materialEnd) {
              indTexStages.push({
                texMap: reader.view.getUint8(cursor),
                texCoord: reader.view.getUint8(cursor + 1),
                scaleS: reader.view.getUint8(cursor + 2),
                scaleT: reader.view.getUint8(cursor + 3),
              });
            }
            cursor += 4;
          }

          // TEV Stages (16 bytes each). Bitfields are LSB-first within bytes,
          // matching the GX hardware register layout and wii-banner-player Material.h.
          const tevStages = [];
          for (let ts = 0; ts < tevStageCount; ts += 1) {
            if (cursor + 15 >= materialEnd) {
              cursor += 16;
              continue;
            }
            const b0 = reader.view.getUint8(cursor);
            const b1 = reader.view.getUint8(cursor + 1);
            const b2 = reader.view.getUint8(cursor + 2);
            const b3 = reader.view.getUint8(cursor + 3);
            const b4 = reader.view.getUint8(cursor + 4);
            const b5 = reader.view.getUint8(cursor + 5);
            const b6 = reader.view.getUint8(cursor + 6);
            const b7 = reader.view.getUint8(cursor + 7);
            const b8 = reader.view.getUint8(cursor + 8);
            const b9 = reader.view.getUint8(cursor + 9);
            const b10 = reader.view.getUint8(cursor + 10);
            const b11 = reader.view.getUint8(cursor + 11);
            const b12 = reader.view.getUint8(cursor + 12);
            const b13 = reader.view.getUint8(cursor + 13);
            const b14 = reader.view.getUint8(cursor + 14);
            const b15 = reader.view.getUint8(cursor + 15);

            tevStages.push({
              // Bytes 0-1: order
              texCoord: b0,
              colorChan: b1,
              // Bytes 2-3: texMap(9 bits), rasSel(2), texSel(2), pad(3) — LSB-first
              texMap: b2 | ((b3 & 1) << 8),
              rasSel: (b3 >> 1) & 3,
              texSel: (b3 >> 3) & 3,
              // Bytes 4-5: color combiner inputs — a,b,c,d are LSB-first nibbles
              aC: b4 & 0xf,
              bC: (b4 >> 4) & 0xf,
              cC: b5 & 0xf,
              dC: (b5 >> 4) & 0xf,
              // Byte 6: op(4), bias(2), scale(2) — matches wii-banner-player Material.h
              // op stores the GX_TEV_* enum: 0=ADD, 1=SUB, 8-15=compare modes
              tevOpC: b6 & 0xf,
              tevBiasC: (b6 >> 4) & 3,
              tevScaleC: (b6 >> 6) & 3,
              // Byte 7: clamp(1), regId(2), kColorSel(5) — matches wii-banner-player Material.h
              clampC: b7 & 1,
              tevRegIdC: (b7 >> 1) & 3,
              kColorSelC: (b7 >> 3) & 0x1f,
              // Bytes 8-9: alpha combiner inputs — same LSB-first layout
              aA: b8 & 0xf,
              bA: (b8 >> 4) & 0xf,
              cA: b9 & 0xf,
              dA: (b9 >> 4) & 0xf,
              // Byte 10: op(4), bias(2), scale(2) — matches wii-banner-player Material.h
              // op stores the GX_TEV_* enum: 0=ADD, 1=SUB, 8-15=compare modes
              tevOpA: b10 & 0xf,
              tevBiasA: (b10 >> 4) & 3,
              tevScaleA: (b10 >> 6) & 3,
              // Byte 11: clamp(1), regId(2), kAlphaSel(5) — matches wii-banner-player Material.h
              clampA: b11 & 1,
              tevRegIdA: (b11 >> 1) & 3,
              kAlphaSelA: (b11 >> 3) & 0x1f,
              // Bytes 12-15: indirect texture — LSB-first
              indTexId: b12 & 3,
              indBias: b13 & 7,
              indMtxId: (b13 >> 3) & 0xf,
              indWrapS: b14 & 7,
              indWrapT: (b14 >> 3) & 7,
              indFormat: b15 & 3,
              indAddPrev: (b15 >> 2) & 1,
              indUtcLod: (b15 >> 3) & 1,
              indAlpha: (b15 >> 4) & 3,
            });
            cursor += 16;
          }

          // Alpha Compare (4 bytes if present).
          let alphaCompare = null;
          if (hasAlphaCompare && cursor + 3 < materialEnd) {
            const conditions = reader.view.getUint8(cursor);
            alphaCompare = {
              condition0: conditions & 0x0f,
              condition1: (conditions >> 4) & 0x0f,
              operation: reader.view.getUint8(cursor + 1),
              value0: reader.view.getUint8(cursor + 2),
              value1: reader.view.getUint8(cursor + 3),
            };
            cursor += 4;
          }

          // Blend Mode (4 bytes if present).
          let blendMode = null;
          if (hasBlendMode && cursor + 3 < materialEnd) {
            blendMode = {
              func: reader.view.getUint8(cursor),
              srcFactor: reader.view.getUint8(cursor + 1),
              dstFactor: reader.view.getUint8(cursor + 2),
              logicOp: reader.view.getUint8(cursor + 3),
            };
            cursor += 4;
          }

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

          layout.materials.push({
            name, index: i, flags, textureMaps, textureSRTs, textureIndices,
            color1, color2, color3, tevColors,
            texCoordGens, tevSwapTable, indTexMatrices, indTexStages, tevStages,
            channelControl, materialColor, alphaCompare, blendMode,
          });
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

        if (sectionMagic === "pic1" || sectionMagic === "bnd1") {
          const texturedData = readTexturedPaneBlock(reader, sectionStart, sectionSize, true);
          if (texturedData.vertexColors) {
            pane.vertexColors = texturedData.vertexColors;
          }
          pane.materialIndex = texturedData.materialIndex;
          pane.texCoords = texturedData.texCoords;
        } else if (sectionMagic === "wnd1") {
          // wnd1 has extra fields between pane header and Quad data:
          //   inflation (4 floats = 16 bytes) + frame_count (u8) + pad (3) + content_offset (u32) + frame_table_offset (u32)
          // The Quad data (vertex colors, material, tex coords) is at content_offset from section start.
          const wndDataStart = sectionStart + 8 + 68;
          const sectionEnd = sectionStart + sectionSize;
          if (wndDataStart + 28 <= sectionEnd) {
            reader.seek(wndDataStart);
            pane.inflation = {
              l: reader.f32(),
              r: reader.f32(),
              t: reader.f32(),
              b: reader.f32(),
            };
            const frameCount = reader.u8();
            reader.skip(3);
            const contentOffset = reader.u32();
            const frameTableOffset = reader.u32();

            // Read content Quad at content_offset (relative to section start).
            if (contentOffset > 0 && sectionStart + contentOffset < sectionEnd) {
              const savedOffset = reader.offset;
              // readTexturedPaneBlock expects to read from sectionStart + 8 + 68, so we create
              // a virtual section where the Quad data starts at the content offset.
              reader.seek(sectionStart + contentOffset);
              const vtxClr = [];
              if (reader.offset + 16 <= sectionEnd) {
                for (let c = 0; c < 4; c += 1) {
                  vtxClr.push({ r: reader.u8(), g: reader.u8(), b: reader.u8(), a: reader.u8() });
                }
              }
              let matIdx = -1;
              if (reader.offset + 2 <= sectionEnd) {
                matIdx = reader.u16();
              }
              let texCoordCnt = 0;
              if (reader.offset + 1 <= sectionEnd) {
                texCoordCnt = reader.u8();
                reader.skip(1);
              }
              const texCrds = [];
              for (let i = 0; i < texCoordCnt; i += 1) {
                if (reader.offset + 32 > sectionEnd) {
                  break;
                }
                texCrds.push({
                  tl: { s: reader.f32(), t: reader.f32() },
                  tr: { s: reader.f32(), t: reader.f32() },
                  bl: { s: reader.f32(), t: reader.f32() },
                  br: { s: reader.f32(), t: reader.f32() },
                });
              }
              if (vtxClr.length === 4) {
                pane.vertexColors = vtxClr;
              }
              pane.materialIndex = matIdx;
              pane.texCoords = texCrds;
              reader.seek(savedOffset);
            }

            // Read frame materials.
            pane.windowFrames = [];
            if (frameCount > 0 && frameTableOffset > 0 && sectionStart + frameTableOffset < sectionEnd) {
              reader.seek(sectionStart + frameTableOffset);
              const frameOffsets = [];
              for (let i = 0; i < frameCount; i += 1) {
                if (reader.offset + 4 > sectionEnd) {
                  break;
                }
                frameOffsets.push(reader.u32());
              }
              const tableBase = sectionStart + frameTableOffset;
              for (const fOff of frameOffsets) {
                const absPos = tableBase + fOff;
                if (absPos + 3 <= sectionEnd) {
                  reader.seek(absPos);
                  pane.windowFrames.push({
                    materialIndex: reader.u16(),
                    textureFlip: reader.u8(),
                  });
                }
              }
            }
          } else {
            // Fallback: not enough data for window fields, treat as simple textured pane.
            const texturedData = readTexturedPaneBlock(reader, sectionStart, sectionSize, true);
            if (texturedData.vertexColors) {
              pane.vertexColors = texturedData.vertexColors;
            }
            pane.materialIndex = texturedData.materialIndex;
            pane.texCoords = texturedData.texCoords;
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
