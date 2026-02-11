#!/usr/bin/env node
// Test pane visibility at various frames for Wii Shop icon
import { createServer } from "vite";
import { readFileSync } from "fs";
import { webcrypto } from "crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.crypto.subtle && webcrypto.subtle) globalThis.crypto.subtle = webcrypto.subtle;

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { processWAD } = await server.ssrLoadModule("/src/lib/wadRenderer/pipeline/process.js");
const paneAnimValues = await server.ssrLoadModule("/src/lib/wadRenderer/bannerRenderer/paneAnimValues.js");

const wadBuffer = readFileSync("New Folder With Items/Wii Shop Channel (World) (v20) (Channel).wad");
const ab = wadBuffer.buffer.slice(wadBuffer.byteOffset, wadBuffer.byteOffset + wadBuffer.byteLength);

console.log("Processing WAD...");
const result = await processWAD(ab, { info: () => {}, warn: console.warn, success: () => {} });
const icon = result.results?.icon;
if (!icon) { console.error("No icon found"); await server.close(); process.exit(1); }

const layout = icon.layout;
const anim = icon.anim;

// Build helper lookup
const byName = new Map();
for (const p of layout.panes) byName.set(p.name, p);

// Build a minimal renderer-like context to call getAnimValues
// We need to simulate the animByPaneName map
const animByPaneName = new Map();
if (anim?.panes) {
  for (const pa of anim.panes) {
    animByPaneName.set(pa.name, pa);
  }
}

// Manual getAnimValues implementation (simplified)
function getAnimValues(paneName, frame) {
  const result = {
    transX: null, transY: null, transZ: null,
    rotX: null, rotY: null, rotZ: null,
    scaleX: null, scaleY: null,
    width: null, height: null,
    visible: null, alpha: null,
    textureIndex: null,
    vertexColors: null,
    materialAlpha: null,
  };

  const pa = animByPaneName.get(paneName);
  if (!pa?.tags) return result;

  for (const tag of pa.tags) {
    for (const entry of tag.entries ?? []) {
      const kfs = entry.keyframes;
      if (!kfs?.length) continue;

      // Simple keyframe evaluation: find surrounding keyframes and interpolate
      let value;
      if (frame <= kfs[0].frame) {
        value = kfs[0].value;
      } else if (frame >= kfs[kfs.length - 1].frame) {
        value = kfs[kfs.length - 1].value;
      } else {
        // Find bracketing keyframes
        let lo = 0, hi = kfs.length - 1;
        for (let i = 0; i < kfs.length - 1; i++) {
          if (kfs[i].frame <= frame && frame <= kfs[i + 1].frame) {
            lo = i; hi = i + 1; break;
          }
        }
        if (entry.dataType === 1) {
          // Step interpolation
          value = kfs[lo].value;
        } else {
          // Linear approx (ignoring hermite slopes for simplicity)
          const t = (frame - kfs[lo].frame) / (kfs[hi].frame - kfs[lo].frame);
          value = kfs[lo].value + t * (kfs[hi].value - kfs[lo].value);
        }
      }

      // Map tag+entry type to result field
      if (tag.type === "RLPA") {
        if (entry.type === 0x00) result.transX = value;
        else if (entry.type === 0x01) result.transY = value;
        else if (entry.type === 0x02) result.transZ = value;
      } else if (tag.type === "RLVC") {
        if (entry.type === 0x10) result.alpha = value;
      } else if (tag.type === "RLVI") {
        if (entry.type === 0x00) result.visible = value >= 0.5;
      }
    }
  }

  return result;
}

// Check alpha chain for a pane (simplified)
function getChainAlpha(paneName, frame) {
  const chain = [];
  let current = paneName;
  while (current) {
    const pane = byName.get(current);
    if (!pane) break;
    chain.unshift(pane);
    current = pane.parent;
  }

  let alpha = 1;
  let visible = true;
  const targetPane = byName.get(paneName);

  for (const chainPane of chain) {
    const animValues = getAnimValues(chainPane.name, frame);
    const hasAnimatedAlpha = animValues.alpha != null;

    const propagatesAlpha = (chainPane.flags & 0x02) !== 0 ||
      chainPane.type === "pic1" || chainPane.type === "txt1" ||
      chainPane.type === "bnd1" || chainPane.type === "wnd1";

    // Local alpha
    let localAlpha;
    if (hasAnimatedAlpha) {
      localAlpha = Math.max(0, Math.min(1, animValues.alpha / 255));
    } else {
      localAlpha = (chainPane.alpha ?? 255) / 255;
    }

    // Visibility
    const chainVisible = animValues.visible != null
      ? animValues.visible
      : hasAnimatedAlpha ? true : chainPane.visible !== false;

    if (chainPane !== targetPane && chainVisible === false) {
      visible = false;
    }

    if (chainPane === targetPane || propagatesAlpha) {
      alpha *= localAlpha;
    }
  }

  return { alpha, visible };
}

const keyPanes = ["iconBg", "bg_wiiplane_00", "P_title_E_00", "P_ShopLogo_00", "N_LogoTitles"];
const testFrames = [0, 100, 175, 250, 331, 400, 500, 619, 1000, 2500, 4999];

console.log("\n=== Pane Visibility at Various Frames ===");
console.log(`Animation frameSize: ${anim?.frameSize}`);
console.log(`Animation panes: ${anim?.panes?.map(p => p.name).filter(n => keyPanes.includes(n) || n.startsWith("bg_")).join(", ")}`);

for (const frame of testFrames) {
  console.log(`\n--- Frame ${frame} ---`);
  for (const name of keyPanes) {
    const pane = byName.get(name);
    if (!pane) { console.log(`  ${name}: not found`); continue; }

    const animValues = getAnimValues(name, frame);
    const chain = getChainAlpha(name, frame);
    const localAlpha = animValues.alpha != null ? animValues.alpha / 255 : (pane.alpha ?? 255) / 255;
    const localVisible = animValues.visible != null
      ? animValues.visible
      : (animValues.alpha != null ? true : pane.visible !== false);

    const canDraw = chain.visible && chain.alpha > 0;
    console.log(`  ${name}: localAlpha=${localAlpha.toFixed(3)} localVisible=${localVisible} chainAlpha=${chain.alpha.toFixed(3)} chainVisible=${chain.visible} canDraw=${canDraw}`);
  }
}

await server.close();
console.log("\nDone.");
