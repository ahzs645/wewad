import { readFileSync } from "fs";
import { processWAD } from "./src/lib/wadRenderer/pipeline/process.js";

const wadPath = "/Users/ahmadjalil/github/wewad/New Folder With Items/Wii Shop Channel (World) (v20) (Channel).wad";
const buf = readFileSync(wadPath);

const result = await processWAD(buf.buffer, { info: () => {}, warn: () => {}, success: () => {}, error: () => {} });
const banner = result.results?.banner;

// Check if loop animation has logo pane entries
const loop = banner.animLoop;
console.log("=== Loop Animation Logo Panes ===");
console.log("Loop frameSize:", loop?.frameSize, "panes:", loop?.panes?.length);
for (const paneAnim of loop?.panes ?? []) {
  if (/logo|Null_0|handle/i.test(paneAnim.name)) {
    console.log(`  "${paneAnim.name}" tags: ${paneAnim.tags?.map(t => t.type).join(",")}`);
    for (const tag of paneAnim.tags ?? []) {
      for (const track of tag.entries ?? []) {
        const kf = track.keyframes?.slice(0, 5);
        const keyStr = kf?.map(k => `f${k.frame}=${typeof k.value === 'number' ? k.value.toFixed(2) : k.value}`).join(", ");
        console.log(`    ${tag.type} grp=${track.targetGroup} type=${track.type} "${track.typeName}": ${keyStr}`);
      }
    }
  }
}

// Check ALL panes in loop anim
console.log("\n=== All Loop Animation Pane Names ===");
for (const paneAnim of loop?.panes ?? []) {
  console.log(`  "${paneAnim.name}" tags: ${paneAnim.tags?.map(t => t.type).join(",")}`);
}

// Now let's check what the RLVC alpha animations look like at end-of-start (frame 790)
// And what RLMC type=19 means
console.log("\n=== RLMC type values explanation ===");
console.log("type 19 = Material B / Material Alpha 1 = offset 0x13 in material color register");
console.log("In NW4R ProcessHermiteKey, material color fields:");
console.log("  0x00-0x03 = material color (R,G,B,A)");
console.log("  0x04-0x07 = color1/C0 (R,G,B,A)");
console.log("  0x08-0x0B = color2/C1 (R,G,B,A)");
console.log("  0x0C-0x0F = color3/C2 (R,G,B,A)");
console.log("  0x10-0x1F = kColors[0..3] (RGBA each)");
console.log("  type 19 = 0x13 = kColors[0].A");

// Check: at end of start animation (frame 790), what would be the frozen state?
const start = banner.animStart;
console.log("\n=== Start Anim RLMC values at frame 790 (end of start) ===");
for (const paneAnim of start?.panes ?? []) {
  if (!/logo|handle/i.test(paneAnim.name)) continue;
  for (const tag of paneAnim.tags ?? []) {
    if (tag.type !== "RLMC") continue;
    for (const track of tag.entries ?? []) {
      // Find the last keyframe value (should be the frozen state)
      const kf = track.keyframes;
      if (!kf?.length) continue;
      const lastKf = kf[kf.length - 1];
      console.log(`  "${paneAnim.name}" RLMC type=${track.type} "${track.typeName}" grp=${track.targetGroup}: last keyframe f${lastKf.frame}=${lastKf.value?.toFixed(2)}`);
    }
  }
}

// Check: RLVC at frame 790
console.log("\n=== Start Anim RLVC values at frame 790 (end of start) ===");
for (const paneAnim of start?.panes ?? []) {
  if (!/logo|handle/i.test(paneAnim.name)) continue;
  for (const tag of paneAnim.tags ?? []) {
    if (tag.type !== "RLVC") continue;
    for (const track of tag.entries ?? []) {
      const kf = track.keyframes;
      if (!kf?.length) continue;
      const lastKf = kf[kf.length - 1];
      console.log(`  "${paneAnim.name}" RLVC type=${track.type} "${track.typeName}" grp=${track.targetGroup}: last keyframe f${lastKf.frame}=${lastKf.value?.toFixed(2)}`);
    }
  }
}

// Check RLPA at frame 790 for transform state
console.log("\n=== Start Anim RLPA final keyframe values for logo panes ===");
for (const paneAnim of start?.panes ?? []) {
  if (!/logo_04|logo_06|logo_08|logo_09|logo_10|logo_11/i.test(paneAnim.name)) continue;
  if (paneAnim.name.includes("_0") && paneAnim.name.length > 8) continue;
  for (const tag of paneAnim.tags ?? []) {
    if (tag.type !== "RLPA") continue;
    for (const track of tag.entries ?? []) {
      const kf = track.keyframes;
      if (!kf?.length) continue;
      const lastKf = kf[kf.length - 1];
      console.log(`  "${paneAnim.name}" RLPA type=${track.type} "${track.typeName}": last f${lastKf.frame}=${lastKf.value?.toFixed(3)}`);
    }
  }
}
