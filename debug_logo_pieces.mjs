import { readFileSync } from "fs";
import { processWAD } from "./src/lib/wadRenderer/pipeline/process.js";

const wadPath = "/Users/ahmadjalil/github/wewad/New Folder With Items/Wii Shop Channel (World) (v20) (Channel).wad";
const buf = readFileSync(wadPath);
const result = await processWAD(buf.buffer, { info: () => {}, warn: () => {}, success: () => {}, error: () => {} });
const banner = result.results?.banner;
const layout = banner.renderLayout;

// Detailed info for all pieces of the front bag group (Null_00)
console.log("=== Front bag (Null_00) pieces - static BRLYT ===");
for (const pane of layout.panes) {
  if (pane.name === "Null_00" || pane.parent === "Null_00" || pane.name === "logo_base") {
    const t = pane.translate || {};
    const r = pane.rotate || {};
    const s = pane.scale || {};
    const sz = pane.size || {};
    console.log(`"${pane.name}" (${pane.type}) parent="${pane.parent}" origin=${pane.origin}`);
    console.log(`  pos=(${t.x?.toFixed(1)}, ${t.y?.toFixed(1)}, ${t.z?.toFixed(1)}) size=${sz.w}x${sz.h}`);
    console.log(`  rot=(${r.x?.toFixed(1)}, ${r.y?.toFixed(1)}, ${r.z?.toFixed(1)}) scale=(${s.x?.toFixed(3)}, ${s.y?.toFixed(3)})`);
    if (pane.materialIndex != null) {
      const mat = layout.materials[pane.materialIndex];
      console.log(`  material="${mat?.name}" texMaps=${mat?.textureMaps?.map((t,i) => `[${i}]=${layout.textures[t.textureIndex]}`).join(", ")}`);
    }
  }
}

// Check animated positions at end of start animation (frame 790)
console.log("\n=== Animated positions at end of start (frozen state) ===");
const start = banner.animStart;
if (start) {
  for (const paneAnim of start.panes ?? []) {
    if (paneAnim.name !== "Null_00" && !layout.panes.find(p => p.name === paneAnim.name && p.parent === "Null_00")) continue;
    console.log(`\n"${paneAnim.name}":`);
    for (const tag of paneAnim.tags ?? []) {
      if (tag.type !== "RLPA") continue;
      for (const track of tag.entries ?? []) {
        const kf = track.keyframes;
        const lastKf = kf?.[kf.length - 1];
        console.log(`  RLPA type=${track.type} "${track.typeName}": last kf f${lastKf?.frame}=${lastKf?.value?.toFixed(3)}`);
      }
    }
  }
}

// Check the textures themselves
console.log("\n=== Texture dimensions ===");
// Check the TPL textures referenced
for (const texName of layout.textures) {
  if (/logo_pic/.test(texName)) {
    console.log(`  "${texName}"`);
  }
}

// Check all 4 bag groups
console.log("\n=== All bag groups ===");
for (const groupName of ["Null_00", "Null_01", "Null_02", "Null_03"]) {
  const children = layout.panes.filter(p => p.parent === groupName);
  console.log(`${groupName}: ${children.map(p => p.name).join(", ")}`);
  for (const child of children) {
    const sz = child.size || {};
    const t = child.translate || {};
    console.log(`  "${child.name}" size=${sz.w}x${sz.h} pos=(${t.x?.toFixed(1)}, ${t.y?.toFixed(1)}, ${t.z?.toFixed(1)}) origin=${child.origin}`);
  }
}
