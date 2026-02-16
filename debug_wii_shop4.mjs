import { readFileSync } from "fs";
import { processWAD } from "./src/lib/wadRenderer/pipeline/process.js";

const wadPath = "/Users/ahmadjalil/github/wewad/New Folder With Items/Wii Shop Channel (World) (v20) (Channel).wad";
const buf = readFileSync(wadPath);

const result = await processWAD(buf.buffer, { info: () => {}, warn: () => {}, success: () => {}, error: () => {} });
const banner = result.results?.banner;

console.log("=== Banner result keys ===");
console.log(Object.keys(banner));

console.log("\n=== anim ===");
const a = banner.anim;
console.log("keys:", Object.keys(a));
console.log("frameSize:", a.frameSize);
console.log("panes count:", a.panes?.length);
console.log("timgNames:", a.timgNames);

console.log("\n=== animStart ===");
const s = banner.animStart;
if (s) {
  console.log("keys:", Object.keys(s));
  console.log("frameSize:", s.frameSize);
  console.log("panes count:", s.panes?.length);
} else {
  console.log("null");
}

console.log("\n=== animLoop ===");
const l = banner.animLoop;
if (l) {
  console.log("keys:", Object.keys(l));
  console.log("frameSize:", l.frameSize);
  console.log("panes count:", l.panes?.length);
} else {
  console.log("null");
}

console.log("\n=== animEntries ===");
console.log("count:", banner.animEntries?.length);
if (banner.animEntries?.length > 0) {
  for (const entry of banner.animEntries) {
    console.log(`  ${entry.name || entry.filename}: frameSize=${entry.frameSize ?? entry.anim?.frameSize} panes=${entry.panes?.length ?? entry.anim?.panes?.length}`);
  }
}

// Try all possible animation data sources
const allAnims = [];
if (a?.panes?.length) allAnims.push({ label: "anim", anim: a });
if (s?.panes?.length) allAnims.push({ label: "animStart", anim: s });
if (l?.panes?.length) allAnims.push({ label: "animLoop", anim: l });

for (const entry of banner.animEntries ?? []) {
  const ea = entry.anim ?? entry;
  if (ea?.panes?.length) allAnims.push({ label: `entry:${entry.name ?? entry.filename}`, anim: ea });
}

console.log("\n=== All animations with logo pane data ===");
for (const { label, anim } of allAnims) {
  console.log(`\n--- ${label} (frameSize=${anim.frameSize}, ${anim.panes.length} panes) ---`);
  for (const paneAnim of anim.panes) {
    if (!/logo|Null_0|handle|logo_base/i.test(paneAnim.name)) continue;
    console.log(`  Pane "${paneAnim.name}" (${paneAnim.tags?.map(t => t.type).join(",") ?? "no tags"}):`);
    for (const tag of paneAnim.tags ?? []) {
      for (const track of tag.entries ?? []) {
        const kf = track.keyframes?.slice(0, 5);
        const keyStr = kf?.map(k => `f${k.frame}=${typeof k.value === 'number' ? k.value.toFixed(2) : k.value}`).join(", ");
        const extra = (track.keyframes?.length ?? 0) > 5 ? ` ...+${track.keyframes.length - 5} more` : "";
        const tgt = track.targetGroup ?? track.target ?? "?";
        console.log(`    ${tag.type} grp=${tgt} type=${track.type} "${track.typeName}" (${track.keyframes?.length} keys): ${keyStr}${extra}`);
      }
    }
  }
}

// Also check ALL animated panes for RLMC (material color animation) that targets logos
console.log("\n=== All RLMC material color animations ===");
for (const { label, anim } of allAnims) {
  for (const paneAnim of anim.panes) {
    for (const tag of paneAnim.tags ?? []) {
      if (tag.type === "RLMC") {
        console.log(`  ${label}: "${paneAnim.name}" RLMC`);
        for (const track of tag.entries ?? []) {
          const kf = track.keyframes?.slice(0, 4);
          const keyStr = kf?.map(k => `f${k.frame}=${typeof k.value === 'number' ? k.value.toFixed(2) : k.value}`).join(", ");
          console.log(`    grp=${track.targetGroup} type=${track.type} "${track.typeName}": ${keyStr}...`);
        }
      }
    }
  }
}

// Check RLVC (vertex color animation)
console.log("\n=== All RLVC vertex color animations (for logo panes) ===");
for (const { label, anim } of allAnims) {
  for (const paneAnim of anim.panes) {
    if (!/logo|Null_0|handle/i.test(paneAnim.name)) continue;
    for (const tag of paneAnim.tags ?? []) {
      if (tag.type === "RLVC") {
        console.log(`  ${label}: "${paneAnim.name}" RLVC`);
        for (const track of tag.entries ?? []) {
          const kf = track.keyframes?.slice(0, 4);
          const keyStr = kf?.map(k => `f${k.frame}=${typeof k.value === 'number' ? k.value.toFixed(2) : k.value}`).join(", ");
          console.log(`    grp=${track.targetGroup} type=${track.type} "${track.typeName}": ${keyStr}...`);
        }
      }
    }
  }
}
