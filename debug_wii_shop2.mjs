import { readFileSync } from "fs";
import { processWAD } from "./src/lib/wadRenderer/pipeline/process.js";

const wadPath = "/Users/ahmadjalil/github/wewad/New Folder With Items/Wii Shop Channel (World) (v20) (Channel).wad";
const buf = readFileSync(wadPath);

const result = await processWAD(buf.buffer, { info: () => {}, warn: () => {}, success: () => {}, error: () => {} });
const banner = result.results?.banner;
const layout = banner.renderLayout;

// Find panes with Y rotation
console.log("=== Panes with non-zero rotY ===");
for (const pane of layout.panes) {
  const rot = pane.rotate || {};
  if (rot.y && Math.abs(rot.y) > 0.01) {
    const trans = pane.translate || {};
    const scale = pane.scale || {};
    const size = pane.size || {};
    console.log(`  ${pane.type} "${pane.name}" parent="${pane.parent}"` +
      ` size=${size.w}x${size.h}` +
      ` translate=(${trans.x?.toFixed(1)}, ${trans.y?.toFixed(1)}, ${trans.z?.toFixed(1)})` +
      ` rotate=(${rot.x?.toFixed(1)}, ${rot.y?.toFixed(1)}, ${rot.z?.toFixed(1)})` +
      ` scale=(${scale.x?.toFixed(3)}, ${scale.y?.toFixed(3)})`);
  }
}

// Find the logo/bag panes
console.log("\n=== Logo/Bag related panes ===");
for (const pane of layout.panes) {
  if (/logo|bag|shop/i.test(pane.name)) {
    const rot = pane.rotate || {};
    const trans = pane.translate || {};
    const scale = pane.scale || {};
    const size = pane.size || {};
    const vc = pane.vertexColors;
    const flags = pane.flags ?? 0;

    console.log(`  ${pane.type} "${pane.name}" parent="${pane.parent}"` +
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
      console.log(`    material="${mat.name}" idx=${pane.materialIndex} texMaps=${mat.texMaps?.length ?? 0}`);
      if (mat.color2) console.log(`    color2: [${mat.color2}]`);
      if (mat.texMaps?.length) console.log(`    texMaps: [${mat.texMaps.map(t => `idx=${t.texIndex}→${layout.textures[t.texIndex]}`).join(",")}]`);
    }
  }
}

// Find all pane hierarchy containing bag/logo
console.log("\n=== Full hierarchy from root to logo_base ===");
function getAncestors(paneName) {
  const chain = [];
  let current = layout.panes.find(p => p.name === paneName);
  while (current) {
    chain.unshift(current);
    if (!current.parent) break;
    current = layout.panes.find(p => p.name === current.parent);
  }
  return chain;
}

const logoBase = layout.panes.find(p => p.name === "logo_base");
if (logoBase) {
  const chain = getAncestors("logo_base");
  for (const pane of chain) {
    const rot = pane.rotate || {};
    const trans = pane.translate || {};
    const scale = pane.scale || {};
    const size = pane.size || {};
    console.log(`  ${pane.type} "${pane.name}"` +
      ` size=${size.w}x${size.h}` +
      ` translate=(${trans.x?.toFixed(1)}, ${trans.y?.toFixed(1)}, ${trans.z?.toFixed(1)})` +
      ` rotate=(${rot.x?.toFixed(1)}, ${rot.y?.toFixed(1)}, ${rot.z?.toFixed(1)})` +
      ` scale=(${scale.x?.toFixed(3)}, ${scale.y?.toFixed(3)})`);
  }

  // Show children of logo_base
  console.log("\n  Children of logo_base:");
  for (const pane of layout.panes) {
    if (pane.parent === "logo_base") {
      const rot = pane.rotate || {};
      const trans = pane.translate || {};
      const scale = pane.scale || {};
      const size = pane.size || {};
      const vc = pane.vertexColors;
      console.log(`    ${pane.type} "${pane.name}"` +
        ` visible=${pane.visible !== false}` +
        ` size=${size.w}x${size.h}` +
        ` translate=(${trans.x?.toFixed(1)}, ${trans.y?.toFixed(1)}, ${trans.z?.toFixed(1)})` +
        ` rotate=(${rot.x?.toFixed(1)}, ${rot.y?.toFixed(1)}, ${rot.z?.toFixed(1)})` +
        ` scale=(${scale.x?.toFixed(3)}, ${scale.y?.toFixed(3)})` +
        ` alpha=${pane.alpha}`);
      if (vc && vc.length >= 4) {
        console.log(`      VC: TL=(${vc[0].r},${vc[0].g},${vc[0].b},${vc[0].a}) TR=(${vc[1].r},${vc[1].g},${vc[1].b},${vc[1].a}) BL=(${vc[2].r},${vc[2].g},${vc[2].b},${vc[2].a}) BR=(${vc[3].r},${vc[3].g},${vc[3].b},${vc[3].a})`);
      }
      if (pane.materialIndex != null) {
        const mat = layout.materials[pane.materialIndex];
        console.log(`      material="${mat?.name}" texMaps: ${mat?.texMaps?.map(t => `${t.texIndex}→${layout.textures[t.texIndex]}`).join(",")}`);
        if (mat?.color2) console.log(`      color2: [${mat.color2}]`);
      }

      // Show grandchildren too
      for (const child of layout.panes) {
        if (child.parent === pane.name) {
          const crot = child.rotate || {};
          const ctrans = child.translate || {};
          const cscale = child.scale || {};
          const csize = child.size || {};
          const cvc = child.vertexColors;
          console.log(`      ${child.type} "${child.name}"` +
            ` visible=${child.visible !== false}` +
            ` size=${csize.w}x${csize.h}` +
            ` translate=(${ctrans.x?.toFixed(1)}, ${ctrans.y?.toFixed(1)}, ${ctrans.z?.toFixed(1)})` +
            ` rotate=(${crot.x?.toFixed(1)}, ${crot.y?.toFixed(1)}, ${crot.z?.toFixed(1)})` +
            ` scale=(${cscale.x?.toFixed(3)}, ${cscale.y?.toFixed(3)})` +
            ` alpha=${child.alpha}`);
          if (cvc && cvc.length >= 4) {
            console.log(`        VC: TL=(${cvc[0].r},${cvc[0].g},${cvc[0].b},${cvc[0].a}) TR=(${cvc[1].r},${cvc[1].g},${cvc[1].b},${cvc[1].a}) BL=(${cvc[2].r},${cvc[2].g},${cvc[2].b},${cvc[2].a}) BR=(${cvc[3].r},${cvc[3].g},${cvc[3].b},${cvc[3].a})`);
          }
          if (child.materialIndex != null) {
            const mat = layout.materials[child.materialIndex];
            console.log(`        material="${mat?.name}" texMaps: ${mat?.texMaps?.map(t => `${t.texIndex}→${layout.textures[t.texIndex]}`).join(",")}`);
            if (mat?.color2) console.log(`        color2: [${mat.color2}]`);
          }
        }
      }
    }
  }
}

// Show animation entries for logo-related panes
const allAnims = [banner.anim, banner.animStart, banner.animLoop].filter(Boolean);
console.log("\n=== Animation entries for logo/bag panes ===");
for (const a of allAnims) {
  const entries = a.entries ?? a.pai1?.entries ?? [];
  if (!Array.isArray(entries)) continue;
  for (const entry of entries) {
    if (!/logo|bag/i.test(entry.name)) continue;
    const tags = entry.tags || [];
    console.log(`  Pane "${entry.name}":`);
    for (const tag of tags) {
      for (const track of tag.entries) {
        const keyValues = track.keyframes?.slice(0, 6).map(k =>
          `f${k.frame}=${typeof k.value === 'number' ? k.value.toFixed(2) : k.value}`
        ).join(", ");
        const extra = track.keyframes?.length > 6 ? ` ...+${track.keyframes.length - 6} more` : "";
        console.log(`    ${tag.type} target=0x${track.target.toString(16)}: ${keyValues}${extra}`);
      }
    }
  }
}
