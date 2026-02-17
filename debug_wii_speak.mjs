/**
 * Debug: parse Wii Speak Channel WAD and dump banner pane hierarchy with scales.
 * Usage: node debug_wii_speak.mjs
 */
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { createServer } from "vite";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.crypto.subtle && webcrypto.subtle) globalThis.crypto.subtle = webcrypto.subtle;

function toArrayBuffer(buf) {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  return ab;
}

const WAD_PATH = "/Users/ahmadjalil/github/wewad/New Folder With Items/Wii Speak Channel [USA] (WiiLink).wad";

async function main() {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
  const { parseWAD } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/wad.js");
  const { parseU8 } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/u8.js");
  const { parseBRLYT } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/brlyt.js");
  const { parseBRLAN } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/brlan.js");
  const { decryptWadContents } = await server.ssrLoadModule("/src/lib/wadRenderer/pipeline/decryption.js");

  const logger = {
    info: () => {},
    warn: (...a) => console.warn("[WARN]", ...a),
    error: (...a) => console.error("[ERROR]", ...a),
    success: () => {},
  };

  const rawBuffer = readFileSync(WAD_PATH);
  const arrayBuffer = toArrayBuffer(rawBuffer);
  const wad = parseWAD(arrayBuffer, logger);
  console.log(`Title: ${wad.titleId}`);

  const decryptedContents = await decryptWadContents(wad, logger);
  if (!decryptedContents) {
    console.error("Decryption failed");
    await server.close();
    return;
  }

  // Find meta archive (content index 0)
  const metaAppName = wad.contentRecords.find(r => r.index === 0)?.name;
  const metaFiles = parseU8(decryptedContents[metaAppName], logger);

  // Find banner.bin
  const bannerEntry = Object.entries(metaFiles).find(([p]) => p.toLowerCase().includes("banner.bin"));
  if (!bannerEntry) {
    console.error("No banner.bin found. Files:", Object.keys(metaFiles));
    await server.close();
    return;
  }

  const bannerFiles = parseU8(bannerEntry[1], logger);
  console.log("\nBanner archive files:");
  for (const [path, data] of Object.entries(bannerFiles)) {
    console.log(`  ${path} (${data.byteLength} bytes)`);
  }

  // Parse BRLYT
  const brlytEntry = Object.entries(bannerFiles).find(([p]) => p.toLowerCase().endsWith(".brlyt"));
  if (!brlytEntry) {
    console.error("No .brlyt found");
    await server.close();
    return;
  }
  const layout = parseBRLYT(brlytEntry[1], logger);

  console.log(`\nLayout: ${layout.width}x${layout.height}`);
  console.log(`Textures: ${layout.textures.join(", ")}`);

  // Build parent-children map
  const childrenMap = new Map();
  for (const p of layout.panes) {
    if (p.parent) {
      if (!childrenMap.has(p.parent)) childrenMap.set(p.parent, []);
      childrenMap.get(p.parent).push(p);
    }
  }

  // Dump hierarchy
  console.log("\n=== PANE HIERARCHY ===\n");

  function walk(pane, depth = 0) {
    const prefix = "  ".repeat(depth);
    const sx = pane.scale?.x ?? 1;
    const sy = pane.scale?.y ?? 1;
    const scaleStr = (sx !== 1 || sy !== 1) ? ` SCALE=(${sx}, ${sy})` : "";
    const sizeStr = pane.size ? ` ${pane.size.w.toFixed(0)}x${pane.size.h.toFixed(0)}` : "";
    const visStr = pane.visible === false ? " [HIDDEN]" : "";
    const alphaStr = pane.alpha !== undefined && pane.alpha !== 255 ? ` alpha=${pane.alpha}` : "";
    const tx = (pane.translate?.x ?? 0).toFixed(1);
    const ty = (pane.translate?.y ?? 0).toFixed(1);
    const tz = (pane.translate?.z ?? 0).toFixed(1);

    let extra = "";
    if (pane.type === "txt1") {
      extra = ` text="${(pane.text || "").substring(0, 50)}"`;
      if (pane.textTopColor) extra += ` topCol=(${pane.textTopColor.r},${pane.textTopColor.g},${pane.textTopColor.b},${pane.textTopColor.a})`;
      if (pane.textBottomColor) extra += ` botCol=(${pane.textBottomColor.r},${pane.textBottomColor.g},${pane.textBottomColor.b},${pane.textBottomColor.a})`;
    }
    if (pane.type === "pic1" || pane.type === "wnd1") {
      const mat = layout.materials?.[pane.materialIndex];
      if (mat?.textureMaps?.length > 0) {
        const texNames = mat.textureMaps.map(tm => layout.textures?.[tm.textureIndex] ?? `?${tm.textureIndex}`);
        extra = ` tex=[${texNames.join(",")}]`;
      }
      if (pane.texCoords?.length > 0) {
        for (let i = 0; i < pane.texCoords.length; i++) {
          const tc = pane.texCoords[i];
          extra += ` tc${i}=[TL(${tc.tl.s.toFixed(2)},${tc.tl.t.toFixed(2)}) BR(${tc.br.s.toFixed(2)},${tc.br.t.toFixed(2)})]`;
        }
      }
    }

    const rot = pane.rotate;
    const rotStr = (rot && (rot.x || rot.y || rot.z)) ? ` rot=(${rot.x},${rot.y},${rot.z})` : "";

    console.log(`${prefix}${pane.type} "${pane.name}" pos=(${tx},${ty},${tz})${scaleStr}${sizeStr}${rotStr}${alphaStr}${visStr}${extra}`);

    const kids = childrenMap.get(pane.name) || [];
    for (const kid of kids) walk(kid, depth + 1);
  }

  const root = layout.panes.find(p => !p.parent) || layout.panes[0];
  walk(root);

  // Parse BRLANs for scale animations
  console.log("\n=== BRLAN ANIMATIONS ===\n");
  const brlanEntries = Object.entries(bannerFiles).filter(([p]) => p.toLowerCase().endsWith(".brlan"));
  for (const [brlanPath, brlanData] of brlanEntries) {
    const anim = parseBRLAN(brlanData, logger);
    console.log(`${brlanPath}: frameSize=${anim.frameSize}`);

    for (const paneAnim of anim.panes) {
      for (const tag of paneAnim.tags) {
        for (const entry of tag.entries) {
          // Show scale/position/alpha animations
          const kfSummary = entry.keyframes.length <= 6
            ? entry.keyframes.map(kf => `f${kf.frame}=${typeof kf.value === "number" ? kf.value.toFixed(2) : kf.value}`).join(", ")
            : `${entry.keyframes.length} kf, f${entry.keyframes[0].frame}-f${entry.keyframes[entry.keyframes.length - 1].frame}`;
          console.log(`  ${paneAnim.name} ${tag.type} ${entry.typeName}(0x${entry.type.toString(16)}): ${kfSummary}`);
        }
      }
    }
  }

  await server.close();
}

main().catch(e => { console.error(e); process.exit(1); });
