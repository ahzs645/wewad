/**
 * Diagnostic script: Trace Wii Shop Channel (v20) icon rendering state
 * at multiple animation frames, examining visibility, TEV pipeline decisions,
 * texture bindings, alpha propagation, and transform positions.
 *
 * Usage: node debug_icon_render.mjs
 */

import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { createServer } from "vite";

// Polyfill globalThis.crypto for Node.js (needed by shared/crypto.js)
if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.crypto.subtle && webcrypto.subtle) globalThis.crypto.subtle = webcrypto.subtle;

// ---------- Helpers ----------
function toArrayBuffer(nodeBuffer) {
  const ab = new ArrayBuffer(nodeBuffer.byteLength);
  const view = new Uint8Array(ab);
  view.set(new Uint8Array(nodeBuffer.buffer, nodeBuffer.byteOffset, nodeBuffer.byteLength));
  return ab;
}

function hr(title) {
  console.log("\n" + "=".repeat(78));
  console.log("  " + title);
  console.log("=".repeat(78));
}

function subhr(title) {
  console.log("\n  " + "-".repeat(70));
  console.log("  " + title);
  console.log("  " + "-".repeat(70));
}

// ---------- Main ----------
async function main() {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });

  // Load all required modules via Vite SSR
  const { parseWAD } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/wad.js");
  const { parseU8 } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/u8.js");
  const { parseBRLYT } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/brlyt.js");
  const { parseBRLAN } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/brlan.js");
  const { parseTPL } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/tpl.js");
  const { TPL_FORMATS, ANIM_TYPES } = await server.ssrLoadModule("/src/lib/wadRenderer/parsers/constants.js");
  const { decryptWadContents } = await server.ssrLoadModule("/src/lib/wadRenderer/pipeline/decryption.js");
  const { parseResourceSet, extractTargetResources } = await server.ssrLoadModule("/src/lib/wadRenderer/pipeline/resourceExtraction.js");
  const { createRenderableLayout } = await server.ssrLoadModule("/src/lib/wadRenderer/pipeline/layout.js");
  const {
    resolveAutoRenderState,
    findStateAnimationEntry,
    mergeRelatedRsoAnimations,
    shouldHoldStateAnimation,
    collectRenderStateOptions,
  } = await server.ssrLoadModule("/src/utils/renderState.js");
  const { resolveAnimationSelection, buildPaneAnimationMap, buildPaneChainResolver, getAnimatedPaneState } = await server.ssrLoadModule("/src/utils/animation.js");
  const { resolveIconViewport } = await server.ssrLoadModule("/src/utils/layout.js");
  const { interpolateKeyframes } = await server.ssrLoadModule("/src/lib/wadRenderer/animations.js");
  const { sampleAnimationEntryWithDataType, sampleDiscreteAnimationEntry, sampleAnimationEntry } = await server.ssrLoadModule("/src/lib/wadRenderer/bannerRenderer/animationSampling.js");

  // TEV-related imports
  const { evaluateTevPipeline, isTevIdentityPassthrough, isTevModulatePattern, getDefaultTevStages, getModulateTevStages } = await server.ssrLoadModule("/src/lib/wadRenderer/bannerRenderer/tevEvaluator.js");

  const logger = {
    info: () => {},
    warn: (...args) => console.warn("[WARN]", ...args),
    error: (...args) => console.error("[ERROR]", ...args),
    success: () => {},
  };

  const verboseLogger = {
    info: (...args) => console.log("[INFO]", ...args),
    warn: (...args) => console.warn("[WARN]", ...args),
    error: (...args) => console.error("[ERROR]", ...args),
    success: (...args) => console.log("[OK]", ...args),
  };

  const wadPath = "/Users/ahmadjalil/github/wewad/New Folder With Items/Wii Shop Channel (World) (v20) (Channel).wad";

  // ===== STEP 1: Parse WAD, decrypt, extract icon.bin =====
  hr("1. Parse WAD and Extract Icon");
  const rawBuffer = readFileSync(wadPath);
  const arrayBuffer = toArrayBuffer(rawBuffer);
  const wad = parseWAD(arrayBuffer, logger);
  console.log(`  Title ID: ${wad.titleId}`);

  const decryptedContents = await decryptWadContents(wad, logger);
  if (!decryptedContents) {
    console.error("  Decryption failed!");
    await server.close();
    process.exit(1);
  }

  const metaAppName = wad.contentRecords.find((r) => r.index === 0)?.name;
  const metaFiles = parseU8(decryptedContents[metaAppName], logger);
  const iconEntry = Object.entries(metaFiles).find(([p]) => p.toLowerCase().includes("icon.bin"));
  if (!iconEntry) {
    console.error("  icon.bin not found!");
    await server.close();
    process.exit(1);
  }
  const [iconPath, iconData] = iconEntry;
  console.log(`  Found: ${iconPath} (${iconData.byteLength} bytes)`);

  // ===== STEP 2: Parse icon resources =====
  hr("2. Parse Icon Resources (BRLYT, BRLANs, TPLs)");
  const iconFiles = parseU8(iconData, logger);
  console.log(`  Files in icon U8 archive:`);
  for (const [path, data] of Object.entries(iconFiles)) {
    console.log(`    ${path}  (${data.byteLength ?? 0} bytes)`);
  }

  // Use parseResourceSet for proper processing (same as pipeline)
  const parsedIcon = parseResourceSet(iconFiles, verboseLogger);
  const { tplImages, layout: rawLayout, anim, animStart, animLoop, animEntries, fonts } = parsedIcon;

  // Build renderable layout (same as processWAD does for icon target)
  const renderLayout = createRenderableLayout(rawLayout, tplImages, 128, 128, logger);

  // Construct the targetResult object that matches process.js output
  const targetResult = {
    tplImages,
    layout: rawLayout,
    anim,
    animStart,
    animLoop,
    animEntries,
    fonts,
    renderLayout,
  };

  // ===== STEP 3: Summarize parsed resources =====
  hr("3. Parsed Resources Summary");

  subhr("Layout Textures (txl1)");
  renderLayout.textures.forEach((t, i) => console.log(`    [${i}] ${t}`));

  subhr("TPL Images Available");
  for (const [name, images] of Object.entries(tplImages)) {
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const fmtName = TPL_FORMATS[img.format] ?? `fmt=${img.format}`;
      console.log(`    ${name} image[${i}]: ${img.width}x${img.height} (${fmtName})`);
    }
  }

  subhr("Layout Dimensions & Viewport");
  console.log(`    Raw layout: ${rawLayout.width}x${rawLayout.height}`);
  console.log(`    Render layout: ${renderLayout.width}x${renderLayout.height}`);
  const viewport = resolveIconViewport(renderLayout);
  console.log(`    Icon viewport: ${viewport.width}x${viewport.height}`);

  subhr("Pane Tree (name, type, visibility, alpha, size, position, parent)");
  for (const pane of renderLayout.panes) {
    const vis = pane.visible ? "visible" : "HIDDEN";
    const matStr = pane.materialIndex >= 0 ? `mat=${pane.materialIndex}` : "no-mat";
    const sizeStr = `${pane.size.w.toFixed(0)}x${pane.size.h.toFixed(0)}`;
    const posStr = `(${pane.translate.x.toFixed(1)},${pane.translate.y.toFixed(1)},${pane.translate.z.toFixed(1)})`;
    const parentStr = pane.parent ?? "ROOT";
    const flags = `flags=0x${(pane.flags ?? 0).toString(16).padStart(2, "0")}`;
    console.log(`    [${pane.type}] ${pane.name}  ${vis} alpha=${pane.alpha} ${sizeStr} ${posStr} ${matStr} parent=${parentStr} ${flags}`);
  }

  subhr("Animation Files");
  console.log(`    animEntries count: ${animEntries.length}`);
  for (const entry of animEntries) {
    console.log(`      id="${entry.id}" role=${entry.role} state=${entry.state ?? "null"} frameSize=${entry.frameSize} panes=${entry.paneCount}`);
    if (entry.anim?.timgNames?.length > 0) {
      console.log(`        timg names: [${entry.anim.timgNames.join(", ")}]`);
    }
  }
  console.log(`    animStart: ${animStart ? `frameSize=${animStart.frameSize}, ${animStart.panes.length} panes` : "null"}`);
  console.log(`    animLoop: ${animLoop ? `frameSize=${animLoop.frameSize}, ${animLoop.panes.length} panes` : "null"}`);
  console.log(`    anim (generic): ${anim ? `frameSize=${anim.frameSize}, ${anim.panes.length} panes` : "null"}`);

  subhr("Groups");
  for (const grp of renderLayout.groups ?? []) {
    console.log(`    ${grp.name}: [${grp.paneNames.join(", ")}]`);
  }

  // ===== STEP 4: Animation Selection Pipeline =====
  hr("4. Animation Selection Pipeline");
  const autoState = resolveAutoRenderState(targetResult);
  console.log(`    resolveAutoRenderState -> ${autoState}`);

  const stateOptions = collectRenderStateOptions(targetResult);
  console.log(`    collectRenderStateOptions -> [${stateOptions.join(", ")}]`);

  const animSelection = resolveAnimationSelection(targetResult, null);
  console.log(`    resolveAnimationSelection(null):`);
  console.log(`      anim: ${animSelection.anim ? `frameSize=${animSelection.anim.frameSize}` : "null"}`);
  console.log(`      startAnim: ${animSelection.startAnim ? `frameSize=${animSelection.startAnim.frameSize}` : "null"}`);
  console.log(`      loopAnim: ${animSelection.loopAnim ? `frameSize=${animSelection.loopAnim.frameSize}` : "null"}`);
  console.log(`      renderState: ${animSelection.renderState}`);
  console.log(`      playbackMode: ${animSelection.playbackMode}`);

  // ===== STEP 5: RSO Merge =====
  hr("5. RSO Animation Merge");
  if (autoState && animSelection.loopAnim) {
    const mergedLoop = mergeRelatedRsoAnimations(animSelection.loopAnim, targetResult, autoState);
    if (mergedLoop !== animSelection.loopAnim) {
      console.log(`    Merged RSO animations into loop!`);
      console.log(`      Original pane count: ${animSelection.loopAnim.panes.length}`);
      console.log(`      Merged pane count: ${mergedLoop.panes.length}`);
      const origNames = new Set(animSelection.loopAnim.panes.map(p => p.name));
      const mergedNames = new Set(mergedLoop.panes.map(p => p.name));
      const added = [...mergedNames].filter(n => !origNames.has(n));
      if (added.length > 0) {
        console.log(`      Added panes: [${added.join(", ")}]`);
      }
      if (mergedLoop.timgNames?.length > 0) {
        console.log(`      Merged timg names: [${mergedLoop.timgNames.join(", ")}]`);
      }
    } else {
      console.log(`    No RSO merge needed (same object returned)`);
    }
  } else {
    console.log(`    No RSO state or no loop anim, skipping merge`);
  }

  // ===== STEP 6: Check icon_bg02.tpl registration =====
  hr("6. icon_bg02.tpl Registration Check");
  const hasIconBg02InLayout = renderLayout.textures.includes("icon_bg02.tpl");
  const hasIconBg02InTpl = "icon_bg02.tpl" in tplImages;
  console.log(`    icon_bg02.tpl in layout.textures: ${hasIconBg02InLayout} (index=${renderLayout.textures.indexOf("icon_bg02.tpl")})`);
  console.log(`    icon_bg02.tpl in tplImages: ${hasIconBg02InTpl}`);
  console.log(`    icon_bg01.tpl in layout.textures: ${renderLayout.textures.includes("icon_bg01.tpl")} (index=${renderLayout.textures.indexOf("icon_bg01.tpl")})`);

  // Check timg names across all animations for icon_bg02.tpl
  for (const entry of animEntries) {
    if (entry.anim?.timgNames?.includes("icon_bg02.tpl")) {
      console.log(`    icon_bg02.tpl referenced in anim: ${entry.id}`);
    }
  }

  // The BannerRenderer constructor registers timg names into layout.textures.
  // We need to simulate that here.
  const effectiveLoopAnim = animSelection.loopAnim;
  const effectiveStartAnim = animSelection.startAnim;
  const effectiveAnim = animSelection.anim;

  // Simulate BannerRenderer constructor timg registration
  const layoutCopy = { ...renderLayout, textures: [...renderLayout.textures] };
  for (const animObj of [effectiveStartAnim, effectiveLoopAnim, effectiveAnim]) {
    for (const timgName of animObj?.timgNames ?? []) {
      if (timgName && !layoutCopy.textures.includes(timgName)) {
        layoutCopy.textures.push(timgName);
        console.log(`    Registered timg "${timgName}" into layout.textures at index ${layoutCopy.textures.length - 1}`);
      }
    }
  }
  console.log(`    Final layout.textures after timg registration: [${layoutCopy.textures.join(", ")}]`);

  // ===== STEP 7: Material analysis for TEV pipeline decisions =====
  hr("7. Material & TEV Pipeline Analysis");

  // Helper: check TEV pipeline decision (replicate shouldUseTevPipeline logic)
  function isAlphaCompareAlwaysPass(alphaCompare) {
    if (!alphaCompare) return true;
    const alwaysPasses = (cond, ref) => {
      if (cond === 7) return true;
      if (cond === 6 && ref === 0) return true;
      if (cond === 3 && ref === 255) return true;
      return false;
    };
    const pass0 = alwaysPasses(alphaCompare.condition0, alphaCompare.value0);
    const pass1 = alwaysPasses(alphaCompare.condition1, alphaCompare.value1);
    if (pass0 && pass1) return true;
    if (alphaCompare.operation === 1 && (pass0 || pass1)) return true;
    return false;
  }

  function isTevAlphaAlwaysZero(stages) {
    if (!stages || stages.length !== 1) return false;
    const s = stages[0];
    return s.tevBiasA === 3 && s.dA === 7 && s.cA === 5;
  }

  function analyzeTevDecision(pane) {
    if (!Number.isInteger(pane?.materialIndex) || pane.materialIndex < 0) {
      return { useTev: false, reason: "no material" };
    }
    const material = layoutCopy.materials?.[pane.materialIndex];
    if (!material) return { useTev: false, reason: "material not found" };

    const needsAlphaCompare = !isAlphaCompareAlwaysPass(material.alphaCompare);
    const stages = material.tevStages;
    const hasExplicit = stages && stages.length > 0;
    const texMaps = material.textureMaps ?? [];

    if (hasExplicit) {
      if (isTevIdentityPassthrough(stages) && !needsAlphaCompare)
        return { useTev: false, reason: "identity passthrough" };
      if (texMaps.length <= 1 && isTevModulatePattern(stages) && !needsAlphaCompare)
        return { useTev: false, reason: "single-tex modulate" };
      if (isTevAlphaAlwaysZero(stages) && !needsAlphaCompare)
        return { useTev: false, reason: "TEV alpha always zero -> heuristic" };
      return { useTev: true, reason: `${stages.length} TEV stages${needsAlphaCompare ? " + alpha compare" : ""}` };
    }

    if (needsAlphaCompare) return { useTev: true, reason: "alpha compare only (default stages)" };
    return { useTev: false, reason: "no explicit stages, no alpha compare" };
  }

  // Analyze each pic1/wnd1 pane's material
  const drawablePanes = layoutCopy.panes.filter(p => p.type === "pic1" || p.type === "wnd1" || p.type === "txt1");
  for (const pane of drawablePanes) {
    const tevResult = analyzeTevDecision(pane);
    const mat = layoutCopy.materials?.[pane.materialIndex];
    const texNames = (mat?.textureMaps ?? []).map(tm => {
      const idx = tm.textureIndex;
      return idx < layoutCopy.textures.length ? layoutCopy.textures[idx] : `idx=${idx}`;
    });
    console.log(`    ${pane.name} [${pane.type}]: ${tevResult.useTev ? "TEV PIPELINE" : "HEURISTIC"} (${tevResult.reason})`);
    console.log(`      textures: [${texNames.join(", ")}]`);
    if (mat?.tevStages?.length > 0) {
      for (let i = 0; i < mat.tevStages.length; i++) {
        const s = mat.tevStages[i];
        console.log(`      stage ${i}: color(a=${s.aC} b=${s.bC} c=${s.cC} d=${s.dC} op=${s.tevOpC} bias=${s.tevBiasC} scale=${s.tevScaleC} reg=${s.tevRegIdC} kSel=${s.kColorSelC}) alpha(a=${s.aA} b=${s.bA} c=${s.cA} d=${s.dA} op=${s.tevOpA} bias=${s.tevBiasA} scale=${s.tevScaleA} reg=${s.tevRegIdA} kSel=${s.kAlphaSelA})`);
      }
    }
    if (mat?.alphaCompare) {
      const ac = mat.alphaCompare;
      console.log(`      alphaCompare: cond0=${ac.condition0} cond1=${ac.condition1} op=${ac.operation} val0=${ac.value0} val1=${ac.value1}`);
    }
  }

  // ===== STEP 8: Frame-by-frame rendering trace =====
  hr("8. Frame-by-Frame Rendering Trace");

  // Determine which animation to use for tracing
  // For icon, there's typically just one BRLAN (no start/loop split)
  const traceAnim = effectiveAnim ?? effectiveLoopAnim ?? effectiveStartAnim;
  if (!traceAnim) {
    console.log("    No animation available for tracing!");
    await server.close();
    return;
  }

  const frameSize = traceAnim.frameSize;
  console.log(`    Using animation: frameSize=${frameSize}`);

  // Build animation pane map
  const animByPaneName = new Map();
  for (const pa of traceAnim.panes ?? []) {
    animByPaneName.set(pa.name, pa);
  }

  // Build pane-by-name lookup
  const panesByName = new Map();
  for (const pane of layoutCopy.panes) {
    if (!panesByName.has(pane.name)) panesByName.set(pane.name, pane);
  }

  // Build pane chains (root -> pane)
  function getPaneChain(pane) {
    const chain = [];
    const seen = new Set();
    let current = pane;
    while (current && !seen.has(current.name)) {
      chain.push(current);
      seen.add(current.name);
      if (!current.parent) break;
      current = panesByName.get(current.parent);
    }
    chain.reverse();
    return chain;
  }

  // Sample a single pane's animated values at a given frame
  function samplePaneAnimValues(paneName, frame) {
    const result = {
      transX: null, transY: null, transZ: null,
      rotX: null, rotY: null, rotZ: null,
      scaleX: null, scaleY: null,
      alpha: null, visible: null,
      width: null, height: null,
      textureIndex: null,
    };

    const paneAnim = animByPaneName.get(paneName);
    if (!paneAnim) return result;

    for (const tag of paneAnim.tags ?? []) {
      const tagType = String(tag?.type ?? "");
      for (const entry of tag.entries ?? []) {
        if (tagType === "RLPA" || !tagType) {
          const value = sampleAnimationEntryWithDataType(entry, frame, frameSize);
          if (value == null) continue;
          switch (entry.type) {
            case 0x00: result.transX = value; break;
            case 0x01: result.transY = value; break;
            case 0x02: result.transZ = value; break;
            case 0x03: result.rotX = value; break;
            case 0x04: result.rotY = value; break;
            case 0x05: result.rotZ = value; break;
            case 0x06: result.scaleX = value; break;
            case 0x07: result.scaleY = value; break;
            case 0x08: result.width = value; break;
            case 0x09: result.height = value; break;
            case 0x0a: result.alpha = value; break;
          }
        } else if (tagType === "RLVC") {
          if (entry.type === 0x10) {
            const value = sampleAnimationEntryWithDataType(entry, frame, frameSize);
            if (value != null) result.alpha = value;
          }
        } else if (tagType === "RLVI") {
          if (entry.type === 0x00) {
            const value = sampleDiscreteAnimationEntry(entry, frame, frameSize);
            if (value != null) result.visible = value >= 0.5;
          }
        } else if (tagType === "RLTP") {
          if (entry.type === 0x00) {
            const texIdx = sampleDiscreteAnimationEntry(entry, frame, frameSize);
            if (texIdx != null) {
              const rawTimgIdx = Math.max(0, Math.floor(texIdx));
              const timgNames = traceAnim.timgNames;
              if (timgNames && rawTimgIdx < timgNames.length) {
                const timgName = timgNames[rawTimgIdx];
                const layoutIdx = layoutCopy.textures.indexOf(timgName);
                result.textureIndex = layoutIdx >= 0 ? layoutIdx : rawTimgIdx;
              } else {
                result.textureIndex = rawTimgIdx;
              }
            }
          }
        }
      }
    }
    return result;
  }

  // Compute effective transform position for a pane in viewport
  function computeEffectivePosition(pane, frame) {
    const chain = getPaneChain(pane);
    let x = layoutCopy.width / 2;
    let y = layoutCopy.height / 2;

    for (const chainPane of chain) {
      const anim = samplePaneAnimValues(chainPane.name, frame);
      const tx = anim.transX ?? chainPane.translate?.x ?? 0;
      const ty = anim.transY ?? chainPane.translate?.y ?? 0;
      const sx = anim.scaleX ?? chainPane.scale?.x ?? 1;
      const sy = anim.scaleY ?? chainPane.scale?.y ?? 1;

      x += tx * sx;
      y -= ty * sy; // Canvas Y is inverted
    }
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  }

  // Compute effective alpha through the chain
  function computeEffectiveAlpha(pane, frame) {
    const chain = getPaneChain(pane);
    let alpha = 1;
    let visible = true;

    for (const chainPane of chain) {
      const anim = samplePaneAnimValues(chainPane.name, frame);
      const hasAnimatedAlpha = anim.alpha != null;
      const animVisible = anim.visible;

      let paneAlpha;
      if (animVisible === false) {
        paneAlpha = 0;
      } else if (hasAnimatedAlpha) {
        paneAlpha = Math.max(0, Math.min(1, anim.alpha / 255));
      } else if (animVisible === true || chainPane.visible !== false) {
        paneAlpha = (chainPane.alpha ?? 255) / 255;
      } else {
        paneAlpha = 0;
      }

      // Check propagatesAlpha flag
      const propagates = (chainPane.flags & 0x02) !== 0 ||
        chainPane.type === "pic1" || chainPane.type === "txt1" ||
        chainPane.type === "bnd1" || chainPane.type === "wnd1";

      if (chainPane === pane || propagates) {
        alpha *= paneAlpha;
      }

      if (paneAlpha <= 0) {
        visible = false;
      }
    }

    return { alpha: Math.max(0, Math.min(1, alpha)), visible: visible && alpha > 0 };
  }

  // Get the bound texture name at a given frame
  function getTextureAtFrame(pane, frame) {
    if (!Number.isInteger(pane?.materialIndex) || pane.materialIndex < 0) return null;
    const mat = layoutCopy.materials?.[pane.materialIndex];
    if (!mat?.textureMaps?.length) return null;

    const anim = samplePaneAnimValues(pane.name, frame);
    const texMaps = mat.textureMaps;
    const results = [];

    for (let i = 0; i < texMaps.length; i++) {
      let texIdx = (anim.textureIndex != null && i === 0) ? anim.textureIndex : texMaps[i].textureIndex;
      const texName = texIdx < layoutCopy.textures.length ? layoutCopy.textures[texIdx] : `idx=${texIdx}`;
      const available = texName in tplImages || tplImages[texName] !== undefined;
      results.push({ name: texName, index: texIdx, available });
    }
    return results;
  }

  // Trace specific frames
  const traceFrames = [0, 100, 200, 300, 400, 500];

  for (const frame of traceFrames) {
    subhr(`Frame ${frame} / ${frameSize}`);

    const visiblePanes = [];
    const hiddenPanes = [];

    for (const pane of layoutCopy.panes) {
      if (pane.type !== "pic1" && pane.type !== "wnd1" && pane.type !== "txt1") continue;

      const { alpha, visible } = computeEffectiveAlpha(pane, frame);
      const textures = getTextureAtFrame(pane, frame);
      const tevDecision = analyzeTevDecision(pane);
      const animVals = samplePaneAnimValues(pane.name, frame);

      // Effective width/height
      const w = animVals.width ?? pane.size?.w ?? 0;
      const h = animVals.height ?? pane.size?.h ?? 0;

      const paneInfo = {
        name: pane.name,
        type: pane.type,
        alpha: alpha.toFixed(3),
        visible,
        width: w.toFixed(0),
        height: h.toFixed(0),
        textures,
        tevPath: tevDecision.useTev ? "TEV" : "heuristic",
        tevReason: tevDecision.reason,
        animVisible: animVals.visible,
        animAlpha: animVals.alpha,
        animTexIdx: animVals.textureIndex,
      };

      if (visible && alpha > 0.001) {
        visiblePanes.push(paneInfo);
      } else {
        hiddenPanes.push(paneInfo);
      }
    }

    console.log(`\n    VISIBLE PANES (${visiblePanes.length}):`);
    for (const p of visiblePanes) {
      const texStr = p.textures ? p.textures.map(t => `${t.name}${t.available ? "" : " [MISSING]"}`).join(", ") : "none";
      console.log(`      ${p.name} [${p.type}] alpha=${p.alpha} ${p.width}x${p.height} ${p.tevPath}(${p.tevReason})`);
      console.log(`        textures: [${texStr}]`);
      if (p.animTexIdx != null) console.log(`        animated texIdx=${p.animTexIdx}`);
      if (p.animAlpha != null) console.log(`        animated alpha=${p.animAlpha.toFixed(1)}`);
      if (p.animVisible != null) console.log(`        animated visible=${p.animVisible}`);
    }

    console.log(`\n    HIDDEN PANES (${hiddenPanes.length}):`);
    for (const p of hiddenPanes) {
      const reason = p.animVisible === false ? "RLVI hidden" :
                     p.animAlpha != null && p.animAlpha <= 0 ? `RLVC alpha=${p.animAlpha}` :
                     p.alpha === "0.000" ? "chain alpha=0" : "static hidden";
      console.log(`      ${p.name} alpha=${p.alpha} (${reason})`);
    }
  }

  // ===== STEP 9: Specific bg_wiiplane_00 deep dive =====
  hr("9. bg_wiiplane_00 Deep Dive");
  const bgPlane = panesByName.get("bg_wiiplane_00");
  if (bgPlane) {
    console.log(`    Found: type=${bgPlane.type} mat=${bgPlane.materialIndex} visible=${bgPlane.visible} alpha=${bgPlane.alpha}`);
    console.log(`    size: ${bgPlane.size.w}x${bgPlane.size.h}`);
    console.log(`    translate: (${bgPlane.translate.x}, ${bgPlane.translate.y}, ${bgPlane.translate.z})`);
    console.log(`    parent: ${bgPlane.parent ?? "ROOT"}`);

    const mat = layoutCopy.materials?.[bgPlane.materialIndex];
    if (mat) {
      console.log(`    Material: "${mat.name}" flags=0x${mat.flags.toString(16)}`);
      console.log(`      texMaps: ${mat.textureMaps.length}`);
      for (let i = 0; i < mat.textureMaps.length; i++) {
        const tm = mat.textureMaps[i];
        const texName = tm.textureIndex < layoutCopy.textures.length ? layoutCopy.textures[tm.textureIndex] : `idx=${tm.textureIndex}`;
        const avail = texName in tplImages;
        console.log(`        [${i}] ${texName} (idx=${tm.textureIndex}) available=${avail}`);
      }
      console.log(`      tevColors/kColors: ${mat.tevColors.length}`);
      for (let i = 0; i < mat.tevColors.length; i++) {
        const k = mat.tevColors[i];
        console.log(`        kColor[${i}]: (${k.r}, ${k.g}, ${k.b}, ${k.a})`);
      }
      console.log(`      color1 (C0): [${mat.color1.join(",")}]`);
      console.log(`      color2 (C1): [${mat.color2.join(",")}]`);
      console.log(`      color3 (C2): [${mat.color3.join(",")}]`);
    }

    // Trace bg_wiiplane_00 animation across frames
    const bgAnimPane = animByPaneName.get("bg_wiiplane_00");
    if (bgAnimPane) {
      console.log(`\n    Animation tags for bg_wiiplane_00:`);
      for (const tag of bgAnimPane.tags ?? []) {
        console.log(`      ${tag.type}: ${tag.entries.length} entries`);
        for (const entry of tag.entries) {
          const kfStr = entry.keyframes.length <= 6
            ? entry.keyframes.map(k => `f${k.frame}=${typeof k.value === 'number' ? (k.value % 1 !== 0 ? k.value.toFixed(2) : k.value) : k.value}`).join(", ")
            : `${entry.keyframes.length} keyframes f${entry.keyframes[0].frame}-f${entry.keyframes[entry.keyframes.length-1].frame}`;
          console.log(`        type=0x${entry.type.toString(16)} "${entry.typeName ?? ''}" grp=${entry.targetGroup}: ${kfStr}`);
        }
      }

      console.log(`\n    bg_wiiplane_00 per-frame state:`);
      for (const frame of [0, 100, 200, 300, 332, 400, 500]) {
        const anim = samplePaneAnimValues("bg_wiiplane_00", frame);
        const { alpha, visible } = computeEffectiveAlpha(bgPlane, frame);
        const textures = getTextureAtFrame(bgPlane, frame);
        const texStr = textures ? textures.map(t => `${t.name}${t.available ? "" : " [MISSING]"}`).join(", ") : "none";
        console.log(`      f${frame}: vis=${visible} alpha=${alpha.toFixed(3)} animVis=${anim.visible} animAlpha=${anim.alpha != null ? anim.alpha.toFixed(1) : "null"} texIdx=${anim.textureIndex} textures=[${texStr}]`);
      }
    } else {
      console.log(`    No animation entries for bg_wiiplane_00`);
    }
  } else {
    console.log(`    bg_wiiplane_00 NOT FOUND in layout`);
  }

  // ===== STEP 10: Pane position check within viewport =====
  hr("10. Pane Positions Relative to 128x96 Viewport (Frame 0)");
  const vpW = viewport.width;
  const vpH = viewport.height;
  console.log(`    Viewport: ${vpW}x${vpH}`);

  for (const pane of layoutCopy.panes) {
    if (pane.type !== "pic1" && pane.type !== "wnd1") continue;
    const { alpha, visible } = computeEffectiveAlpha(pane, 0);
    if (!visible) continue;

    // Simple position: layout center + cumulative translate
    const chain = getPaneChain(pane);
    let tx = 0, ty = 0;
    for (const cp of chain) {
      tx += cp.translate?.x ?? 0;
      ty += cp.translate?.y ?? 0;
    }
    const cx = vpW / 2 + tx;
    const cy = vpH / 2 - ty; // Invert Y for canvas
    const w = pane.size?.w ?? 0;
    const h = pane.size?.h ?? 0;
    const left = cx - w / 2;
    const top = cy - h / 2;
    const right = cx + w / 2;
    const bottom = cy + h / 2;
    const inBounds = left < vpW && right > 0 && top < vpH && bottom > 0;
    console.log(`    ${pane.name}: center=(${cx.toFixed(1)}, ${cy.toFixed(1)}) bounds=[${left.toFixed(0)},${top.toFixed(0)} - ${right.toFixed(0)},${bottom.toFixed(0)}] ${inBounds ? "IN VIEWPORT" : "OUT OF VIEWPORT"}`);
  }

  // ===== STEP 11: Frame 0 summary =====
  hr("11. What the Icon Looks Like at Frame 0");
  console.log(`    Viewport: ${vpW}x${vpH}`);

  const frame0Visible = [];
  for (const pane of layoutCopy.panes) {
    if (pane.type !== "pic1" && pane.type !== "wnd1" && pane.type !== "txt1") continue;
    const { alpha, visible } = computeEffectiveAlpha(pane, 0);
    if (visible && alpha > 0.001) {
      const textures = getTextureAtFrame(pane, 0);
      const texStr = textures ? textures.map(t => t.name).join(", ") : "none";
      frame0Visible.push({ name: pane.name, type: pane.type, alpha, texStr });
    }
  }
  console.log(`\n    Visible panes at frame 0 (${frame0Visible.length}):`);
  for (const p of frame0Visible) {
    console.log(`      ${p.name} [${p.type}] alpha=${p.alpha.toFixed(3)} textures=[${p.texStr}]`);
  }

  // Check which are hidden and why
  const frame0Hidden = [];
  for (const pane of layoutCopy.panes) {
    if (pane.type !== "pic1" && pane.type !== "wnd1" && pane.type !== "txt1") continue;
    const { alpha, visible } = computeEffectiveAlpha(pane, 0);
    if (!visible || alpha <= 0.001) {
      const animVals = samplePaneAnimValues(pane.name, 0);
      frame0Hidden.push({
        name: pane.name,
        staticVisible: pane.visible,
        staticAlpha: pane.alpha,
        animVisible: animVals.visible,
        animAlpha: animVals.alpha,
      });
    }
  }
  console.log(`\n    Hidden panes at frame 0 (${frame0Hidden.length}):`);
  for (const p of frame0Hidden) {
    const reason =
      p.animVisible === false ? "RLVI=hidden" :
      p.animAlpha != null && p.animAlpha <= 0 ? `animAlpha=${p.animAlpha}` :
      !p.staticVisible ? "BRLYT hidden" :
      p.staticAlpha === 0 ? "BRLYT alpha=0" : "parent chain alpha=0";
    console.log(`      ${p.name}: ${reason} (static: vis=${p.staticVisible} alpha=${p.staticAlpha}, anim: vis=${p.animVisible} alpha=${p.animAlpha})`);
  }

  // ===== STEP 12: RLMC animation check for bg_wiiplane_00 kColors =====
  hr("12. RLMC Animation for bg_wiiplane_00 kColors");
  const bgAnimPane = animByPaneName.get("bg_wiiplane_00");
  if (bgAnimPane) {
    for (const tag of bgAnimPane.tags ?? []) {
      if (tag.type !== "RLMC") continue;
      for (const entry of tag.entries) {
        const type = entry.type;
        let label = `type=0x${type.toString(16)}`;
        if (type >= 0x00 && type <= 0x03) label += ` (matColor.${["R","G","B","A"][type]})`;
        else if (type >= 0x04 && type <= 0x07) label += ` (C0/color1.${["R","G","B","A"][type-4]})`;
        else if (type >= 0x08 && type <= 0x0b) label += ` (C1/color2.${["R","G","B","A"][type-8]})`;
        else if (type >= 0x0c && type <= 0x0f) label += ` (C2/color3.${["R","G","B","A"][type-0xc]})`;
        else if (type >= 0x10 && type <= 0x1f) label += ` (kColor[${Math.floor((type-0x10)/4)}].${["R","G","B","A"][(type-0x10)%4]})`;

        const samples = [0, 100, 200, 300, 400, 500].map(f => {
          const val = sampleAnimationEntryWithDataType(entry, f, frameSize);
          return `f${f}=${val != null ? val.toFixed(1) : "null"}`;
        }).join(", ");
        console.log(`    ${label}: ${samples}`);
      }
    }
  }

  hr("DIAGNOSTIC COMPLETE");
  await server.close();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
