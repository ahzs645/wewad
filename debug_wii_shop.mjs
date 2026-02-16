import { readFileSync } from "fs";
import { processWAD } from "./src/lib/wadRenderer/pipeline/process.js";

const wadPath = "/Users/ahmadjalil/github/wewad/New Folder With Items/Wii Shop Channel (World) (v20) (Channel).wad";
const buf = readFileSync(wadPath);

const logger = {
  info: () => {},
  warn: (msg) => console.log("WARN:", msg),
  success: () => {},
  error: (msg) => console.error("ERR:", msg),
};

const result = await processWAD(buf.buffer, logger);
const banner = result.results?.banner;
if (!banner) {
  console.log("No banner found");
  process.exit(1);
}

const layout = banner.renderLayout;
console.log("=== Layout ===");
console.log("Size:", layout.width, "x", layout.height);

console.log("\n=== Pane Tree ===");
for (const pane of layout.panes) {
  const rot = pane.rotate || {};
  const trans = pane.translate || {};
  const scale = pane.scale || {};
  const size = pane.size || {};
  const vc = pane.vertexColors;
  const flags = pane.flags ?? 0;

  console.log(`  ${pane.type} "${pane.name}" parent="${pane.parent || "root"}"` +
    ` visible=${pane.visible !== false} flags=0x${flags.toString(16)}` +
    ` size=${size.w}x${size.h}` +
    ` translate=(${trans.x?.toFixed(1)}, ${trans.y?.toFixed(1)}, ${trans.z?.toFixed(1)})` +
    ` rotate=(${rot.x?.toFixed(1)}, ${rot.y?.toFixed(1)}, ${rot.z?.toFixed(1)})` +
    ` scale=(${scale.x?.toFixed(3)}, ${scale.y?.toFixed(3)})` +
    ` alpha=${pane.alpha}`);

  if (vc && vc.length >= 4) {
    console.log(`    vertexColors: TL=(${vc[0].r},${vc[0].g},${vc[0].b},${vc[0].a}) TR=(${vc[1].r},${vc[1].g},${vc[1].b},${vc[1].a}) BL=(${vc[2].r},${vc[2].g},${vc[2].b},${vc[2].a}) BR=(${vc[3].r},${vc[3].g},${vc[3].b},${vc[3].a})`);
  }

  if (pane.materialIndex != null && layout.materials?.[pane.materialIndex]) {
    const mat = layout.materials[pane.materialIndex];
    console.log(`    material="${mat.name}" idx=${pane.materialIndex}`);
    if (mat.color2) console.log(`    color2: [${mat.color2}]`);
    if (mat.tevColors) {
      for (let k = 0; k < mat.tevColors.length; k++) {
        const tc = mat.tevColors[k];
        console.log(`    kColor[${k}]: (${tc.r},${tc.g},${tc.b},${tc.a})`);
      }
    }
    if (mat.texMaps?.length) console.log(`    texMaps: [${mat.texMaps.map(t => `idx=${t.texIndex}`).join(",")}]`);
  }
}

console.log("\n=== Textures ===");
for (let i = 0; i < layout.textures.length; i++) {
  console.log(`  [${i}] ${layout.textures[i]}`);
}

console.log("\n=== Materials ===");
for (let i = 0; i < layout.materials.length; i++) {
  const m = layout.materials[i];
  console.log(`  [${i}] "${m.name}" texMaps=${m.texMaps?.length ?? 0} tevStages=${m.tevStages?.length ?? 0}`);
  if (m.color2) console.log(`    color2: [${m.color2}]`);
}

// Parse animations
const anim = banner.anim;
const animStart = banner.animStart;
const animLoop = banner.animLoop;

for (const [label, a] of [["anim", anim], ["animStart", animStart], ["animLoop", animLoop]]) {
  if (!a) continue;
  console.log(`\n=== ${label} (frameSize=${a.frameSize}) ===`);
  for (const entry of a.entries) {
    const tags = entry.tags || [];
    // Only show panes that are likely the bags
    const tagTypes = tags.map(t => t.type).join(",");
    console.log(`  Pane "${entry.name}" (${tagTypes}):`);
    for (const tag of tags) {
      for (const track of tag.entries) {
        const keyValues = track.keyframes?.slice(0, 4).map(k =>
          `f${k.frame}=${typeof k.value === 'number' ? k.value.toFixed(2) : k.value}`
        ).join(", ");
        const extra = track.keyframes?.length > 4 ? ` ...+${track.keyframes.length - 4} more` : "";
        console.log(`    ${tag.type} target=0x${track.target.toString(16)}: ${keyValues}${extra}`);
      }
    }
  }
}
