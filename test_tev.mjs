#!/usr/bin/env node
// Test TEV evaluation for Wii Shop icon panes
import { createServer } from "vite";
import { webcrypto } from "crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.crypto.subtle && webcrypto.subtle) globalThis.crypto.subtle = webcrypto.subtle;

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { evaluateTevStagesForPixel, evaluateTevPipeline } = await server.ssrLoadModule("/src/lib/wadRenderer/bannerRenderer/tevEvaluator.js");

// P_ShopLogo_00 material data (from debug_icon.mjs output)
const shopLogoMat = {
  color1: [0, 0, 0, 0],
  color2: [255, 255, 255, 0],
  color3: [255, 255, 255, 255],
  tevColors: [
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
  ],
  tevStages: [{
    aC: 2, bC: 4, cC: 8, dC: 15,
    tevBiasC: 0, tevScaleC: 0, tevOpC: 0, tevRegIdC: 0, clampC: 0,
    aA: 4, bA: 6, cA: 5, dA: 7,
    tevBiasA: 3, tevScaleA: 3, tevOpA: 0, tevRegIdA: 0, clampA: 0,
    texMap: 0, colorChan: 4,
    kColorSelC: 19, kAlphaSelA: 0,
    texSel: 0, rasSel: 0,
  }],
  alphaCompare: { condition0: 7, condition1: 7, operation: 0, value0: 0, value1: 0 },
};

// Test with a fully opaque CMPR pixel (texture color = (200, 100, 50, 255))
const opaqueTexSample = { r: 200/255, g: 100/255, b: 50/255, a: 1.0 };
const transparentTexSample = { r: 0, g: 0, b: 0, a: 0 };
const rasColor = { r: 1, g: 1, b: 1, a: 1 }; // white vertex color

console.log("\n=== P_ShopLogo_00 TEV Test ===");
console.log("With opaque CMPR pixel (200,100,50, alpha=1.0):");
const r1 = evaluateTevStagesForPixel(shopLogoMat.tevStages, [opaqueTexSample], rasColor, shopLogoMat, shopLogoMat.tevColors, null);
console.log("  Result:", { r: Math.round(r1.r*255), g: Math.round(r1.g*255), b: Math.round(r1.b*255), a: Math.round(r1.a*255) });

console.log("\nWith transparent CMPR pixel (0,0,0, alpha=0):");
const r2 = evaluateTevStagesForPixel(shopLogoMat.tevStages, [transparentTexSample], rasColor, shopLogoMat, shopLogoMat.tevColors, null);
console.log("  Result:", { r: Math.round(r2.r*255), g: Math.round(r2.g*255), b: Math.round(r2.b*255), a: Math.round(r2.a*255) });

// bg_wiiplane_00 material data
const bgMat = {
  color1: [0, 0, 0, 0],
  color2: [255, 255, 255, 255],
  color3: [255, 255, 255, 255],
  tevColors: [
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 0, g: 0, b: 0, a: 255 }, // kColors[3] at frame 0 (animated to 0,0,0)
  ],
  tevStages: [
    { aC:8, bC:14, cC:12, dC:15, tevBiasC:3, tevScaleC:2, tevOpC:0, tevRegIdC:2, clampC:0,
      aA:1, bA:2, cA:4, dA:7, tevBiasA:0, tevScaleA:0, tevOpA:0, tevRegIdA:0, clampA:0,
      texMap:1, colorChan:255, kColorSelC:15, kAlphaSelA:31, texSel:0, rasSel:0 },
    { aC:14, bC:8, cC:4, dC:15, tevBiasC:0, tevScaleC:0, tevOpC:0, tevRegIdC:3, clampC:1,
      aA:0, bA:7, cA:7, dA:7, tevBiasA:0, tevScaleA:0, tevOpA:0, tevRegIdA:0, clampA:1,
      texMap:1, colorChan:255, kColorSelC:15, kAlphaSelA:28, texSel:0, rasSel:0 },
    { aC:8, bC:14, cC:4, dC:15, tevBiasC:0, tevScaleC:0, tevOpC:0, tevRegIdC:2, clampC:1,
      aA:0, bA:7, cA:7, dA:7, tevBiasA:0, tevScaleA:0, tevOpA:0, tevRegIdA:0, clampA:1,
      texMap:1, colorChan:255, kColorSelC:15, kAlphaSelA:28, texSel:0, rasSel:0 },
    { aC:12, bC:15, cC:6, dC:4, tevBiasC:0, tevScaleC:0, tevOpC:0, tevRegIdC:2, clampC:1,
      aA:0, bA:7, cA:7, dA:7, tevBiasA:0, tevScaleA:0, tevOpA:0, tevRegIdA:0, clampA:1,
      texMap:255, colorChan:255, kColorSelC:12, kAlphaSelA:28, texSel:0, rasSel:0 },
    { aC:15, bC:4, cC:4, dC:15, tevBiasC:0, tevScaleC:0, tevOpC:6, tevRegIdC:2, clampC:1,
      aA:0, bA:7, cA:7, dA:7, tevBiasA:0, tevScaleA:0, tevOpA:0, tevRegIdA:0, clampA:1,
      texMap:255, colorChan:255, kColorSelC:12, kAlphaSelA:28, texSel:0, rasSel:0 },
    { aC:14, bC:8, cC:4, dC:15, tevBiasC:0, tevScaleC:0, tevOpC:0, tevRegIdC:0, clampC:1,
      aA:0, bA:7, cA:7, dA:7, tevBiasA:0, tevScaleA:0, tevOpA:0, tevRegIdA:0, clampA:1,
      texMap:0, colorChan:255, kColorSelC:14, kAlphaSelA:28, texSel:0, rasSel:0 },
  ],
  alphaCompare: { condition0: 7, condition1: 7, operation: 0, value0: 0, value1: 0 },
};

// Simulate textures: texMap 0 = icon_bg01 (blue gradient), texMap 1 = anim_pattern (opaque pattern)
const bgTexOpaque = { r: 0.3, g: 0.5, b: 0.8, a: 1.0 }; // icon_bg01 (blue gradient pixel)
const patternOpaque = { r: 0.6, g: 0.6, b: 0.6, a: 1.0 }; // anim_pattern (gray opaque)
const patternTransparent = { r: 0, g: 0, b: 0, a: 0 }; // anim_pattern (transparent)

console.log("\n=== bg_wiiplane_00 TEV Test (kColors[3]=(0,0,0), frame 0) ===");
console.log("With opaque anim_pattern (0.6,0.6,0.6,1.0) and icon_bg01 (0.3,0.5,0.8,1.0):");
const bgR1 = evaluateTevStagesForPixel(bgMat.tevStages, [bgTexOpaque, patternOpaque], rasColor, bgMat, bgMat.tevColors, null);
console.log("  Result:", { r: Math.round(bgR1.r*255), g: Math.round(bgR1.g*255), b: Math.round(bgR1.b*255), a: Math.round(bgR1.a*255) });

console.log("\nWith transparent anim_pattern (0,0,0,0) and icon_bg01 (0.3,0.5,0.8,1.0):");
const bgR2 = evaluateTevStagesForPixel(bgMat.tevStages, [bgTexOpaque, patternTransparent], rasColor, bgMat, bgMat.tevColors, null);
console.log("  Result:", { r: Math.round(bgR2.r*255), g: Math.round(bgR2.g*255), b: Math.round(bgR2.b*255), a: Math.round(bgR2.a*255) });

// Test with animated kColors[3] = (128, 128, 128) (mid-animation threshold)
const bgMat2 = {
  ...bgMat,
  tevColors: [
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 128, g: 128, b: 128, a: 255 }, // mid-animation
  ],
};

console.log("\n=== bg_wiiplane_00 with kColors[3]=(128,128,128) (mid-animation) ===");
console.log("anim_pattern (0.6,0.6,0.6,1.0) should PASS compare (0.6*255=153 >= 128):");
const bgR3 = evaluateTevStagesForPixel(bgMat2.tevStages, [bgTexOpaque, patternOpaque], rasColor, bgMat2, bgMat2.tevColors, null);
console.log("  Result:", { r: Math.round(bgR3.r*255), g: Math.round(bgR3.g*255), b: Math.round(bgR3.b*255), a: Math.round(bgR3.a*255) });

console.log("\nanim_pattern (0.3,0.3,0.3,1.0) should FAIL compare (0.3*255=77 < 128):");
const darkPattern = { r: 0.3, g: 0.3, b: 0.3, a: 1.0 };
const bgR4 = evaluateTevStagesForPixel(bgMat2.tevStages, [bgTexOpaque, darkPattern], rasColor, bgMat2, bgMat2.tevColors, null);
console.log("  Result:", { r: Math.round(bgR4.r*255), g: Math.round(bgR4.g*255), b: Math.round(bgR4.b*255), a: Math.round(bgR4.a*255) });

// Verify evaluateTevPipeline with a simple 2x2 buffer
console.log("\n=== Full pipeline test (P_ShopLogo_00 with 2x2 buffer) ===");
const tex2x2 = {
  data: new Uint8ClampedArray([
    200, 100, 50, 255,   // opaque bag pixel
    0, 0, 0, 0,          // transparent background
    150, 80, 30, 255,    // opaque bag pixel
    0, 0, 0, 0,          // transparent background
  ]),
  width: 2,
  height: 2,
};
const ras2x2 = {
  data: new Uint8ClampedArray([
    255, 255, 255, 255,
    255, 255, 255, 255,
    255, 255, 255, 255,
    255, 255, 255, 255,
  ]),
  width: 2,
  height: 2,
};
const fullResult = evaluateTevPipeline(shopLogoMat.tevStages, shopLogoMat, [tex2x2], ras2x2, 2, 2);
console.log("Full pipeline 2x2 result:");
for (let y = 0; y < 2; y++) {
  for (let x = 0; x < 2; x++) {
    const i = (y * 2 + x) * 4;
    console.log(`  (${x},${y}): R=${fullResult.data[i]} G=${fullResult.data[i+1]} B=${fullResult.data[i+2]} A=${fullResult.data[i+3]}`);
  }
}

await server.close();
console.log("\nDone.");
