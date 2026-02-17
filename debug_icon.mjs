/**
 * Diagnostic script: parse the Wii Shop Channel WAD and examine icon.bin contents.
 * Uses Vite SSR to resolve bare imports used by the project's parsers.
 *
 * Usage: node debug_icon.mjs
 */

import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { createServer } from "vite";

// Polyfill globalThis.crypto for Node.js (needed by shared/crypto.js)
if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.crypto.subtle && webcrypto.subtle) globalThis.crypto.subtle = webcrypto.subtle;

// ---------- Helpers ----------
function toArrayBuffer(nodeBuffer) {
  const ab = new ArrayBuffer(nodeBuffer.byteLength);
  const view = new Uint8Array(ab);
  view.set(new Uint8Array(nodeBuffer.buffer, nodeBuffer.byteOffset, nodeBuffer.byteLength));
  return ab;
}

function hr(title) {
  console.log("\n" + "=".repeat(70));
  console.log("  " + title);
  console.log("=".repeat(70));
}

// ---------- Main ----------
async function main() {
  // Boot Vite in SSR mode to resolve bare specifiers
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });

  const { parseWAD } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/wad.js");
  const { parseU8 } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/u8.js");
  const { parseBRLYT } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/brlyt.js");
  const { parseBRLAN } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/brlan.js");
  const { parseTPL } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/tpl.js");
  const { TPL_FORMATS, ANIM_TYPES } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/constants.js");
  const { decryptWadContents } = await server.ssrLoadModule("/src/lib/wadRenderer/pipeline/decryption.js");

  const logger = {
    info:    (...args) => console.log("[INFO]", ...args),
    warn:    (...args) => console.warn("[WARN]", ...args),
    error:   (...args) => console.error("[ERROR]", ...args),
    success: (...args) => console.log("[OK]", ...args),
  };

  const wadPath = "/Users/ahmadjalil/github/wewad/New Folder With Items/Wii Shop Channel (World) (v20) (Channel).wad";

  hr("1. Reading WAD file");
  const rawBuffer = readFileSync(wadPath);
  const arrayBuffer = toArrayBuffer(rawBuffer);
  console.log(`  File size: ${rawBuffer.byteLength} bytes`);

  hr("2. Parsing WAD header");
  const wad = parseWAD(arrayBuffer, logger);
  console.log(`  Title ID: ${wad.titleId}`);
  console.log(`  Num contents: ${wad.numContents}`);
  console.log(`  Content records:`);
  for (const rec of wad.contentRecords) {
    console.log(`    ${rec.name}  index=${rec.index}  type=0x${rec.type.toString(16)}  size=${rec.size}`);
  }

  hr("3. Decrypting WAD contents");
  const decryptedContents = await decryptWadContents(wad, logger);
  if (!decryptedContents) {
    console.error("  Decryption failed or not available.");
    await server.close();
    process.exit(1);
  }
  console.log(`  Decrypted ${Object.keys(decryptedContents).length} content(s)`);

  hr("4. Finding meta archive (content index 0)");
  const metaAppName = wad.contentRecords.find((r) => r.index === 0)?.name;
  if (!metaAppName || !decryptedContents[metaAppName]) {
    console.error("  Could not find content index 0");
    await server.close();
    process.exit(1);
  }
  console.log(`  Meta archive: ${metaAppName}`);

  const quietLogger = { info: () => {}, warn: logger.warn, error: logger.error, success: () => {} };
  const metaFiles = parseU8(decryptedContents[metaAppName], quietLogger);
  console.log(`\n  Files in meta archive:`);
  for (const [path, data] of Object.entries(metaFiles)) {
    const size = data.byteLength ?? data.length ?? 0;
    console.log(`    ${path}  (${size} bytes)`);
  }

  hr("5. Extracting icon.bin");
  const iconEntry = Object.entries(metaFiles).find(([p]) => p.toLowerCase().includes("icon.bin"));
  if (!iconEntry) {
    console.error("  icon.bin not found in meta archive!");
    await server.close();
    process.exit(1);
  }
  const [iconPath, iconData] = iconEntry;
  console.log(`  Found: ${iconPath} (${iconData.byteLength} bytes)`);

  hr("6. Parsing icon.bin as U8 archive");
  const iconFiles = parseU8(iconData, quietLogger);
  console.log(`\n  All files in icon U8 archive:`);
  for (const [path, data] of Object.entries(iconFiles)) {
    const size = data.byteLength ?? data.length ?? 0;
    console.log(`    ${path}  (${size} bytes)`);
  }

  // ---------- BRLYT ----------
  hr("7. Parsing icon BRLYT");
  const brlytEntry = Object.entries(iconFiles).find(([p]) => p.toLowerCase().endsWith(".brlyt"));
  if (!brlytEntry) {
    console.error("  No .brlyt found in icon archive!");
  } else {
    const [brlytPath, brlytData] = brlytEntry;
    console.log(`  Layout file: ${brlytPath} (${brlytData.byteLength} bytes)\n`);
    const layout = parseBRLYT(brlytData, quietLogger);

    // 7a. Texture list
    console.log(`\n  --- Texture list (txl1) [${layout.textures.length}] ---`);
    layout.textures.forEach((t, i) => console.log(`    [${i}] ${t}`));

    // 7b. Fonts
    if (layout.fonts.length > 0) {
      console.log(`\n  --- Font list (fnl1) [${layout.fonts.length}] ---`);
      layout.fonts.forEach((f, i) => console.log(`    [${i}] ${f}`));
    }

    // 7c. Layout dimensions
    console.log(`\n  Layout dimensions: ${layout.width}x${layout.height}`);

    // 7d. Panes
    console.log(`\n  --- Panes [${layout.panes.length}] ---`);
    for (const pane of layout.panes) {
      const vis = pane.visible ? "visible" : "HIDDEN";
      const matStr = pane.materialIndex >= 0 ? `mat=${pane.materialIndex}` : "";
      const sizeStr = `${pane.size.w.toFixed(1)}x${pane.size.h.toFixed(1)}`;
      const posStr = `(${pane.translate.x.toFixed(1)}, ${pane.translate.y.toFixed(1)}, ${pane.translate.z.toFixed(1)})`;
      const scaleStr = `scale(${pane.scale.x.toFixed(2)}, ${pane.scale.y.toFixed(2)})`;
      const parentStr = pane.parent ? `parent=${pane.parent}` : "ROOT";

      console.log(`    [${pane.type}] ${pane.name}  ${vis}  alpha=${pane.alpha}  ${sizeStr}  ${posStr}  ${scaleStr}  origin=${pane.origin}  ${matStr}  ${parentStr}`);

      if (pane.vertexColors) {
        const vc = pane.vertexColors;
        console.log(`      vertexColors: TL=(${vc[0].r},${vc[0].g},${vc[0].b},${vc[0].a}) TR=(${vc[1].r},${vc[1].g},${vc[1].b},${vc[1].a}) BL=(${vc[2].r},${vc[2].g},${vc[2].b},${vc[2].a}) BR=(${vc[3].r},${vc[3].g},${vc[3].b},${vc[3].a})`);
      }
      if (pane.texCoords && pane.texCoords.length > 0) {
        for (let ti = 0; ti < pane.texCoords.length; ti++) {
          const tc = pane.texCoords[ti];
          console.log(`      texCoord[${ti}]: TL(${tc.tl.s.toFixed(3)},${tc.tl.t.toFixed(3)}) TR(${tc.tr.s.toFixed(3)},${tc.tr.t.toFixed(3)}) BL(${tc.bl.s.toFixed(3)},${tc.bl.t.toFixed(3)}) BR(${tc.br.s.toFixed(3)},${tc.br.t.toFixed(3)})`);
        }
      }
      if (pane.text !== undefined) {
        console.log(`      text: "${pane.text}"  font=${pane.fontIndex}  textPos=${pane.textPositionFlags}  textAlign=${pane.textAlignment}`);
        console.log(`      textSize: (${pane.textSize.x}, ${pane.textSize.y})  charSpacing=${pane.charSpacing}  lineSpacing=${pane.lineSpacing}`);
        if (pane.textTopColor) console.log(`      textTopColor: (${pane.textTopColor.r},${pane.textTopColor.g},${pane.textTopColor.b},${pane.textTopColor.a})  textBottomColor: (${pane.textBottomColor.r},${pane.textBottomColor.g},${pane.textBottomColor.b},${pane.textBottomColor.a})`);
      }
      if (pane.windowFrames && pane.windowFrames.length > 0) {
        console.log(`      windowFrames: ${JSON.stringify(pane.windowFrames)}`);
      }
    }

    // 7e. Materials
    console.log(`\n  --- Materials [${layout.materials.length}] ---`);
    for (const mat of layout.materials) {
      console.log(`\n    [${mat.index}] "${mat.name}"  flags=0x${mat.flags.toString(16)}`);
      console.log(`      color1 (C0): [${mat.color1.join(", ")}]`);
      console.log(`      color2 (C1): [${mat.color2.join(", ")}]`);
      console.log(`      color3 (C2): [${mat.color3.join(", ")}]`);

      if (mat.tevColors.length > 0) {
        for (let ki = 0; ki < mat.tevColors.length; ki++) {
          const k = mat.tevColors[ki];
          console.log(`      tevColor/kColor[${ki}]: (${k.r}, ${k.g}, ${k.b}, ${k.a})`);
        }
      }

      if (mat.materialColor) {
        const mc = mat.materialColor;
        console.log(`      materialColor: (${mc.r}, ${mc.g}, ${mc.b}, ${mc.a})`);
      }

      if (mat.textureMaps.length > 0) {
        for (let ti = 0; ti < mat.textureMaps.length; ti++) {
          const tm = mat.textureMaps[ti];
          const texName = tm.textureIndex < layout.textures.length ? layout.textures[tm.textureIndex] : `idx=${tm.textureIndex}`;
          console.log(`      texMap[${ti}]: ${texName} (texIdx=${tm.textureIndex}, wrapS=${tm.wrapS}, wrapT=${tm.wrapT})`);
        }
      }

      if (mat.textureSRTs && mat.textureSRTs.length > 0) {
        for (let si = 0; si < mat.textureSRTs.length; si++) {
          const srt = mat.textureSRTs[si];
          console.log(`      texSRT[${si}]: trans=(${srt.xTrans.toFixed(3)},${srt.yTrans.toFixed(3)}) rot=${srt.rotation.toFixed(3)} scale=(${srt.xScale.toFixed(3)},${srt.yScale.toFixed(3)})`);
        }
      }

      if (mat.texCoordGens && mat.texCoordGens.length > 0) {
        for (let gi = 0; gi < mat.texCoordGens.length; gi++) {
          const g = mat.texCoordGens[gi];
          console.log(`      texCoordGen[${gi}]: type=${g.texGenType} src=${g.texGenSrc} mtx=${g.mtxSrc}`);
        }
      }

      if (mat.channelControl) {
        console.log(`      channelControl: colorSrc=${mat.channelControl.colorSource} alphaSrc=${mat.channelControl.alphaSource}`);
      }

      if (mat.tevSwapTable) {
        for (let si = 0; si < mat.tevSwapTable.length; si++) {
          const sw = mat.tevSwapTable[si];
          console.log(`      tevSwap[${si}]: R=${sw.r} G=${sw.g} B=${sw.b} A=${sw.a}`);
        }
      }

      if (mat.indTexMatrices && mat.indTexMatrices.length > 0) {
        for (let im = 0; im < mat.indTexMatrices.length; im++) {
          const itm = mat.indTexMatrices[im];
          console.log(`      indTexMatrix[${im}]: trans=(${itm.xTrans.toFixed(3)},${itm.yTrans.toFixed(3)}) rot=${itm.rotation.toFixed(3)} scale=(${itm.xScale.toFixed(3)},${itm.yScale.toFixed(3)})`);
        }
      }

      if (mat.indTexStages && mat.indTexStages.length > 0) {
        for (let is_ = 0; is_ < mat.indTexStages.length; is_++) {
          const its = mat.indTexStages[is_];
          console.log(`      indTexStage[${is_}]: texMap=${its.texMap} texCoord=${its.texCoord} scaleS=${its.scaleS} scaleT=${its.scaleT}`);
        }
      }

      if (mat.tevStages.length > 0) {
        console.log(`      TEV stages (${mat.tevStages.length}):`);
        for (let ti = 0; ti < mat.tevStages.length; ti++) {
          const s = mat.tevStages[ti];
          console.log(`        stage ${ti}:`);
          console.log(`          order: texCoord=${s.texCoord} colorChan=${s.colorChan} texMap=${s.texMap} rasSel=${s.rasSel} texSel=${s.texSel}`);
          console.log(`          color: a=${s.aC} b=${s.bC} c=${s.cC} d=${s.dC}  op=${s.tevOpC} bias=${s.tevBiasC} scale=${s.tevScaleC} clamp=${s.clampC} regId=${s.tevRegIdC} kColorSel=${s.kColorSelC}`);
          console.log(`          alpha: a=${s.aA} b=${s.bA} c=${s.cA} d=${s.dA}  op=${s.tevOpA} bias=${s.tevBiasA} scale=${s.tevScaleA} clamp=${s.clampA} regId=${s.tevRegIdA} kAlphaSel=${s.kAlphaSelA}`);
          console.log(`          indirect: texId=${s.indTexId} bias=${s.indBias} mtxId=${s.indMtxId} wrapS=${s.indWrapS} wrapT=${s.indWrapT} fmt=${s.indFormat} addPrev=${s.indAddPrev} utcLod=${s.indUtcLod} alpha=${s.indAlpha}`);
        }
      }

      if (mat.alphaCompare) {
        const ac = mat.alphaCompare;
        console.log(`      alphaCompare: cond0=${ac.condition0} cond1=${ac.condition1} op=${ac.operation} val0=${ac.value0} val1=${ac.value1}`);
      }

      if (mat.blendMode) {
        const bm = mat.blendMode;
        console.log(`      blendMode: func=${bm.func} srcFactor=${bm.srcFactor} dstFactor=${bm.dstFactor} logicOp=${bm.logicOp}`);
      }
    }

    // 7f. Groups
    if (layout.groups.length > 0) {
      console.log(`\n  --- Groups [${layout.groups.length}] ---`);
      for (const grp of layout.groups) {
        console.log(`    ${grp.name}: [${grp.paneNames.join(", ")}]`);
      }
    }
  }

  // ---------- BRLANs ----------
  hr("8. Parsing icon BRLANs");
  const brlanEntries = Object.entries(iconFiles).filter(([p]) => p.toLowerCase().endsWith(".brlan"));
  if (brlanEntries.length === 0) {
    console.log("  No .brlan files found in icon archive.");
  } else {
    for (const [brlanPath, brlanData] of brlanEntries) {
      console.log(`\n  --- ${brlanPath} (${brlanData.byteLength} bytes) ---`);
      const anim = parseBRLAN(brlanData, quietLogger);
      console.log(`    frameSize: ${anim.frameSize}`);
      console.log(`    flags: ${anim.flags}`);

      if (anim.timgNames && anim.timgNames.length > 0) {
        console.log(`    timg names [${anim.timgNames.length}]:`);
        anim.timgNames.forEach((n, i) => console.log(`      [${i}] ${n}`));
      }

      console.log(`    pane entries [${anim.panes.length}]:`);
      for (const paneAnim of anim.panes) {
        console.log(`\n      pane: "${paneAnim.name}"`);
        for (const tag of paneAnim.tags) {
          console.log(`        tag: ${tag.type} (${tag.entries.length} entries)`);
          for (const entry of tag.entries) {
            const kfSummary = entry.keyframes.length <= 8
              ? entry.keyframes.map((kf) => `f${kf.frame}=${typeof kf.value === "number" && kf.value % 1 !== 0 ? kf.value.toFixed(2) : kf.value}`).join(", ")
              : `${entry.keyframes.length} keyframes, f${entry.keyframes[0].frame}-f${entry.keyframes[entry.keyframes.length - 1].frame}`;
            console.log(`          [grp=${entry.targetGroup}] ${entry.typeName} (type=0x${entry.type.toString(16)}, ${entry.interpolation}): ${kfSummary}`);
          }
        }
      }
    }
  }

  // ---------- TPLs ----------
  hr("9. TPL images in icon archive");
  const tplEntries = Object.entries(iconFiles).filter(([p]) => p.toLowerCase().endsWith(".tpl"));
  if (tplEntries.length === 0) {
    console.log("  No .tpl files found in icon archive.");
  } else {
    for (const [tplPath, tplData] of tplEntries) {
      console.log(`\n  --- ${tplPath} (${tplData.byteLength} bytes) ---`);
      try {
        const images = parseTPL(tplData, quietLogger);
        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          const fmtName = TPL_FORMATS[img.format] ?? `unknown(${img.format})`;
          console.log(`    image[${i}]: ${img.width}x${img.height}  format=${img.format} (${fmtName})`);
        }
      } catch (e) {
        console.log(`    FAILED to parse: ${e.message}`);
      }
    }
  }

  hr("Done");
  await server.close();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
