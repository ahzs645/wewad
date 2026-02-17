/**
 * Diagnostic script: dump raw TEV stage bytes for materials with TEV stages
 * in the Wii Shop Channel icon BRLYT.
 *
 * For each TEV stage, shows:
 *   - All 16 raw bytes in hex
 *   - Parsed fields (from our parser)
 *   - Byte 6 and byte 10 under three different interpretations:
 *     (a) benzin order: scale=bits[0:1], bias=bits[2:3], op=bits[4:7]
 *     (b) wii-banner-player order: op=bits[0:3], bias=bits[4:5], scale=bits[6:7]
 *     (c) GX hardware register order: bias=bits[0:1], op=bit[2], clamp=bit[3], scale=bits[4:5], pad=bits[6:7]
 *
 * Usage: node debug_tev_bytes.mjs
 */

import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { createServer } from "vite";

// Polyfill globalThis.crypto for Node.js
if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.crypto.subtle && webcrypto.subtle) globalThis.crypto.subtle = webcrypto.subtle;

function toArrayBuffer(nodeBuffer) {
  const ab = new ArrayBuffer(nodeBuffer.byteLength);
  const view = new Uint8Array(ab);
  view.set(new Uint8Array(nodeBuffer.buffer, nodeBuffer.byteOffset, nodeBuffer.byteLength));
  return ab;
}

function hr(title) {
  console.log("\n" + "=".repeat(78));
  console.log("  " + title);
  console.log("=".repeat(78));
}

function bits(value, width = 8) {
  return value.toString(2).padStart(width, "0");
}

function hex(value) {
  return "0x" + value.toString(16).padStart(2, "0");
}

// GX enum names for readability
const GX_TEV_COLOR_INPUTS = [
  "CPREV", "APREV", "C0", "A0", "C1", "A1", "C2", "A2",
  "TEXC", "TEXA", "RASC", "RASA", "ONE", "HALF", "KONST", "ZERO"
];
const GX_TEV_ALPHA_INPUTS = [
  "APREV", "A0", "A1", "A2", "TEXA", "RASA", "KONST", "ZERO"
];
const GX_TEV_OPS = ["ADD", "SUB"];
const GX_TEV_BIAS = ["ZERO", "ADDHALF", "SUBHALF", "COMPARE"];
const GX_TEV_SCALE = ["SCALE_1", "SCALE_2", "SCALE_4", "DIVIDE_2"];
const GX_TEV_REGS = ["CPREV", "C0", "C1", "C2"];

function nameColorInput(val) { return GX_TEV_COLOR_INPUTS[val] || `?${val}`; }
function nameAlphaInput(val) { return GX_TEV_ALPHA_INPUTS[val] || `?${val}`; }
function nameOp(val) { return GX_TEV_OPS[val] || `OP_${val}`; }
function nameBias(val) { return GX_TEV_BIAS[val] || `BIAS_${val}`; }
function nameScale(val) { return GX_TEV_SCALE[val] || `SCALE_${val}`; }
function nameReg(val) { return GX_TEV_REGS[val] || `REG_${val}`; }

function interpretByte6or10(byteVal, label) {
  console.log(`\n      --- ${label} = ${hex(byteVal)} = ${bits(byteVal)} ---`);

  // (a) benzin / our parser: scale(2), bias(2), op(4) -- LSB first
  const a_scale = byteVal & 3;
  const a_bias = (byteVal >> 2) & 3;
  const a_op = (byteVal >> 4) & 0xf;
  console.log(`      (a) benzin/ours:        scale=${a_scale} (${nameScale(a_scale)})  bias=${a_bias} (${nameBias(a_bias)})  op=${a_op} (${nameOp(a_op)})`);
  console.log(`         bit layout: [7..4]=op=${bits(a_op,4)} [3..2]=bias=${bits(a_bias,2)} [1..0]=scale=${bits(a_scale,2)}`);

  // (b) wii-banner-player: op(4), bias(2), scale(2) -- LSB first (their code order)
  const b_op = byteVal & 0xf;
  const b_bias = (byteVal >> 4) & 3;
  const b_scale = (byteVal >> 6) & 3;
  console.log(`      (b) wii-banner-player:  op=${b_op} (${nameOp(b_op)})  bias=${b_bias} (${nameBias(b_bias)})  scale=${b_scale} (${nameScale(b_scale)})`);
  console.log(`         bit layout: [7..6]=scale=${bits(b_scale,2)} [5..4]=bias=${bits(b_bias,2)} [3..0]=op=${bits(b_op,4)}`);

  // (c) GX hardware register (GX_CC_COLORREG / BP register): bias(2), op(1), clamp(1), scale(2), pad(2)
  const c_bias = byteVal & 3;
  const c_op = (byteVal >> 2) & 1;
  const c_clamp = (byteVal >> 3) & 1;
  const c_scale = (byteVal >> 4) & 3;
  const c_pad = (byteVal >> 6) & 3;
  console.log(`      (c) GX HW register:     bias=${c_bias} (${nameBias(c_bias)})  op=${c_op} (${nameOp(c_op)})  clamp=${c_clamp}  scale=${c_scale} (${nameScale(c_scale)})  pad=${c_pad}`);
  console.log(`         bit layout: [7..6]=pad=${bits(c_pad,2)} [5..4]=scale=${bits(c_scale,2)} [3]=clamp=${c_clamp} [2]=op=${c_op} [1..0]=bias=${bits(c_bias,2)}`);
}

async function main() {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });

  const { parseWAD } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/wad.js");
  const { parseU8 } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/u8.js");
  const { parseBRLYT } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/brlyt.js");
  const { decryptWadContents } = await server.ssrLoadModule("/src/lib/wadRenderer/pipeline/decryption.js");

  const logger = {
    info:    () => {},
    warn:    (...args) => console.warn("[WARN]", ...args),
    error:   (...args) => console.error("[ERROR]", ...args),
    success: () => {},
  };

  const wadPath = "/Users/ahmadjalil/github/wewad/New Folder With Items/Wii Shop Channel (World) (v20) (Channel).wad";

  hr("1. Reading & parsing WAD");
  const rawBuffer = readFileSync(wadPath);
  const arrayBuffer = toArrayBuffer(rawBuffer);
  const wad = parseWAD(arrayBuffer, logger);
  console.log(`  Title: ${wad.titleId}, ${wad.numContents} contents`);

  hr("2. Decrypting");
  const decryptedContents = await decryptWadContents(wad, logger);
  if (!decryptedContents) {
    console.error("  Decryption failed.");
    await server.close();
    process.exit(1);
  }

  hr("3. Extracting icon.bin from meta archive");
  const metaAppName = wad.contentRecords.find((r) => r.index === 0)?.name;
  const metaFiles = parseU8(decryptedContents[metaAppName], logger);
  const iconEntry = Object.entries(metaFiles).find(([p]) => p.toLowerCase().includes("icon.bin"));
  if (!iconEntry) {
    console.error("  icon.bin not found!");
    await server.close();
    process.exit(1);
  }
  const [iconPath, iconData] = iconEntry;
  console.log(`  Found: ${iconPath} (${iconData.byteLength} bytes)`);

  hr("4. Parsing icon.bin U8 archive -> BRLYT");
  const iconFiles = parseU8(iconData, logger);
  const brlytEntry = Object.entries(iconFiles).find(([p]) => p.toLowerCase().endsWith(".brlyt"));
  if (!brlytEntry) {
    console.error("  No .brlyt found!");
    await server.close();
    process.exit(1);
  }
  const [brlytPath, brlytData] = brlytEntry;
  console.log(`  BRLYT: ${brlytPath} (${brlytData.byteLength} bytes)`);
  const layout = parseBRLYT(brlytData, logger);
  console.log(`  Materials: ${layout.materials.length}, Textures: ${layout.textures.length}`);

  // Also get raw bytes from the BRLYT buffer for manual verification
  const brlytView = new DataView(brlytData instanceof ArrayBuffer ? brlytData : brlytData.buffer || brlytData);

  hr("5. Materials with TEV stages");

  // We need to re-locate mat1 and material offsets to get raw bytes.
  // Scan brlytData for "mat1" section.
  const brlytBytes = new Uint8Array(brlytData instanceof ArrayBuffer ? brlytData : brlytData.buffer || brlytData);
  let mat1Start = -1;
  for (let i = 0; i < brlytBytes.length - 4; i++) {
    if (brlytBytes[i] === 0x6D && brlytBytes[i+1] === 0x61 && brlytBytes[i+2] === 0x74 && brlytBytes[i+3] === 0x31) {
      mat1Start = i;
      break;
    }
  }
  console.log(`  mat1 section found at offset ${mat1Start}`);

  // Read mat1 header
  const mat1Size = brlytView.getUint32(mat1Start + 4, false);
  const numMaterials = brlytView.getUint16(mat1Start + 8, false);
  console.log(`  mat1 size=${mat1Size}, numMaterials=${numMaterials}`);

  // Read material offsets
  const matOffsets = [];
  for (let i = 0; i < numMaterials; i++) {
    matOffsets.push(brlytView.getUint32(mat1Start + 12 + i * 4, false));
  }

  for (const mat of layout.materials) {
    if (mat.tevStages.length === 0) continue;

    console.log(`\n${"*".repeat(78)}`);
    console.log(`  Material [${mat.index}]: "${mat.name}"  flags=0x${mat.flags.toString(16)}`);
    console.log(`  TEV stages: ${mat.tevStages.length}`);
    console.log(`  Texture maps: ${mat.textureMaps.map(tm => `[${tm.textureIndex}]${tm.textureIndex < layout.textures.length ? layout.textures[tm.textureIndex] : '?'}`).join(', ')}`);
    if (mat.tevColors.length > 0) {
      for (let ki = 0; ki < mat.tevColors.length; ki++) {
        const k = mat.tevColors[ki];
        console.log(`  kColor[${ki}]: (${k.r}, ${k.g}, ${k.b}, ${k.a})`);
      }
    }
    console.log(`  color1 (C0): [${mat.color1.join(", ")}]`);
    console.log(`  color2 (C1): [${mat.color2.join(", ")}]`);
    console.log(`  color3 (C2): [${mat.color3.join(", ")}]`);

    if (mat.alphaCompare) {
      const ac = mat.alphaCompare;
      console.log(`  alphaCompare: cond0=${ac.condition0} cond1=${ac.condition1} op=${ac.operation} val0=${ac.value0} val1=${ac.value1}`);
    }

    // Find the raw TEV stage bytes in the BRLYT buffer.
    // We need to re-walk the material to find where TEV stages start.
    const materialStart = mat1Start + matOffsets[mat.index];

    // Walk through the material structure to find TEV stage offset
    const flags = mat.flags;
    const textureMapCount = flags & 0x0f;
    const textureSrtCount = (flags >> 4) & 0x0f;
    const texCoordGenCount = (flags >> 8) & 0x0f;
    const hasTevSwapTable = (flags >> 12) & 0x01;
    const indTexMatrixCount = (flags >> 13) & 0x03;
    const indTexStageCount = (flags >> 15) & 0x07;
    const hasAlphaCompare = (flags >> 23) & 0x01;
    const hasBlendMode = (flags >> 24) & 0x01;
    const hasChannelControl = (flags >> 25) & 0x01;
    const hasMaterialColor = (flags >> 27) & 0x01;

    let cursor = materialStart + 64; // name(20) + color1(8) + color2(8) + color3(8) + tevColors(16) + flags(4)
    cursor += textureMapCount * 4;
    cursor += textureSrtCount * 20;
    cursor += texCoordGenCount * 4;
    if (hasChannelControl) cursor += 4;
    if (hasMaterialColor) cursor += 4;
    if (hasTevSwapTable) cursor += 4;
    cursor += indTexMatrixCount * 20;
    cursor += indTexStageCount * 4;

    const tevStageOffset = cursor;
    console.log(`  TEV stages raw offset in BRLYT: ${tevStageOffset} (0x${tevStageOffset.toString(16)})`);

    for (let ti = 0; ti < mat.tevStages.length; ti++) {
      const s = mat.tevStages[ti];
      const stageOff = tevStageOffset + ti * 16;

      // Read raw 16 bytes
      const rawBytes = [];
      for (let bi = 0; bi < 16; bi++) {
        rawBytes.push(brlytBytes[stageOff + bi]);
      }

      console.log(`\n    ---- TEV Stage ${ti} (offset ${stageOff} / 0x${stageOff.toString(16)}) ----`);
      console.log(`    Raw bytes: ${rawBytes.map(b => hex(b)).join(" ")}`);
      console.log(`    Raw binary:`);
      for (let bi = 0; bi < 16; bi++) {
        console.log(`      byte ${bi.toString().padStart(2)}: ${hex(rawBytes[bi])} = ${bits(rawBytes[bi])}`);
      }

      console.log(`\n    Parsed (our parser):`);
      console.log(`      order: texCoord=${s.texCoord} colorChan=${s.colorChan} texMap=${s.texMap} rasSel=${s.rasSel} texSel=${s.texSel}`);
      console.log(`      color: a=${s.aC}(${nameColorInput(s.aC)}) b=${s.bC}(${nameColorInput(s.bC)}) c=${s.cC}(${nameColorInput(s.cC)}) d=${s.dC}(${nameColorInput(s.dC)})`);
      console.log(`             op=${s.tevOpC}(${nameOp(s.tevOpC)}) bias=${s.tevBiasC}(${nameBias(s.tevBiasC)}) scale=${s.tevScaleC}(${nameScale(s.tevScaleC)}) clamp=${s.clampC} regId=${s.tevRegIdC}(${nameReg(s.tevRegIdC)}) kColorSel=${s.kColorSelC}`);
      console.log(`      alpha: a=${s.aA}(${nameAlphaInput(s.aA)}) b=${s.bA}(${nameAlphaInput(s.bA)}) c=${s.cA}(${nameAlphaInput(s.cA)}) d=${s.dA}(${nameAlphaInput(s.dA)})`);
      console.log(`             op=${s.tevOpA}(${nameOp(s.tevOpA)}) bias=${s.tevBiasA}(${nameBias(s.tevBiasA)}) scale=${s.tevScaleA}(${nameScale(s.tevScaleA)}) clamp=${s.clampA} regId=${s.tevRegIdA}(${nameReg(s.tevRegIdA)}) kAlphaSel=${s.kAlphaSelA}`);

      // Now show byte 6 and byte 10 interpretations
      interpretByte6or10(rawBytes[6], `Byte 6 (color op/bias/scale)`);
      interpretByte6or10(rawBytes[10], `Byte 10 (alpha op/bias/scale)`);

      // Also show byte 7 and byte 11 interpretations
      const b7 = rawBytes[7];
      console.log(`\n      --- Byte 7 (color clamp/regId/kSel) = ${hex(b7)} = ${bits(b7)} ---`);
      // Our parser: clamp(1), regId(2), kColorSel(5)
      console.log(`      (ours/wbp): clamp=${b7 & 1}  regId=${(b7 >> 1) & 3}(${nameReg((b7 >> 1) & 3)})  kColorSel=${(b7 >> 3) & 0x1f}`);
      // benzin: regId(1), clamp(2), sel(5)
      console.log(`      (benzin):   regId=${b7 & 1}  clamp=${(b7 >> 1) & 3}  sel=${(b7 >> 3) & 0x1f}`);
      // giantpune: sel(5), regId(2), clamp(1)
      console.log(`      (giantpune): sel=${b7 & 0x1f}  regId=${(b7 >> 5) & 3}  clamp=${(b7 >> 7) & 1}`);

      const b11 = rawBytes[11];
      console.log(`\n      --- Byte 11 (alpha clamp/regId/kAlphaSel) = ${hex(b11)} = ${bits(b11)} ---`);
      console.log(`      (ours/wbp): clamp=${b11 & 1}  regId=${(b11 >> 1) & 3}(${nameReg((b11 >> 1) & 3)})  kAlphaSel=${(b11 >> 3) & 0x1f}`);
      console.log(`      (benzin):   regId=${b11 & 1}  clamp=${(b11 >> 1) & 3}  sel=${(b11 >> 3) & 0x1f}`);
      console.log(`      (giantpune): sel=${b11 & 0x1f}  regId=${(b11 >> 5) & 3}  clamp=${(b11 >> 7) & 1}`);
    }
  }

  hr("Done");
  await server.close();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
