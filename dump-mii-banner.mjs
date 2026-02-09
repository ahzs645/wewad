/**
 * Dump the Mii Channel WAD banner layout structure.
 *
 * Usage:  node --loader ./loader.mjs dump-mii-banner.mjs
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = "/Users/ahmadjalil/github/wewad";

const { parseWAD } = await import(resolve(ROOT, "src/lib/wadRenderer/parsers/wad.js"));
const { parseU8 } = await import(resolve(ROOT, "src/lib/wadRenderer/parsers/u8.js"));
const { parseBRLYT } = await import(resolve(ROOT, "src/lib/wadRenderer/parsers/brlyt.js"));
const { parseTPL } = await import(resolve(ROOT, "src/lib/wadRenderer/parsers/tpl.js"));
const { parseBRLAN } = await import(resolve(ROOT, "src/lib/wadRenderer/parsers/brlan.js"));
const { TPL_FORMATS } = await import(resolve(ROOT, "src/lib/wadRenderer/parsers/constants.js"));
const { decryptWadContents } = await import(resolve(ROOT, "src/lib/wadRenderer/pipeline/decryption.js"));

// ---------------------------------------------------------------------------
// Loggers
// ---------------------------------------------------------------------------
const logger = {
  info: (...args) => console.log("[INFO]", ...args),
  warn: (...args) => console.warn("[WARN]", ...args),
  error: (...args) => console.error("[ERR]", ...args),
  success: (...args) => console.log("[OK]", ...args),
  clear: () => {},
};

const quietLogger = {
  info: () => {},
  warn: (...args) => console.warn("[WARN]", ...args),
  error: (...args) => console.error("[ERR]", ...args),
  success: () => {},
  clear: () => {},
};

// ---------------------------------------------------------------------------
// 1. Parse the WAD
// ---------------------------------------------------------------------------
const wadPath = resolve(
  ROOT,
  "New Folder With Items",
  "Mii Channel (World) (v6) (Channel).wad",
);

console.log("=".repeat(80));
console.log("STEP 1: Parse WAD");
console.log("=".repeat(80));
const wadBuffer = readFileSync(wadPath).buffer;
const wad = parseWAD(wadBuffer, logger);
console.log(`Title ID: ${wad.titleId}`);
console.log(`Contents: ${wad.numContents}`);
for (const rec of wad.contentRecords) {
  console.log(`  ${rec.name}  size=${rec.size}  type=${rec.type}  index=${rec.index}`);
}

// ---------------------------------------------------------------------------
// 2. Decrypt contents
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(80));
console.log("STEP 2: Decrypt WAD contents");
console.log("=".repeat(80));

const decryptedContents = await decryptWadContents(wad, logger);
if (!decryptedContents) {
  console.error("Decryption failed!");
  process.exit(1);
}
console.log("Decrypted contents:");
for (const [name, buf] of Object.entries(decryptedContents)) {
  console.log(`  ${name}  (${buf.byteLength} bytes)`);
}

// ---------------------------------------------------------------------------
// 3. Extract banner.bin via U8 archive parsing
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(80));
console.log("STEP 3: Extract banner.bin from U8 archives");
console.log("=".repeat(80));

let bannerBin = null;
let iconBin = null;

for (const [name, contentBuf] of Object.entries(decryptedContents)) {
  console.log(`\nTrying content: ${name} (${contentBuf.byteLength} bytes)`);
  try {
    const u8Files = parseU8(contentBuf, quietLogger);
    const fileNames = Object.keys(u8Files);
    console.log(`  Files in U8 archive: ${fileNames.join(", ")}`);

    for (const [fName, fBuf] of Object.entries(u8Files)) {
      const lower = fName.toLowerCase();
      if (lower.includes("banner") && lower.endsWith(".bin")) {
        bannerBin = fBuf;
        console.log(`  >>> Found banner.bin: ${fName} (${fBuf.byteLength} bytes)`);
      }
      if (lower.includes("icon") && lower.endsWith(".bin")) {
        iconBin = fBuf;
        console.log(`  >>> Found icon.bin: ${fName} (${fBuf.byteLength} bytes)`);
      }
    }
    if (bannerBin) break;
  } catch (err) {
    console.log(`  Not a valid U8 archive: ${err.message}`);
  }
}

if (!bannerBin) {
  console.error("Could not find banner.bin in any content!");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. Parse banner.bin (which is itself a U8 archive)
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(80));
console.log("STEP 4: Parse banner.bin U8 archive");
console.log("=".repeat(80));

const bannerFiles = parseU8(bannerBin, logger);
const bannerFileNames = Object.keys(bannerFiles);
console.log(`\nFiles inside banner.bin:`);
for (const fn of bannerFileNames) {
  console.log(`  ${fn}  (${bannerFiles[fn].byteLength} bytes)`);
}

// ---------------------------------------------------------------------------
// 5. Parse BRLYT layout
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(80));
console.log("STEP 5: Parse BRLYT layout");
console.log("=".repeat(80));

const brlytFile = bannerFileNames.find((n) => n.toLowerCase().endsWith(".brlyt"));
if (!brlytFile) {
  console.error("No .brlyt file found in banner!");
  process.exit(1);
}

console.log(`\nParsing: ${brlytFile}`);
const layout = parseBRLYT(bannerFiles[brlytFile], quietLogger);

// 5a. Texture names
console.log("\n--- Texture References ---");
for (let i = 0; i < layout.textures.length; i++) {
  console.log(`  [${i}] ${layout.textures[i]}`);
}

// 5b. Fonts
if (layout.fonts.length > 0) {
  console.log("\n--- Font References ---");
  for (let i = 0; i < layout.fonts.length; i++) {
    console.log(`  [${i}] ${layout.fonts[i]}`);
  }
}

// 5c. Materials
console.log("\n--- Materials ---");
for (const mat of layout.materials) {
  console.log(`\n  Material [${mat.index}]: "${mat.name}"`);
  console.log(`    textureMaps (${mat.textureMaps.length}):`);
  for (const tm of mat.textureMaps) {
    const texName =
      tm.textureIndex < layout.textures.length
        ? layout.textures[tm.textureIndex]
        : "???";
    console.log(
      `      textureIndex=${tm.textureIndex} (${texName})  wrapS=${tm.wrapS}  wrapT=${tm.wrapT}`,
    );
  }
  console.log(`    color1 (foreColor):  [${mat.color1.join(", ")}]`);
  console.log(`    color2 (backColor):  [${mat.color2.join(", ")}]`);
  console.log(`    color3 (colorReg3):  [${mat.color3.join(", ")}]`);
  console.log(`    tevColors (${mat.tevColors.length}):`);
  for (let i = 0; i < mat.tevColors.length; i++) {
    const c = mat.tevColors[i];
    console.log(`      [${i}] rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`);
  }
  if (mat.materialColor) {
    const mc = mat.materialColor;
    console.log(`    materialColor: rgba(${mc.r}, ${mc.g}, ${mc.b}, ${mc.a})`);
  }
  if (mat.alphaCompare) {
    const ac = mat.alphaCompare;
    console.log(
      `    alphaCompare: cond0=${ac.condition0} cond1=${ac.condition1} op=${ac.operation} val0=${ac.value0} val1=${ac.value1}`,
    );
  }
  if (mat.blendMode) {
    const bm = mat.blendMode;
    console.log(
      `    blendMode: func=${bm.func} src=${bm.srcFactor} dst=${bm.dstFactor} logicOp=${bm.logicOp}`,
    );
  }
  console.log(`    tevStages count: ${mat.tevStages.length}`);
  if (mat.tevStages.length > 0) {
    for (let i = 0; i < mat.tevStages.length; i++) {
      const ts = mat.tevStages[i];
      console.log(
        `      stage[${i}]: texMap=${ts.texMap} texCoord=${ts.texCoord} colorChan=${ts.colorChan}` +
          ` | color(a=${ts.aC},b=${ts.bC},c=${ts.cC},d=${ts.dC}) op=${ts.tevOpC} scale=${ts.tevScaleC} bias=${ts.tevBiasC}` +
          ` | alpha(a=${ts.aA},b=${ts.bA},c=${ts.cA},d=${ts.dA}) op=${ts.tevOpA} scale=${ts.tevScaleA} bias=${ts.tevBiasA}`,
      );
    }
  }
  if (mat.textureSRTs.length > 0) {
    console.log(`    textureSRTs (${mat.textureSRTs.length}):`);
    for (let i = 0; i < mat.textureSRTs.length; i++) {
      const srt = mat.textureSRTs[i];
      console.log(
        `      [${i}] translate=(${srt.xTrans}, ${srt.yTrans}) rot=${srt.rotation} scale=(${srt.xScale}, ${srt.yScale})`,
      );
    }
  }
  if (mat.channelControl) {
    console.log(
      `    channelControl: colorSrc=${mat.channelControl.colorSource} alphaSrc=${mat.channelControl.alphaSource}`,
    );
  }
}

// 5d. Panes
console.log("\n--- Panes ---");
for (const pane of layout.panes) {
  console.log(`\n  [${pane.type}] "${pane.name}"`);
  console.log(`    parent: ${pane.parent ?? "(root)"}`);
  console.log(`    visible: ${pane.visible}  alpha: ${pane.alpha}`);
  console.log(`    size: ${pane.size.w} x ${pane.size.h}`);
  console.log(
    `    translate: (${pane.translate.x}, ${pane.translate.y}, ${pane.translate.z})`,
  );
  console.log(
    `    rotate: (${pane.rotate.x}, ${pane.rotate.y}, ${pane.rotate.z})`,
  );
  console.log(`    scale: (${pane.scale.x}, ${pane.scale.y})`);
  console.log(`    materialIndex: ${pane.materialIndex}`);

  if (pane.type === "pic1" || pane.type === "bnd1" || pane.type === "wnd1") {
    if (pane.vertexColors) {
      console.log(`    vertexColors:`);
      const labels = ["TL", "TR", "BL", "BR"];
      for (let i = 0; i < pane.vertexColors.length; i++) {
        const vc = pane.vertexColors[i];
        console.log(`      ${labels[i]}: rgba(${vc.r}, ${vc.g}, ${vc.b}, ${vc.a})`);
      }
    }
    if (pane.texCoords && pane.texCoords.length > 0) {
      console.log(`    texCoords (${pane.texCoords.length}):`);
      for (let i = 0; i < pane.texCoords.length; i++) {
        const tc = pane.texCoords[i];
        console.log(
          `      [${i}] TL(${tc.tl.s},${tc.tl.t}) TR(${tc.tr.s},${tc.tr.t}) BL(${tc.bl.s},${tc.bl.t}) BR(${tc.br.s},${tc.br.t})`,
        );
      }
    }
  }

  if (pane.type === "txt1") {
    console.log(`    fontIndex: ${pane.fontIndex ?? "?"}`);
    console.log(`    fontName: ${pane.fontName ?? "?"}`);
    console.log(`    text: "${pane.text ?? ""}"`);
    console.log(`    textSize: ${pane.textSize?.x ?? "?"} x ${pane.textSize?.y ?? "?"}`);
    console.log(`    charSpacing: ${pane.charSpacing ?? "?"}`);
    console.log(`    lineSpacing: ${pane.lineSpacing ?? "?"}`);
    if (pane.textTopColor) {
      const c = pane.textTopColor;
      console.log(`    textTopColor: rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`);
    }
    if (pane.textBottomColor) {
      const c = pane.textBottomColor;
      console.log(`    textBottomColor: rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`);
    }
  }
}

// 5e. Groups
if (layout.groups.length > 0) {
  console.log("\n--- Groups ---");
  for (const grp of layout.groups) {
    console.log(`  "${grp.name}": [${grp.paneNames.join(", ")}]`);
  }
}

// ---------------------------------------------------------------------------
// 6. Parse TPL textures
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(80));
console.log("STEP 6: Parse TPL textures");
console.log("=".repeat(80));

const tplFiles = bannerFileNames.filter((n) => n.toLowerCase().endsWith(".tpl"));
for (const tplFile of tplFiles) {
  console.log(`\nParsing: ${tplFile} (${bannerFiles[tplFile].byteLength} bytes)`);
  try {
    const images = parseTPL(bannerFiles[tplFile], logger);
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const formatName = TPL_FORMATS[img.format] ?? `unknown(${img.format})`;
      console.log(
        `  Image [${i}]: ${img.width}x${img.height}  format=${img.format} (${formatName})`,
      );
    }
  } catch (err) {
    console.log(`  Failed to parse TPL: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 7. Parse BRLAN animations
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(80));
console.log("STEP 7: Parse BRLAN animations");
console.log("=".repeat(80));

const brlanFiles = bannerFileNames.filter((n) => n.toLowerCase().endsWith(".brlan"));
for (const brlanFile of brlanFiles) {
  console.log(`\nParsing: ${brlanFile} (${bannerFiles[brlanFile].byteLength} bytes)`);
  try {
    const anim = parseBRLAN(bannerFiles[brlanFile], quietLogger);
    console.log(
      `  frameSize: ${anim.frameSize}  flags: ${anim.flags}  panes: ${anim.panes.length}`,
    );
    for (const pane of anim.panes) {
      console.log(`  Pane "${pane.name}" (${pane.tags.length} tag(s)):`);
      for (const tag of pane.tags) {
        console.log(`    Tag "${tag.type}" (${tag.entries.length} entries):`);
        for (const entry of tag.entries) {
          const kfSummary =
            entry.keyframes.length <= 4
              ? entry.keyframes
                  .map(
                    (kf) =>
                      `f${kf.frame}=${typeof kf.value === "number" ? kf.value.toFixed(2) : kf.value}`,
                  )
                  .join(" ")
              : `${entry.keyframes.length} keyframes, range [${entry.keyframes[0].frame}-${entry.keyframes[entry.keyframes.length - 1].frame}]`;
          console.log(
            `      ${entry.typeName} (grp=${entry.targetGroup}, ${entry.interpolation}): ${kfSummary}`,
          );
        }
      }
    }
  } catch (err) {
    console.log(`  Failed to parse BRLAN: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 8. Also parse icon.bin if found
// ---------------------------------------------------------------------------
if (iconBin) {
  console.log("\n" + "=".repeat(80));
  console.log("BONUS: Parse icon.bin");
  console.log("=".repeat(80));

  try {
    const iconFiles = parseU8(iconBin, quietLogger);
    console.log("Files inside icon.bin:");
    for (const fn of Object.keys(iconFiles)) {
      console.log(`  ${fn}  (${iconFiles[fn].byteLength} bytes)`);
    }

    const iconBrlyt = Object.keys(iconFiles).find((n) =>
      n.toLowerCase().endsWith(".brlyt"),
    );
    if (iconBrlyt) {
      const iconLayout = parseBRLYT(iconFiles[iconBrlyt], quietLogger);
      console.log(`\nIcon layout: ${iconLayout.width}x${iconLayout.height}`);
      console.log(`  Textures: ${iconLayout.textures.join(", ")}`);
      console.log(`  Materials: ${iconLayout.materials.length}`);
      console.log(`  Panes: ${iconLayout.panes.length}`);
    }
  } catch (err) {
    console.log(`  Failed to parse icon.bin: ${err.message}`);
  }
}

console.log("\n" + "=".repeat(80));
console.log("Done.");
console.log("=".repeat(80));
