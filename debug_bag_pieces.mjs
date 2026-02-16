import { readFileSync } from "fs";
import { parseWAD } from "./src/lib/wadRenderer/parsers/index.js";
import { parseU8 } from "./src/lib/wadRenderer/parsers/index.js";
import { parseBRLYT, parseBRLAN } from "./src/lib/wadRenderer/parsers/index.js";

const wadPath = "/Users/ahmadjalil/github/wewad/New Folder With Items/Wii Shop Channel (World) (v20) (Channel).wad";
const buf = readFileSync(wadPath);
const wad = parseWAD(buf.buffer);

// Find banner data (content index 1 = opening.bnr)
const dataApp = wad.dataApps?.[0];
if (!dataApp) { console.log("No data app"); process.exit(1); }
const u8 = parseU8(dataApp);

// Find banner.brlyt and banner.brlan
let brlytBuf, brlanStartBuf, brlanLoopBuf;
for (const entry of u8.files ?? []) {
  if (entry.name?.endsWith("banner.brlyt")) brlytBuf = entry.data;
  if (entry.name?.endsWith("banner_Start.brlan")) brlanStartBuf = entry.data;
  if (entry.name?.endsWith("banner_Loop.brlan") || entry.name?.endsWith("banner.brlan")) brlanLoopBuf = entry.data;
}

if (!brlytBuf) { console.log("No banner.brlyt found"); process.exit(1); }
const layout = parseBRLYT(brlytBuf);

// Check all logo pieces within each bag group
for (const groupName of ["Null_00", "Null_01", "Null_02", "Null_03"]) {
  console.log(`\n=== ${groupName} ===`);
  const group = layout.panes.find(p => p.name === groupName);
  if (group) {
    const t = group.translate || {};
    const r = group.rotate || {};
    console.log(`  translate=(${t.x}, ${t.y}, ${t.z}) rotate=(${r.x}, ${r.y}, ${r.z})`);
  }
  const children = layout.panes.filter(p => p.parent === groupName);
  for (const child of children) {
    const sz = child.size || {};
    const t = child.translate || {};
    const r = child.rotate || {};
    const s = child.scale || {};
    console.log(`  "${child.name}" (${child.type}) size=${sz.w}x${sz.h} origin=${child.origin}`);
    console.log(`    translate=(${t.x}, ${t.y}, ${t.z}) rotate=(${r.x}, ${r.y}, ${r.z}) scale=(${s.x}, ${s.y})`);

    if (child.materialIndex != null) {
      const mat = layout.materials[child.materialIndex];
      const texNames = mat?.textureMaps?.map((tm, i) => `[${i}]=${layout.textures[tm.textureIndex]}`).join(", ");
      console.log(`    material="${mat?.name}" textures=${texNames} tevStages=${mat?.tevStages?.length ?? 0}`);
    }
  }
}

// Check start animation for these panes
if (brlanStartBuf) {
  const startAnim = parseBRLAN(brlanStartBuf);
  console.log("\n=== Start BRLAN - bag group panes ===");
  for (const paneAnim of startAnim.panes ?? []) {
    const isGroup = ["Null_00", "Null_01", "Null_02", "Null_03"].includes(paneAnim.name);
    const isPiece = layout.panes.find(p => p.name === paneAnim.name && ["Null_00", "Null_01", "Null_02", "Null_03"].includes(p.parent));
    if (!isGroup && !isPiece) continue;

    console.log(`\n"${paneAnim.name}":`);
    for (const tag of paneAnim.tags ?? []) {
      if (tag.type !== "RLPA") continue;
      for (const track of tag.entries ?? []) {
        const kf = track.keyframes;
        const first = kf?.[0];
        const last = kf?.[kf.length - 1];
        console.log(`  RLPA "${track.typeName}": f${first?.frame}=${first?.value?.toFixed(3)} ... f${last?.frame}=${last?.value?.toFixed(3)} (${kf.length} kfs)`);
      }
    }
  }
}

if (brlanLoopBuf) {
  const loopAnim = parseBRLAN(brlanLoopBuf);
  console.log("\n=== Loop BRLAN - bag group panes ===");
  for (const paneAnim of loopAnim.panes ?? []) {
    const isGroup = ["Null_00", "Null_01", "Null_02", "Null_03"].includes(paneAnim.name);
    const isPiece = layout.panes.find(p => p.name === paneAnim.name && ["Null_00", "Null_01", "Null_02", "Null_03"].includes(p.parent));
    if (!isGroup && !isPiece) continue;

    console.log(`\n"${paneAnim.name}":`);
    for (const tag of paneAnim.tags ?? []) {
      if (tag.type !== "RLPA") continue;
      for (const track of tag.entries ?? []) {
        const kf = track.keyframes;
        const first = kf?.[0];
        const last = kf?.[kf.length - 1];
        console.log(`  RLPA "${track.typeName}": f${first?.frame}=${first?.value?.toFixed(3)} ... f${last?.frame}=${last?.value?.toFixed(3)} (${kf.length} kfs)`);
      }
    }
  }
}
