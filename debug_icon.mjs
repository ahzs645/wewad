#!/usr/bin/env node
// Diagnostic: use full pipeline via Vite SSR to parse Wii Shop icon
import { createServer } from "vite";
import { readFileSync } from "fs";
import { webcrypto } from "crypto";

// Polyfill crypto for Node.js
if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.crypto.subtle && webcrypto.subtle) globalThis.crypto.subtle = webcrypto.subtle;

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { processWAD } = await server.ssrLoadModule("/src/lib/wadRenderer/pipeline/process.js");
const { parseBRLAN } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/brlan.js");

const wadBuffer = readFileSync("New Folder With Items/Wii Shop Channel (World) (v20) (Channel).wad");
const ab = wadBuffer.buffer.slice(wadBuffer.byteOffset, wadBuffer.byteOffset + wadBuffer.byteLength);

console.log("Processing WAD...");
const result = await processWAD(ab, { info: () => {}, warn: console.warn, success: () => {} });

const icon = result.results?.icon;
if (!icon) { console.error("No icon found"); await server.close(); process.exit(1); }

const layout = icon.layout;
console.log(`\n=== ICON LAYOUT ${layout.width}x${layout.height} ===`);
console.log(`Textures: ${layout.textures?.join(", ")}`);

// Build pane tree
const byName = new Map();
for (const p of layout.panes) byName.set(p.name, p);

function depth(p) { let d=0, c=p; const s=new Set(); while(c?.parent&&!s.has(c.parent)){s.add(c.parent);c=byName.get(c.parent);d++;} return d; }

console.log("\n=== PANE TREE ===");
for (const p of layout.panes) {
  const d = depth(p);
  const indent = "  ".repeat(d);
  const vis = p.visible === false ? " [HIDDEN]" : "";
  const alpha = p.alpha != null ? ` a=${p.alpha}` : "";
  const fl = ` fl=0x${(p.flags??0).toString(16)}`;
  const propA = (p.flags&0x02)||["pic1","txt1","bnd1","wnd1"].includes(p.type) ? " propA" : "";
  const mi = p.materialIndex != null ? ` mat=${p.materialIndex}` : "";
  const sz = p.size ? ` ${p.size.w}x${p.size.h}` : "";
  const tr = p.translate ? ` @(${p.translate.x.toFixed(1)},${p.translate.y.toFixed(1)})` : "";
  const ori = p.origin != null ? ` ori=${p.origin}` : "";
  console.log(`${indent}${p.type} ${p.name} (p=${p.parent??"ROOT"})${vis}${alpha}${fl}${propA}${ori}${mi}${sz}${tr}`);
}

// Groups
console.log("\n=== GROUPS ===");
for (const g of layout.groups ?? []) {
  console.log(`${g.name}: [${g.paneNames?.join(", ")}]`);
}

// Key pane materials
const keyPanes = ["bg_wiiplane_00", "P_ShopLogo_00", "P_ShopLogo_01", "P_title_E_00", "P_title_J_00", "N_LogoTitles", "N_SuperParent"];
console.log("\n=== KEY MATERIALS ===");
for (const name of keyPanes) {
  const p = byName.get(name);
  if (!p || p.materialIndex == null) { console.log(`${name}: no material`); continue; }
  const m = layout.materials?.[p.materialIndex];
  if (!m) { console.log(`${name}: mat ${p.materialIndex} missing`); continue; }
  console.log(`\n${name} (mat ${p.materialIndex}, origin=${p.origin}):`);
  console.log(`  vertexColors: ${JSON.stringify(p.vertexColors)}`);
  console.log(`  texMaps: ${JSON.stringify(m.textureMaps?.map(t=>({i:t.textureIndex,n:layout.textures?.[t.textureIndex],w:t.wrapS,wt:t.wrapT})))}`);
  console.log(`  tevStages: ${m.tevStages?.length??0}`);
  for (let i=0; i<(m.tevStages?.length??0); i++) {
    const s = m.tevStages[i];
    console.log(`    [${i}] aC=${s.aC} bC=${s.bC} cC=${s.cC} dC=${s.dC} biasC=${s.tevBiasC} scaleC=${s.tevScaleC} opC=${s.tevOpC} regC=${s.tevRegIdC} clampC=${s.clampC}`);
    console.log(`        aA=${s.aA} bA=${s.bA} cA=${s.cA} dA=${s.dA} biasA=${s.tevBiasA} scaleA=${s.tevScaleA} opA=${s.tevOpA} regA=${s.tevRegIdA} clampA=${s.clampA}`);
    console.log(`        texMap=${s.texMap} colorChan=${s.colorChan} kColorSelC=${s.kColorSelC} kAlphaSelA=${s.kAlphaSelA}`);
  }
  console.log(`  alphaCompare: ${JSON.stringify(m.alphaCompare)}`);
  console.log(`  blendMode: ${JSON.stringify(m.blendMode)}`);
  console.log(`  tevColors: ${JSON.stringify(m.tevColors)}`);
  console.log(`  color1: ${JSON.stringify(m.color1)} color2: ${JSON.stringify(m.color2)} color3: ${JSON.stringify(m.color3)}`);
}

// Dump all animations
console.log("\n=== ANIMATIONS ===");
const allAnims = icon.anim ? [{ name: "main", anim: icon.anim }] : [];
if (icon.animStart) allAnims.push({ name: "start", anim: icon.animStart });
if (icon.allAnims) {
  for (const [name, anim] of Object.entries(icon.allAnims)) {
    allAnims.push({ name, anim });
  }
}

// Also check the renderLayout for additional brlan data
const renderLayout = icon.renderLayout ?? layout;
console.log(`RenderLayout textures: ${renderLayout?.textures?.join(", ")}`);

for (const { name: animName, anim } of allAnims) {
  console.log(`\n--- ${animName} (frames=${anim?.frameSize}, timgs=${JSON.stringify(anim?.timgNames)}) ---`);
  if (!anim?.panes) continue;
  console.log(`Panes: ${anim.panes.map(p=>p.name).join(", ")}`);

  for (const pa of anim.panes) {
    const isKey = keyPanes.includes(pa.name) || pa.name.startsWith("bg_") || pa.name.startsWith("N_");
    if (!isKey) continue;
    console.log(`\n  ${pa.name}:`);
    for (const tag of pa.tags ?? []) {
      console.log(`    ${tag.type}:`);
      for (const entry of tag.entries ?? []) {
        const kfs = entry.keyframes?.map(kf => `f${kf.frame}=${kf.value.toFixed(2)}`).join(", ") ?? "none";
        console.log(`      type=0x${entry.type.toString(16).padStart(2,"0")} dt=${entry.dataType}: ${kfs}`);
      }
    }
  }
}

await server.close();
console.log("\nDone.");
