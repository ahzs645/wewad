/**
 * Comprehensive diagnostic script for Wii Shop Channel BANNER.
 * Uses Vite SSR to resolve bare imports.
 *
 * Usage: node debug_shop_banner_full.mjs
 */

import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { createServer } from "vite";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.crypto.subtle && webcrypto.subtle) globalThis.crypto.subtle = webcrypto.subtle;

function toArrayBuffer(nodeBuffer) {
  const ab = new ArrayBuffer(nodeBuffer.byteLength);
  new Uint8Array(ab).set(new Uint8Array(nodeBuffer.buffer, nodeBuffer.byteOffset, nodeBuffer.byteLength));
  return ab;
}

function hr(title) {
  console.log("\n" + "=".repeat(72));
  console.log("  " + title);
  console.log("=".repeat(72));
}

async function main() {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });

  const { processWAD } = await server.ssrLoadModule("/packages/wii-channel-renderer/src/wadRenderer/pipeline/process.js");

  const WAD_PATH = "/Users/ahmadjalil/github/wewad/New Folder With Items/Wii Shop Channel (World) (v20) (Channel).wad";
  const rawBuffer = readFileSync(WAD_PATH);
  const arrayBuffer = toArrayBuffer(rawBuffer);

  const logger = {
    info: () => {},
    warn: (msg) => console.error("WARN:", msg),
    success: () => {},
    error: (msg) => console.error("ERR:", msg),
  };

  const result = await processWAD(arrayBuffer, logger);
  const banner = result.results?.banner;
  if (!banner) {
    console.log("No banner found");
    await server.close();
    process.exit(1);
  }

  const layout = banner.renderLayout;

  // ========================
  // 1. PANE TREE
  // ========================
  hr("1. PANE TREE");
  console.log(`Layout size: ${layout.width}x${layout.height}`);
  console.log(`Total panes: ${layout.panes.length}`);
  console.log(`Total materials: ${layout.materials.length}`);
  console.log(`Total textures: ${layout.textures.length}`);

  for (const pane of layout.panes) {
    const rot = pane.rotate || {};
    const trans = pane.translate || {};
    const scale = pane.scale || {};
    const size = pane.size || {};
    const vc = pane.vertexColors;
    const flags = pane.flags ?? 0;
    const propagatesAlpha = (flags & 0x02) !== 0;
    const parentStr = pane.parent ? `"${pane.parent}"` : "ROOT";

    console.log(`\n  ${pane.type} "${pane.name}" parent=${parentStr}`);
    console.log(`    visible=${pane.visible !== false} flags=0x${flags.toString(16)} propagatesAlpha=${propagatesAlpha} alpha=${pane.alpha}`);
    console.log(`    size=${size.w}x${size.h} trans=(${trans.x?.toFixed(1)},${trans.y?.toFixed(1)},${trans.z?.toFixed(1)}) rot=(${rot.x?.toFixed(1)},${rot.y?.toFixed(1)},${rot.z?.toFixed(1)}) scale=(${scale.x?.toFixed(3)},${scale.y?.toFixed(3)})`);
    console.log(`    origin=${pane.origin}`);

    if (vc && vc.length >= 4) {
      console.log(`    vertexColors: TL=(${vc[0].r},${vc[0].g},${vc[0].b},${vc[0].a}) TR=(${vc[1].r},${vc[1].g},${vc[1].b},${vc[1].a}) BL=(${vc[2].r},${vc[2].g},${vc[2].b},${vc[2].a}) BR=(${vc[3].r},${vc[3].g},${vc[3].b},${vc[3].a})`);
    }

    if (pane.materialIndex != null && pane.materialIndex >= 0 && layout.materials?.[pane.materialIndex]) {
      const mat = layout.materials[pane.materialIndex];
      // Use whichever field name the renderLayout uses
      const texMaps = mat.texMaps ?? mat.textureMaps ?? [];
      const texNames = texMaps.map(t => {
        const idx = t.texIndex ?? t.textureIndex ?? -1;
        return `${idx}:${layout.textures[idx] ?? "?"}`;
      });
      console.log(`    material[${pane.materialIndex}]="${mat.name}" texMaps=[${texNames.join(", ")}]`);
    }

    if (pane.text !== undefined) {
      console.log(`    text="${pane.text}" font=${pane.fontIndex} textPos=${pane.textPositionFlags} textAlign=${pane.textAlignment}`);
    }
  }

  // ========================
  // 2. MATERIALS
  // ========================
  hr("2. MATERIALS");
  for (let i = 0; i < layout.materials.length; i++) {
    const m = layout.materials[i];
    const texMaps = m.texMaps ?? m.textureMaps ?? [];
    const texNames = texMaps.map(t => {
      const idx = t.texIndex ?? t.textureIndex ?? -1;
      return `${idx}:${layout.textures[idx] ?? "?"}`;
    });
    console.log(`\n  [${i}] "${m.name}" flags=0x${(m.flags ?? 0).toString(16)}`);
    console.log(`    texMaps: [${texNames.join(", ")}]`);

    if (m.textureSRTs?.length) {
      for (let s = 0; s < m.textureSRTs.length; s++) {
        const srt = m.textureSRTs[s];
        console.log(`    texSRT[${s}]: trans=(${srt.xTrans?.toFixed(3)},${srt.yTrans?.toFixed(3)}) rot=${srt.rotation?.toFixed(3)} scale=(${srt.xScale?.toFixed(3)},${srt.yScale?.toFixed(3)})`);
      }
    }

    if (m.texCoordGens?.length) {
      for (let g = 0; g < m.texCoordGens.length; g++) {
        const gen = m.texCoordGens[g];
        console.log(`    texCoordGen[${g}]: type=${gen.texGenType} src=${gen.texGenSrc} mtx=${gen.mtxSrc}`);
      }
    }

    if (m.channelControl) {
      console.log(`    channelControl: colorSrc=${m.channelControl.colorSource} alphaSrc=${m.channelControl.alphaSource}`);
    }

    // TEV registers
    if (m.color1) console.log(`    color1(C0): ${JSON.stringify(m.color1)}`);
    if (m.color2) console.log(`    color2(C1): ${JSON.stringify(m.color2)}`);
    if (m.color3) console.log(`    color3(C2): ${JSON.stringify(m.color3)}`);
    if (m.materialColor) console.log(`    materialColor: ${JSON.stringify(m.materialColor)}`);

    const tevColors = m.tevColors ?? [];
    for (let k = 0; k < tevColors.length; k++) {
      const c = tevColors[k];
      console.log(`    kColor[${k}]: (${c.r},${c.g},${c.b},${c.a})`);
    }

    // TEV swap table
    if (m.tevSwapTable?.length) {
      for (let s = 0; s < m.tevSwapTable.length; s++) {
        const sw = m.tevSwapTable[s];
        console.log(`    tevSwap[${s}]: R=${sw.r} G=${sw.g} B=${sw.b} A=${sw.a}`);
      }
    }

    // Indirect tex
    if (m.indTexMatrices?.length) {
      for (let im = 0; im < m.indTexMatrices.length; im++) {
        const itm = m.indTexMatrices[im];
        console.log(`    indTexMatrix[${im}]: trans=(${itm.xTrans?.toFixed(3)},${itm.yTrans?.toFixed(3)}) rot=${itm.rotation?.toFixed(3)} scale=(${itm.xScale?.toFixed(3)},${itm.yScale?.toFixed(3)})`);
      }
    }
    if (m.indTexStages?.length) {
      for (let is_ = 0; is_ < m.indTexStages.length; is_++) {
        const its = m.indTexStages[is_];
        console.log(`    indTexStage[${is_}]: texMap=${its.texMap} texCoord=${its.texCoord} scaleS=${its.scaleS} scaleT=${its.scaleT}`);
      }
    }

    // TEV stages
    const tevStages = m.tevStages ?? [];
    console.log(`    tevStages: ${tevStages.length}`);
    for (let s = 0; s < tevStages.length; s++) {
      const ts = tevStages[s];
      // Support both field naming conventions (renderLayout may use different names)
      const texCoord = ts.texCoord ?? ts.texCoordId;
      const colorChan = ts.colorChan ?? ts.colorChanId;
      const texMap = ts.texMap ?? ts.texMapId;
      const rasSel = ts.rasSel;
      const texSel = ts.texSel;

      // Color combiner - try both naming conventions
      const aC = ts.colorA ?? ts.aC;
      const bC = ts.colorB ?? ts.bC;
      const cC = ts.colorC ?? ts.cC;
      const dC = ts.colorD ?? ts.dC;
      const opC = ts.colorOp ?? ts.tevOpC;
      const biasC = ts.colorBias ?? ts.tevBiasC;
      const scaleC = ts.colorScale ?? ts.tevScaleC;
      const clampC = ts.clampC;
      const regIdC = ts.colorRegId ?? ts.tevRegIdC;
      const kSelC = ts.kColorSel ?? ts.kColorSelC;

      // Alpha combiner
      const aA = ts.alphaA ?? ts.aA;
      const bA = ts.alphaB ?? ts.bA;
      const cA = ts.alphaC ?? ts.cA;
      const dA = ts.alphaD ?? ts.dA;
      const opA = ts.alphaOp ?? ts.tevOpA;
      const biasA = ts.alphaBias ?? ts.tevBiasA;
      const scaleA = ts.alphaScale ?? ts.tevScaleA;
      const clampA = ts.clampA;
      const regIdA = ts.alphaRegId ?? ts.tevRegIdA;
      const kSelA = ts.kAlphaSel ?? ts.kAlphaSelA;

      console.log(`    stage[${s}]: texCoord=${texCoord} colorChan=${colorChan} texMap=${texMap} rasSel=${rasSel} texSel=${texSel}`);
      console.log(`      color: A=${aC} B=${bC} C=${cC} D=${dC} op=${opC} bias=${biasC} scale=${scaleC} clamp=${clampC} regId=${regIdC} kSel=${kSelC}`);
      console.log(`      alpha: A=${aA} B=${bA} C=${cA} D=${dA} op=${opA} bias=${biasA} scale=${scaleA} clamp=${clampA} regId=${regIdA} kSel=${kSelA}`);
      if (ts.indTexId !== undefined) {
        console.log(`      indirect: texId=${ts.indTexId} bias=${ts.indBias} mtxId=${ts.indMtxId} wrapS=${ts.indWrapS} wrapT=${ts.indWrapT} fmt=${ts.indFormat} addPrev=${ts.indAddPrev}`);
      }
    }

    if (m.alphaCompare) {
      const ac = m.alphaCompare;
      console.log(`    alphaCompare: cond0=${ac.condition0} cond1=${ac.condition1} op=${ac.operation} val0=${ac.value0} val1=${ac.value1}`);
    }

    if (m.blendMode) {
      const bm = m.blendMode;
      console.log(`    blendMode: func=${bm.func} srcFactor=${bm.srcFactor} dstFactor=${bm.dstFactor} logicOp=${bm.logicOp}`);
    }
  }

  // ========================
  // 3. TEXTURES
  // ========================
  hr("3. TEXTURES");
  for (let i = 0; i < layout.textures.length; i++) {
    console.log(`  [${i}] ${layout.textures[i]}`);
  }

  // ========================
  // 4. ANIMATION OVERVIEW
  // ========================
  hr("4. ANIMATION OVERVIEW");

  function describeAnim(label, anim) {
    if (!anim) { console.log(`  ${label}: null`); return; }
    const panes = anim.panes ?? [];
    const tagCounts = {};
    for (const p of panes) for (const t of p.tags ?? []) tagCounts[t.type] = (tagCounts[t.type] ?? 0) + 1;
    const summary = Object.entries(tagCounts).map(([t, c]) => `${t}:${c}`).join(", ");
    console.log(`  ${label}: frameSize=${anim.frameSize} flags=${anim.flags} panes=${panes.length} timgNames=[${(anim.timgNames ?? []).join(", ")}]`);
    if (summary) console.log(`    tagCounts: {${summary}}`);
  }

  describeAnim("anim", banner.anim);
  describeAnim("animStart", banner.animStart);
  describeAnim("animLoop", banner.animLoop);

  if (banner.animEntries?.length) {
    console.log(`  animEntries: ${banner.animEntries.length} entries`);
    for (const e of banner.animEntries) {
      const a = e.anim ?? e;
      describeAnim(`  entry[${e.name ?? e.filename ?? "?"}]`, a);
    }
  }

  // Collect all animation sources
  const allAnimSources = [];
  if (banner.anim?.panes?.length) allAnimSources.push({ label: "anim", anim: banner.anim });
  if (banner.animStart?.panes?.length) allAnimSources.push({ label: "animStart", anim: banner.animStart });
  if (banner.animLoop?.panes?.length) allAnimSources.push({ label: "animLoop", anim: banner.animLoop });
  for (const e of banner.animEntries ?? []) {
    const a = e.anim ?? e;
    if (a?.panes?.length) allAnimSources.push({ label: `entry:${e.name ?? e.filename ?? "?"}`, anim: a });
  }

  // ========================
  // 5. ALL ANIMATION TAGS PER PANE
  // ========================
  for (const { label, anim } of allAnimSources) {
    hr(`5. ANIMATION: ${label} (frameSize=${anim.frameSize})`);

    for (const paneAnim of anim.panes) {
      const tagTypes = paneAnim.tags?.map(t => t.type).join(",") ?? "";
      if (!tagTypes) continue;
      console.log(`\n  Pane "${paneAnim.name}" [${tagTypes}]:`);

      for (const tag of paneAnim.tags ?? []) {
        for (const track of tag.entries ?? []) {
          const kf = track.keyframes ?? [];
          const preview = kf.slice(0, 8).map(k =>
            `f${k.frame}=${typeof k.value === "number" ? (k.value % 1 !== 0 ? k.value.toFixed(3) : k.value) : k.value}`
          ).join(", ");
          const overflow = kf.length > 8 ? ` ...+${kf.length - 8} more` : "";
          console.log(`    ${tag.type} grp=${track.targetGroup} type=${track.type}(${track.typeName}) interp=${track.interpolation} [${kf.length}kf]: ${preview}${overflow}`);
        }
      }
    }
  }

  // ========================
  // 6. RLTS: panes with both rotation AND translation
  // ========================
  hr("6. RLTS: Panes with simultaneous Rotation AND Translation");
  let foundRlts = false;
  for (const { label, anim } of allAnimSources) {
    for (const paneAnim of anim.panes) {
      const rltsTag = paneAnim.tags?.find(t => t.type === "RLTS");
      if (!rltsTag) continue;

      // RLTS animType: 1=transX, 2=transY, 3=transZ, 4=rotX, 5=rotY, 6=rotZ, 7=scaleX, 8=scaleY
      const hasRot = rltsTag.entries.some(e => e.type >= 4 && e.type <= 6);
      const hasTrans = rltsTag.entries.some(e => e.type >= 1 && e.type <= 3);

      if (hasRot && hasTrans) {
        foundRlts = true;
        console.log(`  ${label}: "${paneAnim.name}" has both rotation and translation`);
        for (const track of rltsTag.entries) {
          const kf = track.keyframes ?? [];
          const preview = kf.slice(0, 6).map(k => `f${k.frame}=${k.value.toFixed(3)}`).join(", ");
          const overflow = kf.length > 6 ? ` ...+${kf.length - 6} more` : "";
          console.log(`    type=${track.type}(${track.typeName}) [${kf.length}kf]: ${preview}${overflow}`);
        }
      }
    }
  }
  if (!foundRlts) console.log("  (none found)");

  // ========================
  // 7. RLTP: texture pattern
  // ========================
  hr("7. RLTP: Texture Pattern Animations");
  let foundRltp = false;
  for (const { label, anim } of allAnimSources) {
    const timgNames = anim.timgNames ?? [];
    for (const paneAnim of anim.panes) {
      const rltpTag = paneAnim.tags?.find(t => t.type === "RLTP");
      if (!rltpTag) continue;
      foundRltp = true;
      console.log(`  ${label}: "${paneAnim.name}" timgNames=[${timgNames.join(", ")}]`);
      for (const track of rltpTag.entries) {
        const kf = track.keyframes ?? [];
        const preview = kf.slice(0, 12).map(k =>
          `f${k.frame}→timgIdx=${k.value}(${timgNames[k.value] ?? "?"})`
        ).join(", ");
        const overflow = kf.length > 12 ? ` ...+${kf.length - 12} more` : "";
        console.log(`    grp=${track.targetGroup} [${kf.length}kf]: ${preview}${overflow}`);
      }
    }
  }
  if (!foundRltp) console.log("  (none found)");

  // ========================
  // 8. RLMC: material color
  // ========================
  hr("8. RLMC: Material Color Animations");
  let foundRlmc = false;
  for (const { label, anim } of allAnimSources) {
    for (const paneAnim of anim.panes) {
      const rlmcTag = paneAnim.tags?.find(t => t.type === "RLMC");
      if (!rlmcTag) continue;
      foundRlmc = true;
      console.log(`  ${label}: "${paneAnim.name}"`);
      for (const track of rlmcTag.entries) {
        const kf = track.keyframes ?? [];
        const preview = kf.slice(0, 6).map(k => `f${k.frame}=${k.value.toFixed(2)}`).join(", ");
        const overflow = kf.length > 6 ? ` ...+${kf.length - 6} more` : "";
        console.log(`    grp=${track.targetGroup} type=0x${track.type.toString(16)}(${track.typeName}) interp=${track.interpolation} [${kf.length}kf]: ${preview}${overflow}`);
      }
    }
  }
  if (!foundRlmc) console.log("  (none found)");

  // ========================
  // 9. RLVC: vertex color
  // ========================
  hr("9. RLVC: Vertex Color Animations");
  let foundRlvc = false;
  for (const { label, anim } of allAnimSources) {
    for (const paneAnim of anim.panes) {
      const rlvcTag = paneAnim.tags?.find(t => t.type === "RLVC");
      if (!rlvcTag) continue;
      foundRlvc = true;
      console.log(`  ${label}: "${paneAnim.name}"`);
      for (const track of rlvcTag.entries) {
        const kf = track.keyframes ?? [];
        const preview = kf.slice(0, 6).map(k => `f${k.frame}=${k.value.toFixed(2)}`).join(", ");
        const overflow = kf.length > 6 ? ` ...+${kf.length - 6} more` : "";
        console.log(`    grp=${track.targetGroup} type=0x${track.type.toString(16)}(${track.typeName}) interp=${track.interpolation} [${kf.length}kf]: ${preview}${overflow}`);
      }
    }
  }
  if (!foundRlvc) console.log("  (none found)");

  // ========================
  // 10. RLPA: pane attributes
  // ========================
  hr("10. RLPA: Pane Attribute Animations");
  let foundRlpa = false;
  for (const { label, anim } of allAnimSources) {
    for (const paneAnim of anim.panes) {
      const rlpaTag = paneAnim.tags?.find(t => t.type === "RLPA");
      if (!rlpaTag) continue;
      foundRlpa = true;
      console.log(`  ${label}: "${paneAnim.name}"`);
      for (const track of rlpaTag.entries) {
        const kf = track.keyframes ?? [];
        const preview = kf.slice(0, 6).map(k => `f${k.frame}=${k.value.toFixed(3)}`).join(", ");
        const overflow = kf.length > 6 ? ` ...+${kf.length - 6} more` : "";
        console.log(`    grp=${track.targetGroup} type=0x${track.type.toString(16)}(${track.typeName}) interp=${track.interpolation} [${kf.length}kf]: ${preview}${overflow}`);
      }
    }
  }
  if (!foundRlpa) console.log("  (none found)");

  // ========================
  // 11. RLVI: visibility
  // ========================
  hr("11. RLVI: Visibility Animations");
  let foundRlvi = false;
  for (const { label, anim } of allAnimSources) {
    for (const paneAnim of anim.panes) {
      const rlviTag = paneAnim.tags?.find(t => t.type === "RLVI");
      if (!rlviTag) continue;
      foundRlvi = true;
      console.log(`  ${label}: "${paneAnim.name}"`);
      for (const track of rlviTag.entries) {
        const kf = track.keyframes ?? [];
        const preview = kf.slice(0, 12).map(k => `f${k.frame}=${k.value}`).join(", ");
        const overflow = kf.length > 12 ? ` ...+${kf.length - 12} more` : "";
        console.log(`    grp=${track.targetGroup} [${kf.length}kf]: ${preview}${overflow}`);
      }
    }
  }
  if (!foundRlvi) console.log("  (none found)");

  hr("DONE");
  await server.close();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
