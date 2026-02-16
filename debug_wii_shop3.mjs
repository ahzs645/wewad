import { readFileSync } from "fs";
import { processWAD } from "./src/lib/wadRenderer/pipeline/process.js";

const wadPath = "/Users/ahmadjalil/github/wewad/New Folder With Items/Wii Shop Channel (World) (v20) (Channel).wad";
const buf = readFileSync(wadPath);

const result = await processWAD(buf.buffer, { info: () => {}, warn: () => {}, success: () => {}, error: () => {} });
const banner = result.results?.banner;
const layout = banner.renderLayout;

// Check materials for logo panes - use CORRECT field name
const logoMaterialIndices = [155, 156, 157, 158, 159, 164, 165, 166, 167, 168, 1, 2, 3, 4, 5, 6, 7];
console.log("=== Logo Material Details ===");
for (const idx of logoMaterialIndices) {
  const m = layout.materials[idx];
  if (!m) continue;
  console.log(`  [${idx}] "${m.name}"`);
  console.log(`    textureMaps: ${JSON.stringify(m.textureMaps)}`);
  console.log(`    textureIndices: ${JSON.stringify(m.textureIndices)}`);
  console.log(`    tevStages: ${m.tevStages?.length ?? 0} stages`);
  if (m.tevStages?.length) {
    for (let s = 0; s < m.tevStages.length; s++) {
      const ts = m.tevStages[s];
      console.log(`      stage[${s}]: texMap=${ts.texMap} texCoord=${ts.texCoord} colorChan=${ts.colorChan} rasSel=${ts.rasSel}`);
      console.log(`        colorA=${ts.colorA} colorB=${ts.colorB} colorC=${ts.colorC} colorD=${ts.colorD}`);
      console.log(`        colorOp=${ts.colorOp} colorBias=${ts.colorBias} colorScale=${ts.colorScale}`);
      console.log(`        alphaA=${ts.alphaA} alphaB=${ts.alphaB} alphaC=${ts.alphaC} alphaD=${ts.alphaD}`);
    }
  }
  console.log(`    color1(s16): ${JSON.stringify(m.color1)}`);
  console.log(`    color2: ${JSON.stringify(m.color2)}`);
  console.log(`    color3: ${JSON.stringify(m.color3)}`);
  console.log(`    tevColors(kColors): ${JSON.stringify(m.tevColors)}`);
  console.log(`    alphaCompare: ${JSON.stringify(m.alphaCompare)}`);
  console.log(`    blendMode: ${JSON.stringify(m.blendMode)}`);
  console.log(`    materialColor: ${JSON.stringify(m.materialColor)}`);
}

// Check textures list
console.log("\n=== Textures ===");
for (let i = 0; i < Math.min(20, layout.textures.length); i++) {
  console.log(`  [${i}] ${layout.textures[i]}`);
}

// Check logo pane names and which texture index they use
console.log("\n=== Logo pane texture analysis ===");
for (const pane of layout.panes) {
  if (!/logo|Null_0/i.test(pane.name)) continue;
  const mat = pane.materialIndex != null ? layout.materials[pane.materialIndex] : null;
  console.log(`  ${pane.type} "${pane.name}" matIdx=${pane.materialIndex} textureMaps=${JSON.stringify(mat?.textureMaps?.map(t => ({idx: t.textureIndex, name: layout.textures[t.textureIndex]})))}`);
}

// Check animation for logo panes - check structure
const anim = banner.anim;
console.log("\n=== Animation structure ===");
console.log("anim type:", typeof anim);
console.log("anim keys:", anim ? Object.keys(anim) : "null");
if (anim?.entries) console.log("entries type:", typeof anim.entries, Array.isArray(anim.entries) ? "array" : "not array");
if (anim?.pai1) console.log("pai1 keys:", Object.keys(anim.pai1));

const entries = Array.isArray(anim?.entries) ? anim.entries : (anim?.pai1?.entries ?? []);
console.log("Total anim entries:", entries.length);

// Find animation entries for logo panes
console.log("\n=== Animation for logo panes ===");
for (const entry of entries) {
  if (!/logo|Null_0|handle/i.test(entry.name)) continue;
  const tags = entry.tags || [];
  console.log(`  Pane "${entry.name}" (${tags.map(t => t.type).join(",")}):`);
  for (const tag of tags) {
    for (const track of tag.entries) {
      const kf = track.keyframes?.slice(0, 5);
      const keyStr = kf?.map(k => `f${k.frame}=${typeof k.value === 'number' ? k.value.toFixed(2) : k.value}`).join(", ");
      const extra = (track.keyframes?.length ?? 0) > 5 ? ` ...+${track.keyframes.length - 5} more` : "";
      console.log(`    ${tag.type} target=0x${track.target.toString(16)} (${track.keyframes?.length} keys): ${keyStr}${extra}`);
    }
  }
}
