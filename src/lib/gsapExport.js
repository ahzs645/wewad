/**
 * GSAP Animation Export
 *
 * Exports Wii banner/icon animations as a GSAP-compatible bundle:
 * - Individual pane layer PNGs (with TEV/material effects baked in)
 * - Timeline JSON with per-frame sampled animation values
 * - Self-contained HTML player with GSAP from CDN
 * - ZIP bundle with all assets
 */

import { loadJSZip } from "./exportBundle";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canvasToPngBlob(canvas) {
  if (canvas.convertToBlob) {
    return canvas.convertToBlob({ type: "image/png" });
  }
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function createWavArrayBuffer(audio) {
  if (!audio?.pcm16?.length || !Number.isFinite(audio.sampleRate) || audio.sampleRate <= 0) {
    return null;
  }

  const channelCount = Math.max(1, audio.channelCount ?? audio.pcm16.length);
  const frameCount = Math.min(...audio.pcm16.map((ch) => ch.length));
  if (!Number.isFinite(frameCount) || frameCount <= 0) return null;

  const blockAlign = channelCount * 2;
  const byteRate = audio.sampleRate * blockAlign;
  const dataSize = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const encoder = new TextEncoder();

  const writeTag = (offset, tag) => {
    const bytes = encoder.encode(tag);
    for (let i = 0; i < bytes.length; i++) view.setUint8(offset + i, bytes[i]);
  };

  writeTag(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeTag(8, "WAVE");
  writeTag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeTag(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame++) {
    for (let ch = 0; ch < channelCount; ch++) {
      const channelData = audio.pcm16[ch] ?? audio.pcm16[audio.pcm16.length - 1];
      view.setInt16(offset, channelData?.[frame] ?? 0, true);
      offset += 2;
    }
  }

  return buffer;
}

function resolveIconViewport(layout) {
  if (!layout?.panes) return null;
  for (const pane of layout.panes) {
    const normalized = pane.name
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .toLowerCase();
    if (normalized.includes("icon") && normalized.includes("bg")) {
      return { width: Math.round(pane.size.w), height: Math.round(pane.size.h) };
    }
  }
  return null;
}

function computeOutputSize(layoutWidth, layoutHeight, displayAspect) {
  const referenceAspect = 4 / 3;
  const scaleX = displayAspect ? displayAspect / referenceAspect : 1;
  return {
    width: Math.round(layoutWidth * scaleX),
    height: layoutHeight,
  };
}

// ---------------------------------------------------------------------------
// Build Pane Hierarchy
// ---------------------------------------------------------------------------

function buildHierarchy(layout) {
  const panes = layout?.panes ?? [];
  const childrenMap = new Map();
  const roots = [];

  for (const pane of panes) {
    if (!childrenMap.has(pane.name)) {
      childrenMap.set(pane.name, []);
    }
  }

  for (const pane of panes) {
    if (pane.parent && childrenMap.has(pane.parent)) {
      childrenMap.get(pane.parent).push(pane.name);
    } else if (!pane.parent) {
      roots.push(pane.name);
    }
  }

  const hierarchy = [];
  for (const [name, children] of childrenMap) {
    if (children.length > 0) {
      hierarchy.push({ name, children });
    }
  }

  return { hierarchy, roots };
}

// ---------------------------------------------------------------------------
// Resolve blend mode for CSS mix-blend-mode
// ---------------------------------------------------------------------------

function resolveBlendModeForCss(pane, materials) {
  if (!Number.isInteger(pane?.materialIndex) || pane.materialIndex < 0 || pane.materialIndex >= materials.length) {
    return "normal";
  }

  const blendMode = materials[pane.materialIndex]?.blendMode;
  if (!blendMode) return "normal";

  if (blendMode.func === 0) return "normal";

  const src = blendMode.srcFactor & 0x7;
  const dst = blendMode.dstFactor & 0x7;

  if (blendMode.func === 1) {
    if (src === 4 && dst === 5) return "normal";
    if ((src === 1 && dst === 1) || (src === 4 && dst === 1)) return "lighter";
    if (src === 1 && dst === 0) return "normal";
    if (src === 0 && dst === 4) return "normal"; // destination-in — no CSS equivalent
    return "normal";
  }

  if (blendMode.func === 2 || blendMode.func === 3) return "difference";

  return "normal";
}

// ---------------------------------------------------------------------------
// Resolve origin for CSS transform-origin
// ---------------------------------------------------------------------------

function resolveOriginForCss(originValue) {
  if (!Number.isFinite(originValue)) return [0.5, 0.5];
  const origin = Math.trunc(originValue);
  if (origin < 0 || origin > 8) return [0.5, 0.5];
  const col = origin % 3;
  const row = Math.floor(origin / 3);
  return [col / 2, row / 2];
}

// ---------------------------------------------------------------------------
// Render a single pane in isolation to its own canvas
// ---------------------------------------------------------------------------

function renderPaneIsolated(renderer, pane, paneState, localPaneStates, layoutWidth, layoutHeight) {
  const width = Math.max(1, Math.ceil(Math.abs(paneState.width)));
  const height = Math.max(1, Math.ceil(Math.abs(paneState.height)));

  // Use a regular canvas (not OffscreenCanvas) for compatibility with drawPane
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Center the drawing context (pane drawing assumes centered origin)
  ctx.translate(width / 2, height / 2);

  // Apply origin offset
  const originOffset = renderer.getPaneOriginOffset(pane, paneState.width, paneState.height);
  if (originOffset.x !== 0 || originOffset.y !== 0) {
    ctx.translate(originOffset.x, originOffset.y);
  }

  // Draw the pane content (same logic as drawPaneWithResolvedState minus transforms)
  if (pane.type === "pic1" || pane.type === "wnd1") {
    if (renderer.shouldUseTevPipeline(pane)) {
      const tevResult = renderer.runTevPipeline(pane, paneState, paneState.width, paneState.height);
      if (tevResult) {
        renderer.drawTevResult(ctx, tevResult, paneState.width, paneState.height);
      }
    } else {
      const binding = renderer.getTextureBindingForPane(pane, paneState);
      if (binding) {
        renderer.drawPane(ctx, binding, pane, paneState, paneState.width, paneState.height);
      } else {
        renderer.drawVertexColoredPane(ctx, pane, paneState, paneState.width, paneState.height);
      }
    }
  } else if (pane.type === "txt1") {
    renderer.drawTextPane(ctx, pane, paneState.width, paneState.height);
  }

  return canvas;
}

// ---------------------------------------------------------------------------
// Detect which panes need multiple renders (appearance changes over time)
// ---------------------------------------------------------------------------

function detectAppearanceChangeFrames(renderer, paneName, totalFrames, sampleInterval = 10) {
  const changeFrames = [0];
  const paneAnim = renderer.animByPaneName.get(paneName);
  if (!paneAnim) return changeFrames;

  // Check for RLTP (texture pattern) — these are always step keyframes
  for (const tag of paneAnim.tags ?? []) {
    if (tag.type === "RLTP") {
      for (const entry of tag.entries ?? []) {
        for (const kf of entry.keyframes ?? []) {
          const f = Math.round(kf.frame);
          if (f > 0 && !changeFrames.includes(f)) {
            changeFrames.push(f);
          }
        }
      }
    }
  }

  // Check for RLVC/RLMC/RLTS changes by sampling at intervals
  const hasAppearanceAnims = (paneAnim.tags ?? []).some(
    (t) => t.type === "RLVC" || t.type === "RLMC" || t.type === "RLTS",
  );

  if (hasAppearanceAnims) {
    for (let f = sampleInterval; f < totalFrames; f += sampleInterval) {
      if (!changeFrames.includes(f)) {
        changeFrames.push(f);
      }
    }
    // Always include last frame
    const lastFrame = totalFrames - 1;
    if (!changeFrames.includes(lastFrame)) {
      changeFrames.push(lastFrame);
    }
  }

  changeFrames.sort((a, b) => a - b);
  return changeFrames;
}

// ---------------------------------------------------------------------------
// Sample animation timeline for all panes
// ---------------------------------------------------------------------------

function sampleTimeline(renderer, totalFrames) {
  const samples = new Map(); // paneName → { x: [], y: [], rotation: [], ... }
  const allPanes = renderer.layout.panes;

  for (let frame = 0; frame < totalFrames; frame++) {
    // Build local pane states for this frame (same as renderFrame)
    const localPaneStates = new Map();
    for (const pane of allPanes) {
      localPaneStates.set(pane, renderer.getLocalPaneState(pane, frame));
    }

    for (const pane of allPanes) {
      const state = localPaneStates.get(pane);
      if (!state) continue;

      if (!samples.has(pane.name)) {
        samples.set(pane.name, {
          x: [],
          y: [],
          rotation: [],
          scaleX: [],
          scaleY: [],
          opacity: [],
          visible: [],
          width: [],
          height: [],
        });
      }

      const s = samples.get(pane.name);
      s.x.push(round4(state.tx));
      s.y.push(round4(-state.ty)); // Flip Y for CSS
      s.rotation.push(round4(state.rotation));
      s.scaleX.push(round4(state.sx));
      s.scaleY.push(round4(state.sy));
      s.opacity.push(round4(state.alpha));
      s.visible.push(state.visible);
      s.width.push(round2(state.width));
      s.height.push(round2(state.height));
    }
  }

  return samples;
}

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

// ---------------------------------------------------------------------------
// Compact keyframe arrays — omit constant properties, use RLE for repeated values
// ---------------------------------------------------------------------------

function compactSamples(samplesMap) {
  const compacted = {};

  for (const [paneName, data] of samplesMap) {
    const paneData = {};
    for (const [prop, values] of Object.entries(data)) {
      // Skip properties that are constant throughout
      const allSame = values.every((v) => v === values[0]);
      if (allSame) {
        // Store as a single value (the player knows to treat scalars as constants)
        paneData[prop] = values[0];
        continue;
      }
      paneData[prop] = values;
    }
    compacted[paneName] = paneData;
  }

  return compacted;
}

// ---------------------------------------------------------------------------
// Build the timeline JSON
// ---------------------------------------------------------------------------

function buildTimelineJson(renderer, target, startSamples, loopSamples, layerInfo, options) {
  const layout = renderer.layout;
  const layoutWidth = layout.width ?? (target === "banner" ? 608 : 128);
  const layoutHeight = layout.height ?? (target === "banner" ? 456 : 128);

  const { hierarchy, roots } = buildHierarchy(layout);

  const layers = {};
  const renderablePanes = layout.panes.filter(
    (p) => p.type === "pic1" || p.type === "txt1" || p.type === "wnd1",
  );

  for (let i = 0; i < renderablePanes.length; i++) {
    const pane = renderablePanes[i];
    const info = layerInfo.get(pane.name);
    if (!info) continue;

    layers[pane.name] = {
      type: pane.type,
      images: info.images,
      width: pane.size?.w ?? 0,
      height: pane.size?.h ?? 0,
      origin: resolveOriginForCss(pane.origin),
      zIndex: i,
      blendMode: resolveBlendModeForCss(pane, layout.materials ?? []),
    };
  }

  const startAnim = renderer.startAnim;
  const loopAnim = renderer.loopAnim;
  const startFrames = startAnim?.frameSize ?? 0;
  const loopFrames = loopAnim?.frameSize ?? renderer.getFrameCountForAnim(renderer.anim);

  return {
    version: "1.0",
    type: target,
    width: layoutWidth,
    height: layoutHeight,
    fps: 60,
    start: startSamples ? {
      frames: startFrames,
      duration: round4(startFrames / 60),
    } : null,
    loop: {
      frames: loopFrames,
      duration: round4(loopFrames / 60),
    },
    hierarchy,
    roots,
    layers,
    startTimeline: startSamples ? compactSamples(startSamples) : null,
    loopTimeline: compactSamples(loopSamples),
  };
}

// ---------------------------------------------------------------------------
// Render all pane layers for a given renderer state
// ---------------------------------------------------------------------------

async function renderPaneLayers(renderer, frame, onProgress) {
  const allPanes = renderer.layout.panes;
  const renderablePanes = allPanes.filter(
    (p) => p.type === "pic1" || p.type === "txt1" || p.type === "wnd1",
  );

  renderer.applyFrame(frame);

  const localPaneStates = new Map();
  for (const pane of allPanes) {
    localPaneStates.set(pane, renderer.getLocalPaneState(pane, frame));
  }

  const layoutWidth = renderer.layout.width ?? 608;
  const layoutHeight = renderer.layout.height ?? 456;
  const layerInfo = new Map();

  for (let i = 0; i < renderablePanes.length; i++) {
    const pane = renderablePanes[i];
    const paneState = localPaneStates.get(pane);
    if (!paneState || paneState.width < 1 || paneState.height < 1) continue;

    try {
      const canvas = renderPaneIsolated(renderer, pane, paneState, localPaneStates, layoutWidth, layoutHeight);
      const blob = await canvasToPngBlob(canvas);
      const fileName = `layers/${pane.name}.png`;

      layerInfo.set(pane.name, {
        images: [fileName],
        blobs: [blob],
        canvas,
      });
    } catch {
      // Skip panes that fail to render
    }

    onProgress?.("layers", i + 1, renderablePanes.length);
  }

  return layerInfo;
}

// ---------------------------------------------------------------------------
// GSAP Player Script (standalone, no build tools needed)
// ---------------------------------------------------------------------------

function generatePlayerScript() {
  return `/**
 * WiiBannerPlayer — Lightweight GSAP-based player for WeWAD animation exports.
 * Requires GSAP 3.x loaded before this script.
 */
class WiiBannerPlayer {
  constructor(container, timeline, options = {}) {
    this.container = typeof container === "string" ? document.querySelector(container) : container;
    this.data = timeline;
    this.elements = {};
    this.masterTimeline = null;
    this.audioEl = options.audioElement || null;
    this.autoplay = options.autoplay !== false;
    this._build();
    if (this.autoplay) this.play();
  }

  _build() {
    const d = this.data;
    const root = document.createElement("div");
    root.className = "wii-banner-root";
    root.style.cssText = \`position:relative;width:\${d.width}px;height:\${d.height}px;overflow:hidden;background:#000;\`;

    // Centering wrapper (Wii coordinate origin is at layout center)
    const center = document.createElement("div");
    center.style.cssText = \`position:absolute;left:\${d.width / 2}px;top:\${d.height / 2}px;\`;
    root.appendChild(center);

    // Build pane elements in hierarchy
    const paneEls = {};
    const allPaneNames = new Set();

    // Collect all pane names from hierarchy
    for (const node of d.hierarchy || []) {
      allPaneNames.add(node.name);
      for (const child of node.children || []) allPaneNames.add(child);
    }
    for (const name of d.roots || []) allPaneNames.add(name);
    for (const name of Object.keys(d.layers || {})) allPaneNames.add(name);

    // Create elements for all panes
    for (const name of allPaneNames) {
      const el = document.createElement("div");
      el.className = "wii-pane";
      el.dataset.pane = name;
      el.style.cssText = "position:absolute;transform-origin:center center;";
      paneEls[name] = el;

      // If this is a renderable layer, add the image
      const layer = d.layers?.[name];
      if (layer && layer.images?.length > 0) {
        const img = document.createElement("img");
        img.src = layer.images[0];
        img.style.cssText = \`display:block;position:absolute;left:\${-layer.width / 2}px;top:\${-layer.height / 2}px;width:\${layer.width}px;height:\${layer.height}px;\`;
        img.draggable = false;
        if (layer.blendMode && layer.blendMode !== "normal") {
          el.style.mixBlendMode = layer.blendMode;
        }
        // Set transform-origin based on pane origin
        if (layer.origin) {
          el.style.transformOrigin = \`\${layer.origin[0] * 100}% \${layer.origin[1] * 100}%\`;
        }
        el.appendChild(img);
        el.style.zIndex = layer.zIndex ?? 0;
      }
    }

    // Build hierarchy: attach children to parents
    const attached = new Set();
    for (const node of d.hierarchy || []) {
      const parentEl = paneEls[node.name];
      if (!parentEl) continue;
      for (const childName of node.children || []) {
        const childEl = paneEls[childName];
        if (childEl) {
          parentEl.appendChild(childEl);
          attached.add(childName);
        }
      }
    }

    // Attach roots to center
    for (const rootName of d.roots || []) {
      const el = paneEls[rootName];
      if (el) {
        center.appendChild(el);
        attached.add(rootName);
      }
    }

    // Attach any unattached layers directly to center
    for (const name of Object.keys(d.layers || {})) {
      if (!attached.has(name) && paneEls[name]) {
        center.appendChild(paneEls[name]);
      }
    }

    this.container.innerHTML = "";
    this.container.appendChild(root);
    this.elements = paneEls;
    this._buildTimeline();
  }

  _buildTimeline() {
    const d = this.data;
    const fps = d.fps || 60;
    this.masterTimeline = gsap.timeline({ paused: true });

    const applyPhase = (phaseData, duration) => {
      if (!phaseData) return null;
      const tl = gsap.timeline();

      for (const [paneName, props] of Object.entries(phaseData)) {
        const el = this.elements[paneName];
        if (!el) continue;

        // Build GSAP keyframes from sampled data
        const frameCount = this._getFrameCount(props);
        if (frameCount <= 1) {
          // Static — just set properties
          this._setProps(el, props, 0);
          continue;
        }

        // Create per-property tweens using dense keyframes
        const frameDuration = duration / frameCount;

        // Batch all animated properties into a single tween for efficiency
        const keyframes = [];
        for (let i = 0; i < frameCount; i++) {
          const kf = { duration: i === 0 ? 0 : frameDuration };
          kf.x = this._val(props.x, i);
          kf.y = this._val(props.y, i);
          kf.rotation = this._val(props.rotation, i);
          kf.scaleX = this._val(props.scaleX, i);
          kf.scaleY = this._val(props.scaleY, i);
          kf.autoAlpha = this._val(props.opacity, i);
          const w = this._val(props.width, i);
          const h = this._val(props.height, i);
          if (w != null) kf.width = w;
          if (h != null) kf.height = h;
          kf.ease = "none";
          keyframes.push(kf);
        }

        tl.to(el, { keyframes }, 0);
      }

      return tl;
    };

    if (d.start && d.startTimeline) {
      const startTl = applyPhase(d.startTimeline, d.start.duration);
      if (startTl) this.masterTimeline.add(startTl);
    }

    if (d.loopTimeline) {
      const loopTl = applyPhase(d.loopTimeline, d.loop.duration);
      if (loopTl) {
        loopTl.repeat(-1);
        this.masterTimeline.add(loopTl);
      }
    }
  }

  _getFrameCount(props) {
    for (const v of Object.values(props)) {
      if (Array.isArray(v)) return v.length;
    }
    return 1;
  }

  _val(arr, i) {
    if (arr == null) return 0;
    if (!Array.isArray(arr)) return arr;
    return arr[i] ?? arr[arr.length - 1] ?? 0;
  }

  _setProps(el, props, i) {
    gsap.set(el, {
      x: this._val(props.x, i),
      y: this._val(props.y, i),
      rotation: this._val(props.rotation, i),
      scaleX: this._val(props.scaleX, i),
      scaleY: this._val(props.scaleY, i),
      autoAlpha: this._val(props.opacity, i),
    });
  }

  play() {
    this.masterTimeline?.play();
    if (this.audioEl) {
      this.audioEl.currentTime = 0;
      this.audioEl.play().catch(() => {});
    }
  }

  pause() {
    this.masterTimeline?.pause();
    this.audioEl?.pause();
  }

  restart() {
    this.masterTimeline?.restart();
    if (this.audioEl) {
      this.audioEl.currentTime = 0;
      this.audioEl.play().catch(() => {});
    }
  }

  destroy() {
    this.masterTimeline?.kill();
    this.container.innerHTML = "";
  }
}
`;
}

// ---------------------------------------------------------------------------
// Generate self-contained HTML
// ---------------------------------------------------------------------------

async function generateHtml(timelineData, layerBlobs, audioBlob, target) {
  const playerScript = generatePlayerScript();

  // Convert layer images to base64
  const imageBase64Map = {};
  for (const [paneName, info] of layerBlobs) {
    if (info.blobs?.[0]) {
      const b64 = await blobToBase64(info.blobs[0]);
      const fileName = `layers/${paneName}.png`;
      imageBase64Map[fileName] = b64;
    }
  }

  // Update timeline image paths to use base64
  const inlineTimeline = JSON.parse(JSON.stringify(timelineData));
  for (const [, layer] of Object.entries(inlineTimeline.layers ?? {})) {
    if (layer.images) {
      layer.images = layer.images.map((path) => imageBase64Map[path] ?? path);
    }
  }

  let audioHtml = "";
  let audioBase64 = "";
  if (audioBlob) {
    audioBase64 = await blobToBase64(audioBlob);
    audioHtml = `\n    <audio id="wii-audio" preload="auto"><source src="${audioBase64}" type="audio/wav"></audio>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wii ${target === "banner" ? "Banner" : "Icon"} Animation</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1a1a2e; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; font-family: system-ui, sans-serif; color: #e0e0e0; }
    .container { display: flex; flex-direction: column; align-items: center; gap: 16px; }
    #player { border: 2px solid #333; border-radius: 8px; overflow: hidden; }
    .controls { display: flex; gap: 12px; }
    .controls button { padding: 8px 20px; border: 1px solid #444; border-radius: 6px; background: #2a2a3e; color: #e0e0e0; cursor: pointer; font-size: 14px; }
    .controls button:hover { background: #3a3a5e; }
    .wii-pane img { image-rendering: auto; }
  </style>
</head>
<body>
  <div class="container">
    <div id="player"></div>${audioHtml}
    <div class="controls">
      <button onclick="player.restart()">Restart</button>
      <button onclick="player.pause()">Pause</button>
      <button onclick="player.play()">Play</button>
    </div>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"><\/script>
  <script>
${playerScript}
  const timelineData = ${JSON.stringify(inlineTimeline)};
  const player = new WiiBannerPlayer("#player", timelineData, {
    autoplay: true,
    ${audioBase64 ? 'audioElement: document.getElementById("wii-audio"),' : ""}
  });
  <\/script>
</body>
</html>`;
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// Main export orchestration
// ---------------------------------------------------------------------------

/**
 * Export GSAP animation bundle for a single target (banner or icon).
 */
async function exportTarget(BannerRenderer, result, animSelection, target, options, onProgress) {
  const layout = options.layout ?? result.renderLayout;
  const loopAnim = animSelection.loopAnim ?? animSelection.anim;
  const startAnim = animSelection.startAnim ?? null;
  const startFrameCount = startAnim?.frameSize ?? 0;
  const loopFrameCount = loopAnim?.frameSize ?? 120;

  const displayAspect = target === "banner" ? (options.displayAspect ?? 4 / 3) : null;
  const outSize = computeOutputSize(layout.width, layout.height, displayAspect);
  const offscreen = new OffscreenCanvas(outSize.width, outSize.height);

  const renderer = new BannerRenderer(offscreen, layout, animSelection.anim, result.tplImages, {
    startAnim,
    loopAnim,
    renderState: animSelection.renderState,
    playbackMode: "hold",
    displayAspect,
    tevQuality: options.tevQuality ?? "fast",
    fonts: result.fonts ?? {},
    titleLocale: options.titleLocale,
    paneStateSelections: options.paneStateSelections,
  });

  try {
    // --- Render pane layers at frame 0 ---
    onProgress?.("layers", 0, 1);
    renderer.applyFrame(0);
    const layerInfo = await renderPaneLayers(renderer, 0, onProgress);

    // --- Sample start animation ---
    let startSamples = null;
    if (startAnim && startFrameCount > 0) {
      onProgress?.("sampling-start", 0, startFrameCount);
      // Make sure we're in start phase
      if (renderer.phase !== "start") {
        renderer.setActiveAnim(startAnim, "start");
      }
      startSamples = sampleTimeline(renderer, startFrameCount);
      onProgress?.("sampling-start", startFrameCount, startFrameCount);

      // Transition to loop
      renderer.captureStartEndState();
      renderer.setActiveAnim(loopAnim, "loop");
    } else {
      // No start anim — set up loop directly
      if (renderer.phase !== "loop") {
        renderer.setActiveAnim(loopAnim, "loop");
      }
    }

    // --- Sample loop animation ---
    onProgress?.("sampling-loop", 0, loopFrameCount);
    const loopSamples = sampleTimeline(renderer, loopFrameCount);
    onProgress?.("sampling-loop", loopFrameCount, loopFrameCount);

    // --- Build timeline JSON ---
    const timelineJson = buildTimelineJson(renderer, target, startSamples, loopSamples, layerInfo, options);

    return { timelineJson, layerInfo };
  } finally {
    renderer.dispose();
  }
}

/**
 * Export a full GSAP animation bundle as a ZIP.
 *
 * @param {object} params
 * @param {object} params.parsed - Result from processWAD()
 * @param {string} params.sourceFileName - Original WAD filename
 * @param {Function} params.BannerRenderer - BannerRenderer class
 * @param {object} params.bannerAnimSelection - Banner animation selection
 * @param {object} params.iconAnimSelection - Icon animation selection
 * @param {object} params.rendererOptions - Extra renderer options
 * @param {object} params.audio - Audio data from parsed results
 * @param {string} params.exportAspect - Aspect ratio for banner
 * @param {Function} params.onProgress - Progress callback
 * @returns {Promise<Blob>} ZIP blob
 */
export async function exportGsapBundle({
  parsed,
  sourceFileName,
  BannerRenderer,
  bannerAnimSelection,
  iconAnimSelection,
  rendererOptions = {},
  exportAspect = "4:3",
  onProgress,
}) {
  onProgress?.("loading", 0, 1);
  const JSZip = await loadJSZip();
  const zip = new JSZip();

  const parseAspectNum = (a) => {
    if (typeof a === "number") return a;
    const s = String(a).trim();
    if (s === "4:3" || s === "4/3") return 4 / 3;
    if (s === "16:9" || s === "16/9") return 16 / 9;
    return 4 / 3;
  };

  const bannerResult = parsed.results.banner;
  const iconResult = parsed.results.icon;
  const audioData = parsed.results.audio;

  // --- Audio ---
  let audioBlob = null;
  if (audioData) {
    const wavBuffer = createWavArrayBuffer(audioData);
    if (wavBuffer) {
      audioBlob = new Blob([wavBuffer], { type: "audio/wav" });
      zip.file("audio.wav", wavBuffer);
    }
  }

  // --- Banner ---
  if (bannerResult && bannerAnimSelection?.anim) {
    onProgress?.("banner-layers", 0, 1);
    const { timelineJson, layerInfo } = await exportTarget(
      BannerRenderer, bannerResult, bannerAnimSelection, "banner",
      {
        ...rendererOptions,
        displayAspect: parseAspectNum(exportAspect),
      },
      (stage, current, total) => onProgress?.(`banner-${stage}`, current, total),
    );

    // Add layers to zip
    for (const [paneName, info] of layerInfo) {
      for (let i = 0; i < (info.blobs?.length ?? 0); i++) {
        zip.file(`banner/layers/${paneName}.png`, info.blobs[i]);
      }
    }

    // Add timeline JSON
    zip.file("banner/timeline.json", JSON.stringify(timelineJson, null, 2));

    // Generate self-contained HTML for banner
    const bannerHtml = await generateHtml(timelineJson, layerInfo, audioBlob, "banner");
    zip.file("banner/index.html", bannerHtml);
  }

  // --- Icon ---
  if (iconResult && iconAnimSelection?.anim) {
    onProgress?.("icon-layers", 0, 1);
    const iconExtraOpts = { ...rendererOptions };
    const iconViewport = resolveIconViewport(iconResult.renderLayout);
    if (iconViewport) {
      iconExtraOpts.layout = { ...iconResult.renderLayout, width: iconViewport.width, height: iconViewport.height };
    }

    const { timelineJson, layerInfo } = await exportTarget(
      BannerRenderer, iconResult, iconAnimSelection, "icon",
      iconExtraOpts,
      (stage, current, total) => onProgress?.(`icon-${stage}`, current, total),
    );

    for (const [paneName, info] of layerInfo) {
      for (let i = 0; i < (info.blobs?.length ?? 0); i++) {
        zip.file(`icon/layers/${paneName}.png`, info.blobs[i]);
      }
    }

    zip.file("icon/timeline.json", JSON.stringify(timelineJson, null, 2));

    const iconHtml = await generateHtml(timelineJson, layerInfo, null, "icon");
    zip.file("icon/index.html", iconHtml);
  }

  // --- Player script ---
  zip.file("player.js", generatePlayerScript());

  // --- Compress ---
  onProgress?.("compressing", 0, 1);
  const zipBlob = await zip.generateAsync({ type: "blob" });
  onProgress?.("done", 1, 1);
  return zipBlob;
}
