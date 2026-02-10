import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BannerRenderer,
  TPL_FORMATS,
  flattenTextures,
  interpolateKeyframes,
  processWAD,
} from "./lib/wadRenderer";

function createArrayLogger(storage) {
  return {
    clear() {
      storage.length = 0;
    },
    info(message) {
      storage.push({ level: "info", message });
    },
    warn(message) {
      storage.push({ level: "warn", message });
    },
    error(message) {
      storage.push({ level: "error", message });
    },
    success(message) {
      storage.push({ level: "success", message });
    },
  };
}

function formatLayoutInfo(layout) {
  if (!layout) {
    return "No layout data parsed yet.";
  }

  const lines = [];
  lines.push(`Layout size: ${layout.width}x${layout.height}`);
  lines.push(`Textures: ${layout.textures.join(", ") || "none"}`);
  lines.push(`Materials: ${layout.materials.map((material) => material.name).join(", ") || "none"}`);
  lines.push("");

  for (const pane of layout.panes) {
    const parts = [
      `[${pane.type}] ${pane.name}`,
      `pos(${pane.translate.x.toFixed(1)}, ${pane.translate.y.toFixed(1)})`,
      `scale(${pane.scale.x.toFixed(2)}, ${pane.scale.y.toFixed(2)})`,
      `size(${pane.size.w.toFixed(0)}x${pane.size.h.toFixed(0)})`,
    ];

    if (pane.materialIndex >= 0) {
      parts.push(`mat=${pane.materialIndex}`);
    }

    lines.push(parts.join(" "));
  }

  return lines.join("\n");
}

function formatAnimationInfo(animation) {
  if (!animation) {
    return "No animation data parsed yet.";
  }

  const lines = [`Frame count: ${animation.frameSize}`, ""];

  for (const pane of animation.panes) {
    lines.push(`Pane: ${pane.name}`);
    for (const tag of pane.tags) {
      lines.push(`  Tag: ${tag.type}`);
      for (const entry of tag.entries) {
        const values = entry.keyframes
          .map((keyframe) => `f${keyframe.frame.toFixed(0)}->${keyframe.value.toFixed(2)}`)
          .join(", ");
        lines.push(`    ${entry.typeName}: ${values}`);
      }
    }
  }

  return lines.join("\n");
}

function TextureCard({ entry }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.width = entry.image.width;
    canvas.height = entry.image.height;

    const context = canvas.getContext("2d");
    context.putImageData(new ImageData(entry.image.imageData, entry.image.width, entry.image.height), 0, 0);
  }, [entry]);

  return (
    <div className="texture-card">
      <canvas ref={canvasRef} />
      <div className="name">{entry.name}</div>
      <div className="dims">
        {entry.image.width}x{entry.image.height} {TPL_FORMATS[entry.image.format] ?? "?"}
      </div>
    </div>
  );
}

const TABS = [
  { id: "preview", label: "Preview" },
  { id: "textures", label: "Textures" },
  { id: "layout", label: "Layout Info" },
  { id: "log", label: "Parse Log" },
];

const DISPLAY_ASPECT_OPTIONS = [
  { value: "4:3", label: "4:3 (Wii Standard)" },
  { value: "16:9", label: "16:9 (Wii Widescreen)" },
  { value: "16:10", label: "16:10" },
  { value: "native", label: "Native Layout" },
];

const RECENT_WAD_DB_NAME = "wewad";
const RECENT_WAD_STORE_NAME = "recentWads";
const RECENT_WAD_DB_VERSION = 1;
const MAX_RECENT_WADS = 8;

function clampFrame(value, max) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(max, Math.round(value)));
}

function findAlphaRevealFrame(animation, paneNamePattern = null) {
  if (!animation?.panes?.length) {
    return null;
  }

  const revealFrames = [];
  for (const pane of animation.panes) {
    if (paneNamePattern && !paneNamePattern.test(pane.name)) {
      continue;
    }

    for (const tag of pane.tags ?? []) {
      for (const entry of tag.entries ?? []) {
        if (entry.type !== 0x0a && entry.type !== 0x10) {
          continue;
        }

        for (const keyframe of entry.keyframes ?? []) {
          if (Number.isFinite(keyframe.frame) && Number.isFinite(keyframe.value) && keyframe.value >= 200) {
            revealFrames.push(keyframe.frame);
            break;
          }
        }
      }
    }
  }

  if (revealFrames.length === 0) {
    return null;
  }
  return Math.min(...revealFrames);
}

function sampleAnimatedEntry(entry, frame, frameSize) {
  const keyframes = entry?.keyframes ?? [];
  if (keyframes.length === 0) {
    return null;
  }

  return interpolateKeyframes(keyframes, frame);
}

function sampleDiscreteAnimatedEntry(entry, frame, frameSize) {
  const keyframes = entry?.keyframes ?? [];
  if (keyframes.length === 0) {
    return null;
  }

  let selected = keyframes[0];
  for (const keyframe of keyframes) {
    if (frame < keyframe.frame) {
      break;
    }
    selected = keyframe;
  }
  return selected?.value ?? null;
}

function buildPaneAnimationMap(animation) {
  const paneAnimationMap = new Map();
  for (const paneAnimation of animation?.panes ?? []) {
    if (!paneAnimationMap.has(paneAnimation.name)) {
      paneAnimationMap.set(paneAnimation.name, paneAnimation);
    }
  }
  return paneAnimationMap;
}

function buildPaneChainResolver(layout) {
  const panesByName = new Map();
  for (const pane of layout?.panes ?? []) {
    if (!panesByName.has(pane.name)) {
      panesByName.set(pane.name, pane);
    }
  }

  const cache = new Map();
  const getPaneChain = (pane) => {
    if (!pane) {
      return [];
    }

    const cached = cache.get(pane.name);
    if (cached) {
      return cached;
    }

    const chain = [];
    const seen = new Set();
    let current = pane;
    while (current && !seen.has(current.name)) {
      chain.push(current);
      seen.add(current.name);
      if (!current.parent) {
        break;
      }
      current = panesByName.get(current.parent) ?? null;
    }

    chain.reverse();
    cache.set(pane.name, chain);
    return chain;
  };

  return getPaneChain;
}

function getAnimatedPaneState(pane, paneAnimation, frame, frameSize) {
  let scaleX = null;
  let scaleY = null;
  let alpha = null;
  let visible = null;
  let width = null;
  let height = null;

  for (const tag of paneAnimation?.tags ?? []) {
    const tagType = String(tag?.type ?? "");
    for (const entry of tag.entries ?? []) {
      if (tagType === "RLPA" || !tagType) {
        const value = sampleAnimatedEntry(entry, frame, frameSize);
        if (value == null) {
          continue;
        }
        switch (entry.type) {
          case 0x06:
            scaleX = value;
            break;
          case 0x07:
            scaleY = value;
            break;
          case 0x08:
            width = value;
            break;
          case 0x09:
            height = value;
            break;
          case 0x0a:
            alpha = value;
            break;
          default:
            break;
        }
      } else if (tagType === "RLVC") {
        if (entry.type !== 0x10) {
          continue;
        }
        const value = sampleAnimatedEntry(entry, frame, frameSize);
        if (value != null) {
          alpha = value;
        }
      } else if (tagType === "RLVI") {
        if (entry.type !== 0x00) {
          continue;
        }
        const value = sampleDiscreteAnimatedEntry(entry, frame, frameSize);
        if (value != null) {
          visible = value >= 0.5;
        }
      }
    }
  }

  const hasAnimatedAlpha = alpha != null;
  const isVisible = visible != null ? visible : hasAnimatedAlpha ? true : pane.visible !== false;
  const defaultAlpha = isVisible ? (pane.alpha ?? 255) / 255 : 0;
  const animatedAlpha = hasAnimatedAlpha ? alpha / 255 : defaultAlpha;

  return {
    scaleX: scaleX ?? pane.scale?.x ?? 1,
    scaleY: scaleY ?? pane.scale?.y ?? 1,
    width: width ?? pane.size?.w ?? 0,
    height: height ?? pane.size?.h ?? 0,
    alpha: Math.max(0, Math.min(1, isVisible ? animatedAlpha : 0)),
  };
}

function scoreStartFrame(layout, startAnim, frame, paneAnimationMap, getPaneChain) {
  const frameSize = Math.max(1, Math.floor(startAnim?.frameSize ?? 1));
  const panes = (layout?.panes ?? []).filter((pane) => pane.type === "pic1" || pane.type === "txt1");

  let visibleCount = 0;
  let score = 0;

  for (const pane of panes) {
    let alpha = 1;
    let aggregateScale = 1;
    const chain = getPaneChain(pane);
    for (const chainPane of chain) {
      const state = getAnimatedPaneState(chainPane, paneAnimationMap.get(chainPane.name), frame, frameSize);
      alpha *= state.alpha;
      aggregateScale *= Math.max(0, (Math.abs(state.scaleX) + Math.abs(state.scaleY)) * 0.5);
      if (alpha <= 0.01) {
        break;
      }
    }

    if (alpha <= 0.01) {
      continue;
    }

    visibleCount += 1;
    const paneState = getAnimatedPaneState(pane, paneAnimationMap.get(pane.name), frame, frameSize);
    const paneArea = Math.max(1, Math.abs(paneState.width) * Math.abs(paneState.height));
    const scaledWeight = Math.max(0, Math.min(4, aggregateScale));
    score += alpha * scaledWeight * Math.sqrt(paneArea);
  }

  return { score, visibleCount };
}

function suggestInitialFrame(result) {
  const bannerResult = result?.results?.banner;

  const startAnim = bannerResult?.animStart;
  const layout = bannerResult?.renderLayout;
  if (!startAnim || !layout) {
    return 0;
  }

  const frameCount = Math.max(1, Math.floor(startAnim.frameSize ?? 1));
  if (frameCount <= 1) {
    return 0;
  }

  const paneAnimationMap = buildPaneAnimationMap(startAnim);
  const getPaneChain = buildPaneChainResolver(layout);

  const candidateFrames = new Set([0, frameCount - 1]);
  const sampleStep = Math.max(1, Math.floor(frameCount / 72));
  for (let frame = 0; frame < frameCount; frame += sampleStep) {
    candidateFrames.add(frame);
  }

  let baselineScore = null;
  let bestFrame = 0;
  let bestResult = { score: Number.NEGATIVE_INFINITY, visibleCount: Number.NEGATIVE_INFINITY };
  const sampledFrameScores = new Map();

  for (const frame of [...candidateFrames].sort((left, right) => left - right)) {
    const frameResult = scoreStartFrame(layout, startAnim, frame, paneAnimationMap, getPaneChain);
    sampledFrameScores.set(frame, frameResult);
    if (frame === 0) {
      baselineScore = frameResult;
    }

    if (
      frameResult.score > bestResult.score ||
      (Math.abs(frameResult.score - bestResult.score) < 1e-6 && frameResult.visibleCount > bestResult.visibleCount)
    ) {
      bestFrame = frame;
      bestResult = frameResult;
    }
  }

  if (!baselineScore || bestFrame <= 0) {
    return 0;
  }

  const baselineVisible = baselineScore.visibleCount;
  const sparseStart =
    baselineVisible <= 12 ||
    (baselineVisible <= 24 && baselineVisible <= bestResult.visibleCount * 0.45);
  const scoreImproved = baselineScore.score <= 0 ? bestResult.score > 0 : bestResult.score >= baselineScore.score * 1.6;
  const visibilityImproved =
    baselineVisible <= 0 ? bestResult.visibleCount >= 8 : bestResult.visibleCount >= baselineVisible * 1.7;

  if (sparseStart && (scoreImproved || visibilityImproved)) {
    // Prefer the first strong reveal frame so users can still watch the intro
    // (e.g. Internet Channel punctuation + staggered letter reveals) instead
    // of jumping to the densest near-end startup frame.
    const minimumVisible = Math.max(8, baselineVisible + 4, Math.ceil(bestResult.visibleCount * 0.45));
    const minimumScore = bestResult.score <= 0 ? 0 : bestResult.score * 0.55;
    const earliestStrongFrame = [...candidateFrames]
      .sort((left, right) => left - right)
      .find((frame) => {
        if (frame <= 0) {
          return false;
        }
        const sample = sampledFrameScores.get(frame);
        return Boolean(sample && sample.visibleCount >= minimumVisible && sample.score >= minimumScore);
      });

    return earliestStrongFrame ?? bestFrame;
  }

  return 0;
}

function resolveCustomWeatherBannerFrame(selection, fallbackFrame = 0) {
  const activeAnim = selection?.loopAnim ?? selection?.anim ?? selection?.startAnim ?? null;
  if (!activeAnim) {
    return Math.max(0, Math.round(fallbackFrame));
  }

  const maxFrame = Math.max(0, (activeAnim.frameSize ?? 1) - 1);
  const allReveal = findAlphaRevealFrame(activeAnim, /^all$/i);
  if (allReveal != null) {
    return clampFrame(allReveal, maxFrame);
  }

  const anyReveal = findAlphaRevealFrame(activeAnim);
  if (anyReveal != null) {
    return clampFrame(anyReveal, maxFrame);
  }

  return maxFrame;
}

function resolveIconViewport(layout) {
  if (!layout) {
    return { width: 128, height: 96 };
  }

  const picturePanes = (layout.panes ?? []).filter((pane) => pane.type === "pic1");

  const explicitViewportPane =
    picturePanes.find((pane) => /^ch\d+$/i.test(pane.name)) ??
    picturePanes.find((pane) => /(?:^|_)(?:tv|icon|cork|frame|bg|back|base|board)(?:_|$)/i.test(pane.name));

  const fallbackViewportPane = picturePanes
    .filter((pane) => pane.visible !== false)
    .filter((pane) => (pane.alpha ?? 255) > 0)
    .filter((pane) => Math.abs(pane.size?.w ?? 0) >= 64 && Math.abs(pane.size?.h ?? 0) >= 32)
    .sort((left, right) => {
      const leftArea = Math.abs(left.size?.w ?? 0) * Math.abs(left.size?.h ?? 0);
      const rightArea = Math.abs(right.size?.w ?? 0) * Math.abs(right.size?.h ?? 0);
      return rightArea - leftArea;
    })[0];

  const iconPane = explicitViewportPane ?? fallbackViewportPane;

  if (!iconPane) {
    return { width: 128, height: 96 };
  }

  const width = Math.max(1, Math.round(Math.abs(iconPane.size?.w ?? 128)));
  const height = Math.max(1, Math.round(Math.abs(iconPane.size?.h ?? 96)));
  return { width, height };
}

function createRecentIconPreview(result) {
  if (typeof document === "undefined") {
    return null;
  }

  const iconResult = result?.results?.icon;
  if (!iconResult?.renderLayout || !iconResult?.tplImages) {
    return null;
  }

  let renderer = null;
  try {
    const viewport = resolveIconViewport(iconResult.renderLayout);
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const iconLayout = {
      ...iconResult.renderLayout,
      width: viewport.width,
      height: viewport.height,
    };
    const animationSelection = resolveAnimationSelection(iconResult, null);
    renderer = new BannerRenderer(
      canvas,
      iconLayout,
      animationSelection.anim,
      iconResult.tplImages,
      {
        initialFrame: 0,
        startAnim: animationSelection.startAnim ?? null,
        loopAnim: animationSelection.loopAnim ?? animationSelection.anim ?? null,
        renderState: animationSelection.renderState,
        playbackMode: animationSelection.playbackMode ?? "loop",
        fonts: iconResult.fonts,
      },
    );
    renderer.render();
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    renderer?.dispose?.();
  }
}

function createWavBuffer(audio) {
  if (!audio?.pcm16?.length || !Number.isFinite(audio.sampleRate) || audio.sampleRate <= 0) {
    return null;
  }

  const channelCount = Math.max(1, audio.channelCount ?? audio.pcm16.length);
  const frameCount = Math.min(...audio.pcm16.map((channelData) => channelData.length));
  if (!Number.isFinite(frameCount) || frameCount <= 0) {
    return null;
  }

  const blockAlign = channelCount * 2;
  const byteRate = audio.sampleRate * blockAlign;
  const dataSize = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  let writeOffset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const channelData = audio.pcm16[channel] ?? audio.pcm16[audio.pcm16.length - 1];
      const sample = channelData?.[frame] ?? 0;
      view.setInt16(writeOffset, sample, true);
      writeOffset += 2;
    }
  }

  return buffer;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0.00s";
  }
  return `${seconds.toFixed(2)}s`;
}

function formatByteSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const size = bytes / 1024 ** unitIndex;
  const precision = unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function formatRecentTimestamp(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "Unknown time";
  }
  return new Date(timestamp).toLocaleString();
}

function getRecentWadId({ name, size, lastModified }) {
  return `${String(name ?? "")}:${Number(size ?? 0)}:${Number(lastModified ?? 0)}`;
}

function sanitizeRecentWadEntry(entry) {
  return {
    id: String(entry?.id ?? ""),
    name: String(entry?.name ?? "unknown.wad"),
    size: Number(entry?.size ?? 0),
    loadedAt: Number(entry?.loadedAt ?? 0),
    iconPreviewUrl:
      typeof entry?.iconPreviewUrl === "string" && entry.iconPreviewUrl.length > 0
        ? entry.iconPreviewUrl
        : null,
  };
}

function sortRecentWads(entries = []) {
  return [...entries].sort((left, right) => (right.loadedAt ?? 0) - (left.loadedAt ?? 0));
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function isIndexedDbAvailable() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

async function openRecentWadDatabase() {
  if (!isIndexedDbAvailable()) {
    return null;
  }

  const request = window.indexedDB.open(RECENT_WAD_DB_NAME, RECENT_WAD_DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(RECENT_WAD_STORE_NAME)) {
      db.createObjectStore(RECENT_WAD_STORE_NAME, { keyPath: "id" });
    }
  };

  return requestToPromise(request);
}

async function listRecentWads() {
  const db = await openRecentWadDatabase();
  if (!db) {
    return [];
  }

  try {
    const transaction = db.transaction(RECENT_WAD_STORE_NAME, "readonly");
    const store = transaction.objectStore(RECENT_WAD_STORE_NAME);
    const rows = await requestToPromise(store.getAll());
    await transactionToPromise(transaction);

    return sortRecentWads(rows.map((row) => sanitizeRecentWadEntry(row))).slice(0, MAX_RECENT_WADS);
  } finally {
    db.close();
  }
}

async function saveRecentWad(file, options = {}) {
  if (!file || !isIndexedDbAvailable()) {
    return [];
  }

  if (typeof Blob !== "undefined" && !(file instanceof Blob)) {
    return listRecentWads();
  }

  const id = getRecentWadId(file);
  const db = await openRecentWadDatabase();
  if (!db) {
    return [];
  }

  try {
    const transaction = db.transaction(RECENT_WAD_STORE_NAME, "readwrite");
    const store = transaction.objectStore(RECENT_WAD_STORE_NAME);
    const rows = await requestToPromise(store.getAll());
    const now = Date.now();
    const previewUrl =
      typeof options.iconPreviewUrl === "string" && options.iconPreviewUrl.length > 0
        ? options.iconPreviewUrl
        : null;

    const nextRows = [
      {
        id,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        loadedAt: now,
        blob: file,
        iconPreviewUrl: previewUrl,
      },
      ...sortRecentWads(rows.filter((row) => row.id !== id)),
    ].slice(0, MAX_RECENT_WADS);

    store.clear();
    for (const row of nextRows) {
      store.put(row);
    }

    await transactionToPromise(transaction);
    return nextRows.map((row) => sanitizeRecentWadEntry(row));
  } finally {
    db.close();
  }
}

async function getRecentWad(id) {
  if (!id || !isIndexedDbAvailable()) {
    return null;
  }

  const db = await openRecentWadDatabase();
  if (!db) {
    return null;
  }

  try {
    const transaction = db.transaction(RECENT_WAD_STORE_NAME, "readonly");
    const store = transaction.objectStore(RECENT_WAD_STORE_NAME);
    const row = await requestToPromise(store.get(id));
    await transactionToPromise(transaction);
    return row ?? null;
  } finally {
    db.close();
  }
}

async function clearRecentWads() {
  const db = await openRecentWadDatabase();
  if (!db) {
    return;
  }

  try {
    const transaction = db.transaction(RECENT_WAD_STORE_NAME, "readwrite");
    const store = transaction.objectStore(RECENT_WAD_STORE_NAME);
    store.clear();
    await transactionToPromise(transaction);
  } finally {
    db.close();
  }
}

const TITLE_LOCALE_LABELS = {
  JP: "Japanese (JP)",
  NE: "Dutch (NE)",
  GE: "German (GE)",
  SP: "Spanish (SP)",
  IT: "Italian (IT)",
  FR: "French (FR)",
  US: "English (US)",
  KR: "Korean (KR)",
};

const TITLE_LOCALE_ORDER = ["JP", "NE", "GE", "SP", "IT", "FR", "US", "KR"];

const WEATHER_CONDITION_OPTIONS = [
  { value: "clear", label: "Clear" },
  { value: "partly_cloudy", label: "Partly Cloudy" },
  { value: "cloudy", label: "Cloudy" },
  { value: "rain", label: "Rain" },
  { value: "thunderstorm", label: "Thunderstorm" },
  { value: "snow", label: "Snow" },
  { value: "sleet", label: "Sleet" },
  { value: "hail", label: "Hail" },
  { value: "fog", label: "Fog" },
  { value: "windy", label: "Windy" },
  { value: "night", label: "Night Clear" },
];

function hasWeatherScene(layout) {
  const panes = layout?.panes ?? [];
  const paneNames = new Set(panes.map((pane) => String(pane.name ?? "")));
  return paneNames.has("weather") && paneNames.has("code") && paneNames.has("city") && paneNames.has("telop");
}

function sortTitleLocales(codes = []) {
  return [...codes].sort((left, right) => {
    const leftOrder = TITLE_LOCALE_ORDER.indexOf(left);
    const rightOrder = TITLE_LOCALE_ORDER.indexOf(right);
    if (leftOrder !== rightOrder) {
      const safeLeft = leftOrder >= 0 ? leftOrder : Number.MAX_SAFE_INTEGER;
      const safeRight = rightOrder >= 0 ? rightOrder : Number.MAX_SAFE_INTEGER;
      return safeLeft - safeRight;
    }
    return left.localeCompare(right);
  });
}

function normalizeRenderState(value) {
  if (!value || value === "auto") {
    return null;
  }
  return String(value).trim().toUpperCase();
}

function compareRenderStates(left, right) {
  const leftMatch = String(left).match(/^RSO(\d+)$/i);
  const rightMatch = String(right).match(/^RSO(\d+)$/i);
  if (leftMatch && rightMatch) {
    return Number.parseInt(leftMatch[1], 10) - Number.parseInt(rightMatch[1], 10);
  }
  return String(left).localeCompare(String(right), undefined, { numeric: true });
}

function collectRenderStateOptions(targetResult) {
  const states = new Set();

  for (const group of targetResult?.renderLayout?.groups ?? []) {
    const normalized = normalizeRenderState(group?.name);
    if (normalized && /^RSO\d+$/.test(normalized)) {
      states.add(normalized);
    }
  }

  for (const animEntry of targetResult?.animEntries ?? []) {
    const normalized = normalizeRenderState(animEntry?.state);
    if (normalized && /^RSO\d+$/.test(normalized)) {
      states.add(normalized);
    }
  }

  return [...states].sort(compareRenderStates);
}

function resolveAutoRenderState(targetResult) {
  const states = collectRenderStateOptions(targetResult);
  if (states.length === 0) {
    return null;
  }

  if (states.includes("RSO0")) {
    return "RSO0";
  }

  return states[0];
}

function findStateAnimationEntry(targetResult, state) {
  const normalizedState = normalizeRenderState(state);
  if (!normalizedState) {
    return null;
  }

  return (
    (targetResult?.animEntries ?? []).find((entry) => normalizeRenderState(entry?.state) === normalizedState) ??
    null
  );
}

function shouldHoldStateAnimation(targetResult, stateAnim) {
  if (!stateAnim || targetResult?.animLoop) {
    return false;
  }

  const frameSize = Math.max(0, Math.floor(stateAnim.frameSize ?? 0));
  return frameSize > 0 && frameSize <= 180;
}

function resolveAnimationSelection(targetResult, selectedState) {
  const explicitState = normalizeRenderState(selectedState);
  if (!targetResult) {
    return {
      anim: null,
      startAnim: null,
      loopAnim: null,
      renderState: explicitState,
      playbackMode: "loop",
    };
  }

  const autoState = resolveAutoRenderState(targetResult);
  const activeState = explicitState ?? autoState;
  const stateAnimEntry = findStateAnimationEntry(targetResult, activeState);
  const stateAnim = stateAnimEntry?.anim ?? null;

  if (stateAnim) {
    const startAnim = targetResult?.animStart ?? null;
    if (startAnim) {
      // Start + RSO state: play start first, then loop the state animation.
      return {
        anim: startAnim,
        startAnim,
        loopAnim: stateAnim,
        renderState: activeState ?? null,
        playbackMode: "loop",
      };
    }
    const playbackMode = shouldHoldStateAnimation(targetResult, stateAnim) ? "hold" : "loop";
    return {
      anim: stateAnim,
      startAnim: null,
      loopAnim: stateAnim,
      renderState: activeState ?? null,
      playbackMode,
    };
  }

  if (!explicitState) {
    return {
      anim: targetResult.anim ?? null,
      startAnim: targetResult.animStart ?? null,
      loopAnim: targetResult.animLoop ?? targetResult.anim ?? null,
      renderState: autoState ?? null,
      playbackMode: "loop",
    };
  }

  const selectedAnim = targetResult.animLoop ?? targetResult.animStart ?? targetResult.anim ?? null;

  return {
    anim: selectedAnim,
    startAnim: null,
    loopAnim: selectedAnim,
    renderState: activeState,
    playbackMode: "loop",
  };
}

function hasWeatherPaneName(name) {
  return /^W_/i.test(name) || /^code$/i.test(name) || /^weather$/i.test(name);
}

function buildPaneChildrenByParent(layoutPanes = []) {
  const childrenByParent = new Map();
  for (const pane of layoutPanes) {
    if (!pane?.parent) {
      continue;
    }
    let children = childrenByParent.get(pane.parent);
    if (!children) {
      children = [];
      childrenByParent.set(pane.parent, children);
    }
    children.push(pane.name);
  }
  return childrenByParent;
}

function hasWeatherPaneInSubtree(rootPaneName, childrenByParent) {
  const startName = String(rootPaneName ?? "");
  if (!startName) {
    return false;
  }

  const stack = [startName];
  const seen = new Set();
  while (stack.length > 0) {
    const paneName = stack.pop();
    if (!paneName || seen.has(paneName)) {
      continue;
    }
    seen.add(paneName);
    if (hasWeatherPaneName(paneName)) {
      return true;
    }
    for (const childName of childrenByParent.get(paneName) ?? []) {
      stack.push(childName);
    }
  }

  return false;
}

function resolveWeatherRenderState(targetResult) {
  const layout = targetResult?.renderLayout;
  if (!layout?.groups?.length) {
    return null;
  }

  const childrenByParent = buildPaneChildrenByParent(layout.panes ?? []);
  for (const group of layout.groups) {
    const normalizedState = normalizeRenderState(group?.name);
    if (!normalizedState || !/^RSO\d+$/.test(normalizedState)) {
      continue;
    }

    for (const paneName of group.paneNames ?? []) {
      if (hasWeatherPaneInSubtree(paneName, childrenByParent)) {
        return normalizedState;
      }
    }
  }

  return null;
}

function arePaneStateGroupsEqual(leftGroups = [], rightGroups = []) {
  if (leftGroups.length !== rightGroups.length) {
    return false;
  }

  for (let i = 0; i < leftGroups.length; i += 1) {
    const left = leftGroups[i];
    const right = rightGroups[i];
    if (
      left.id !== right.id ||
      left.label !== right.label ||
      left.options.length !== right.options.length
    ) {
      return false;
    }

    for (let optionIndex = 0; optionIndex < left.options.length; optionIndex += 1) {
      const leftOption = left.options[optionIndex];
      const rightOption = right.options[optionIndex];
      if (leftOption.index !== rightOption.index || leftOption.paneName !== rightOption.paneName) {
        return false;
      }
    }
  }

  return true;
}

function shallowEqualSelections(left = {}, right = {}) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  for (const [key, value] of leftEntries) {
    if (right[key] !== value) {
      return false;
    }
  }
  return true;
}

function normalizePaneStateSelections(currentSelections, groups) {
  const nextSelections = {};
  for (const group of groups) {
    const currentValue = Number.parseInt(String(currentSelections?.[group.id]), 10);
    const hasCurrent = Number.isFinite(currentValue) && group.options.some((option) => option.index === currentValue);
    nextSelections[group.id] = hasCurrent ? currentValue : null;
  }
  return nextSelections;
}

function normalizeDomId(value) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

export default function App() {
  const fileInputRef = useRef(null);
  const bannerCanvasRef = useRef(null);
  const iconCanvasRef = useRef(null);
  const audioElementRef = useRef(null);
  const bannerRendererRef = useRef(null);
  const iconRendererRef = useRef(null);

  const [activeTab, setActiveTab] = useState("preview");
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animStatus, setAnimStatus] = useState("Frame 0");
  const [startFrame, setStartFrame] = useState(0);
  const [startFrameInput, setStartFrameInput] = useState("0");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [parsed, setParsed] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [logEntries, setLogEntries] = useState([]);
  const [bannerRenderState, setBannerRenderState] = useState("auto");
  const [iconRenderState, setIconRenderState] = useState("auto");
  const [titleLocale, setTitleLocale] = useState("auto");
  const [availableTitleLocales, setAvailableTitleLocales] = useState([]);
  const [bannerPaneStateGroups, setBannerPaneStateGroups] = useState([]);
  const [iconPaneStateGroups, setIconPaneStateGroups] = useState([]);
  const [bannerPaneStateSelections, setBannerPaneStateSelections] = useState({});
  const [iconPaneStateSelections, setIconPaneStateSelections] = useState({});
  const [useCustomWeather, setUseCustomWeather] = useState(false);
  const [customCondition, setCustomCondition] = useState("partly_cloudy");
  const [customCity, setCustomCity] = useState("Seattle");
  const [customTelop, setCustomTelop] = useState("Partly cloudy with a chance of evening rain.");
  const [customTimeLabel, setCustomTimeLabel] = useState("Updated 9:41 AM");
  const [customTemperature, setCustomTemperature] = useState("72");
  const [customTemperatureUnit, setCustomTemperatureUnit] = useState("F");
  const [previewDisplayAspect, setPreviewDisplayAspect] = useState("4:3");
  const [tevQuality, setTevQuality] = useState("fast");
  const [recentWads, setRecentWads] = useState([]);
  const [isLoadingRecentId, setIsLoadingRecentId] = useState("");

  const bannerRenderStateOptions = useMemo(
    () => collectRenderStateOptions(parsed?.results?.banner),
    [parsed],
  );
  const iconRenderStateOptions = useMemo(
    () => collectRenderStateOptions(parsed?.results?.icon),
    [parsed],
  );

  const effectiveIconRenderState = useMemo(() => {
    if (!useCustomWeather) {
      return iconRenderState;
    }

    return resolveWeatherRenderState(parsed?.results?.icon) ?? iconRenderState;
  }, [iconRenderState, parsed, useCustomWeather]);

  const bannerAnimSelection = useMemo(
    () => resolveAnimationSelection(parsed?.results?.banner, bannerRenderState),
    [parsed, bannerRenderState],
  );
  const iconAnimSelection = useMemo(
    () => resolveAnimationSelection(parsed?.results?.icon, effectiveIconRenderState),
    [parsed, effectiveIconRenderState],
  );

  const canCustomizeWeather = useMemo(
    () => hasWeatherScene(parsed?.results?.banner?.renderLayout),
    [parsed],
  );

  const customWeatherData = useMemo(() => {
    if (!useCustomWeather || !canCustomizeWeather) {
      return null;
    }

    const parsedTemperature = Number.parseInt(customTemperature, 10);
    return {
      enabled: true,
      condition: customCondition,
      city: customCity,
      telop: customTelop,
      timeLabel: customTimeLabel,
      temperature: Number.isFinite(parsedTemperature) ? parsedTemperature : null,
      temperatureUnit: customTemperatureUnit,
    };
  }, [
    useCustomWeather,
    canCustomizeWeather,
    customCondition,
    customCity,
    customTelop,
    customTimeLabel,
    customTemperature,
    customTemperatureUnit,
  ]);

  const effectiveBannerStartFrame = useMemo(() => {
    if (!customWeatherData || !canCustomizeWeather) {
      return startFrame;
    }
    return resolveCustomWeatherBannerFrame(bannerAnimSelection, startFrame);
  }, [bannerAnimSelection, canCustomizeWeather, customWeatherData, startFrame]);

  const effectiveIconStartFrame = useMemo(() => {
    if (!customWeatherData || !canCustomizeWeather) {
      return startFrame;
    }
    return resolveCustomWeatherBannerFrame(iconAnimSelection, startFrame);
  }, [canCustomizeWeather, customWeatherData, iconAnimSelection, startFrame]);

  const maxStartFrame = useMemo(() => {
    if (!parsed) {
      return 959;
    }

    const bannerStartFrames = bannerAnimSelection.startAnim?.frameSize ?? 0;
    const bannerFrames =
      bannerAnimSelection.anim?.frameSize ??
      bannerAnimSelection.loopAnim?.frameSize ??
      0;
    const iconStartFrames = iconAnimSelection.startAnim?.frameSize ?? 0;
    const iconFrames =
      iconAnimSelection.anim?.frameSize ??
      iconAnimSelection.loopAnim?.frameSize ??
      0;

    if (bannerStartFrames > 0) {
      return Math.max(1, bannerStartFrames) - 1;
    }
    if (iconStartFrames > 0) {
      return Math.max(1, iconStartFrames) - 1;
    }
    return Math.max(1, bannerFrames, iconFrames) - 1;
  }, [parsed, bannerAnimSelection, iconAnimSelection]);

  const normalizeStartFrame = useCallback(
    (rawValue) => {
      const parsedValue = Number.parseInt(String(rawValue), 10);
      if (!Number.isFinite(parsedValue)) {
        return 0;
      }
      return Math.max(0, Math.min(maxStartFrame, parsedValue));
    },
    [maxStartFrame],
  );

  const stopRenderers = useCallback(() => {
    bannerRendererRef.current?.dispose();
    iconRendererRef.current?.dispose();
    bannerRendererRef.current = null;
    iconRendererRef.current = null;

    const audioElement = audioElementRef.current;
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
  }, []);

  const handleFile = useCallback(
    async (file) => {
      if (!file) {
        return;
      }

      setSelectedFileName(file.name);
      setIsProcessing(true);
      setIsPlaying(false);
      setAnimStatus("Frame 0");
      setActiveTab("preview");
      setBannerRenderState("auto");
      setIconRenderState("auto");
      setTitleLocale("auto");
      setAvailableTitleLocales([]);
      setBannerPaneStateGroups([]);
      setIconPaneStateGroups([]);
      setBannerPaneStateSelections({});
      setIconPaneStateSelections({});
      setUseCustomWeather(false);

      stopRenderers();

      const logs = [];
      const logger = createArrayLogger(logs);
      logger.info(`Loading ${file.name}`);

      try {
        const buffer = await file.arrayBuffer();
        const result = await processWAD(buffer, logger);

        if (!result.results.banner && !result.results.icon) {
          logger.warn("No banner or icon content could be rendered.");
        }

        const suggestedFrame = suggestInitialFrame(result);
        setStartFrame(suggestedFrame);
        setStartFrameInput(String(suggestedFrame));
        setAnimStatus(`Frame ${suggestedFrame}`);
        setParsed(result);

        try {
          const iconPreviewUrl = createRecentIconPreview(result);
          const nextRecentWads = await saveRecentWad(file, { iconPreviewUrl });
          setRecentWads(nextRecentWads);
        } catch (recentError) {
          logger.warn(`Unable to store recent WAD: ${recentError.message}`);
        }
      } catch (error) {
        logger.error(`Fatal: ${error.message}`);
        setParsed(null);
      } finally {
        setLogEntries(logs);
        setIsProcessing(false);
      }
    },
    [stopRenderers],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const entries = await listRecentWads();
        if (!cancelled) {
          setRecentWads(entries);
        }
      } catch {
        if (!cancelled) {
          setRecentWads([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadRecentWad = useCallback(
    async (recentWadId) => {
      if (!recentWadId || isProcessing) {
        return;
      }

      setIsLoadingRecentId(recentWadId);
      try {
        const row = await getRecentWad(recentWadId);
        if (!row?.blob) {
          setRecentWads(await listRecentWads());
          return;
        }

        const canUseFileConstructor = typeof File !== "undefined";
        const hasFileType = canUseFileConstructor && row.blob instanceof File;
        const file =
          hasFileType
            ? row.blob
            : canUseFileConstructor
              ? new File([row.blob], row.name ?? "recent.wad", {
                  lastModified: Number(row.lastModified ?? Date.now()),
                  type: row.blob.type || "application/octet-stream",
                })
              : {
                  name: row.name ?? "recent.wad",
                  arrayBuffer: () => row.blob.arrayBuffer(),
                  size: Number(row.size ?? 0),
                  lastModified: Number(row.lastModified ?? 0),
                };

        await handleFile(file);
      } finally {
        setIsLoadingRecentId("");
      }
    },
    [handleFile, isProcessing],
  );

  const clearRecentWadsList = useCallback(async () => {
    await clearRecentWads();
    setRecentWads([]);
  }, []);

  useEffect(() => {
    if (bannerRenderState === "auto") {
      return;
    }
    if (bannerRenderStateOptions.includes(bannerRenderState)) {
      return;
    }
    setBannerRenderState("auto");
  }, [bannerRenderState, bannerRenderStateOptions]);

  useEffect(() => {
    if (iconRenderState === "auto") {
      return;
    }
    if (iconRenderStateOptions.includes(iconRenderState)) {
      return;
    }
    setIconRenderState("auto");
  }, [iconRenderState, iconRenderStateOptions]);

  useEffect(() => {
    const audio = parsed?.results?.audio;
    if (!audio) {
      setAudioUrl(null);
      return undefined;
    }

    const wavBuffer = createWavBuffer(audio);
    if (!wavBuffer) {
      setAudioUrl(null);
      return undefined;
    }

    const nextAudioUrl = URL.createObjectURL(new Blob([wavBuffer], { type: "audio/wav" }));
    setAudioUrl(nextAudioUrl);

    return () => {
      URL.revokeObjectURL(nextAudioUrl);
    };
  }, [parsed]);

  useEffect(() => {
    stopRenderers();
    setIsPlaying(false);
    setAvailableTitleLocales([]);
    setBannerPaneStateGroups([]);
    setIconPaneStateGroups([]);

    if (!parsed || activeTab !== "preview") {
      return () => {
        stopRenderers();
      };
    }

    const bannerResult = parsed.results.banner;
    const iconResult = parsed.results.icon;
    const requestedLocale = titleLocale === "auto" ? undefined : titleLocale;

    if (bannerResult && bannerCanvasRef.current) {
      const bannerRenderer = new BannerRenderer(
        bannerCanvasRef.current,
        bannerResult.renderLayout,
        bannerAnimSelection.anim,
        bannerResult.tplImages,
        {
          initialFrame: effectiveBannerStartFrame,
          startAnim: bannerAnimSelection.startAnim ?? null,
          loopAnim: bannerAnimSelection.loopAnim ?? bannerAnimSelection.anim ?? null,
          renderState: bannerAnimSelection.renderState,
          playbackMode: bannerAnimSelection.playbackMode ?? "loop",
          paneStateSelections: customWeatherData ? null : bannerPaneStateSelections,
          titleLocale: requestedLocale,
          customWeather: customWeatherData,
          displayAspect: previewDisplayAspect,
          tevQuality,
          fonts: bannerResult.fonts,
          onFrame: (frame, total, phase) => {
            const phaseLabel = phase === "start" ? "Start" : "Loop";
            setAnimStatus(`${phaseLabel} ${Math.floor(frame)} / ${Math.max(1, Math.floor(total))}`);
          },
        },
      );
      bannerRenderer.render();
      bannerRendererRef.current = bannerRenderer;
    }

    if (iconResult && iconCanvasRef.current) {
      const iconViewport = resolveIconViewport(iconResult.renderLayout);
      const iconLayout = {
        ...iconResult.renderLayout,
        width: iconViewport.width,
        height: iconViewport.height,
      };
      const iconRenderer = new BannerRenderer(
        iconCanvasRef.current,
        iconLayout,
        iconAnimSelection.anim,
        iconResult.tplImages,
        {
          initialFrame: effectiveIconStartFrame,
          startAnim: iconAnimSelection.startAnim ?? null,
          loopAnim: iconAnimSelection.loopAnim ?? iconAnimSelection.anim ?? null,
          renderState: iconAnimSelection.renderState,
          playbackMode: iconAnimSelection.playbackMode ?? "loop",
          paneStateSelections: customWeatherData ? null : iconPaneStateSelections,
          titleLocale: requestedLocale,
          customWeather: customWeatherData,
          displayAspect: previewDisplayAspect,
          tevQuality,
          fonts: iconResult.fonts,
        },
      );
      iconRenderer.render();
      iconRendererRef.current = iconRenderer;
    }

    const nextBannerPaneGroups = bannerRendererRef.current?.getAvailablePaneStateGroups?.() ?? [];
    const nextIconPaneGroups = iconRendererRef.current?.getAvailablePaneStateGroups?.() ?? [];
    setBannerPaneStateGroups((previous) =>
      arePaneStateGroupsEqual(previous, nextBannerPaneGroups) ? previous : nextBannerPaneGroups,
    );
    setIconPaneStateGroups((previous) =>
      arePaneStateGroupsEqual(previous, nextIconPaneGroups) ? previous : nextIconPaneGroups,
    );
    setBannerPaneStateSelections((previous) => {
      const normalized = normalizePaneStateSelections(previous, nextBannerPaneGroups);
      return shallowEqualSelections(previous, normalized) ? previous : normalized;
    });
    setIconPaneStateSelections((previous) => {
      const normalized = normalizePaneStateSelections(previous, nextIconPaneGroups);
      return shallowEqualSelections(previous, normalized) ? previous : normalized;
    });

    const localeSet = new Set();
    const bannerLocales = bannerRendererRef.current?.getAvailableTitleLocales?.() ?? [];
    const iconLocales = iconRendererRef.current?.getAvailableTitleLocales?.() ?? [];
    for (const locale of bannerLocales) {
      localeSet.add(locale);
    }
    for (const locale of iconLocales) {
      localeSet.add(locale);
    }

    const sortedLocales = sortTitleLocales([...localeSet]);
    setAvailableTitleLocales(sortedLocales);
    if (titleLocale !== "auto" && !localeSet.has(titleLocale)) {
      setTitleLocale("auto");
    }

    return () => {
      stopRenderers();
    };
  }, [
    activeTab,
    parsed,
    startFrame,
    effectiveBannerStartFrame,
    effectiveIconStartFrame,
    stopRenderers,
    bannerAnimSelection,
    iconAnimSelection,
    titleLocale,
    bannerPaneStateSelections,
    iconPaneStateSelections,
    customWeatherData,
    previewDisplayAspect,
    tevQuality,
  ]);

  useEffect(() => {
    const bannerRenderer = bannerRendererRef.current;
    const iconRenderer = iconRendererRef.current;
    const audioElement = audioElementRef.current;
    if (!bannerRenderer && !iconRenderer && !audioElement) {
      return;
    }

    bannerRenderer?.setStartFrame(effectiveBannerStartFrame);
    iconRenderer?.setStartFrame(effectiveIconStartFrame);
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    setIsPlaying(false);
  }, [effectiveBannerStartFrame, effectiveIconStartFrame, startFrame]);

  const bannerTextureEntries = useMemo(
    () => flattenTextures(parsed?.results.banner?.tplImages ?? {}),
    [parsed],
  );
  const iconTextureEntries = useMemo(
    () => flattenTextures(parsed?.results.icon?.tplImages ?? {}),
    [parsed],
  );

  const layoutInfo = useMemo(() => formatLayoutInfo(parsed?.results.banner?.layout), [parsed]);
  const animationInfo = useMemo(() => formatAnimationInfo(parsed?.results.banner?.anim), [parsed]);
  const audioInfo = useMemo(() => {
    const audio = parsed?.results?.audio;
    if (!audio) {
      return "No channel audio decoded.";
    }

    const loopText = audio.loopFlag ? `loop starts at sample ${audio.loopStart}` : "no loop";
    return `${audio.channelCount} channel(s), ${audio.sampleRate} Hz, ${audio.sampleCount} samples, ${formatDuration(audio.durationSeconds)}, ${loopText}`;
  }, [parsed]);

  const showRenderArea = Boolean(parsed || logEntries.length > 0);

  const togglePlayback = useCallback(() => {
    const bannerRenderer = bannerRendererRef.current;
    const iconRenderer = iconRendererRef.current;
    const audioElement = audioElementRef.current;
    const freezeVisualPlayback = Boolean(customWeatherData && canCustomizeWeather);

    if (!bannerRenderer && !iconRenderer && !audioElement) {
      return;
    }

    if (isPlaying) {
      bannerRenderer?.stop();
      iconRenderer?.stop();
      audioElement?.pause();
      setIsPlaying(false);
      return;
    }

    let startedPlayback = false;

    if (!freezeVisualPlayback && bannerRenderer) {
      bannerRenderer.play();
      startedPlayback = true;
    }

    if (!freezeVisualPlayback && iconRenderer) {
      iconRenderer.play();
      startedPlayback = true;
    }

    if (audioElement && audioUrl) {
      const playPromise = audioElement.play();
      if (typeof playPromise?.catch === "function") {
        playPromise.catch(() => {});
      }
      startedPlayback = true;
    }

    setIsPlaying(startedPlayback);
  }, [audioUrl, canCustomizeWeather, customWeatherData, isPlaying]);

  const resetPlayback = useCallback(() => {
    bannerRendererRef.current?.stop();
    iconRendererRef.current?.stop();
    bannerRendererRef.current?.reset();
    iconRendererRef.current?.reset();

    const audioElement = audioElementRef.current;
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }

    setIsPlaying(false);
  }, []);

  const applyStartFrame = useCallback(() => {
    const nextStartFrame = normalizeStartFrame(startFrameInput);
    setStartFrame(nextStartFrame);
    setStartFrameInput(String(nextStartFrame));
  }, [normalizeStartFrame, startFrameInput]);

  const useCurrentFrame = useCallback(() => {
    const current = bannerRendererRef.current?.frame ?? iconRendererRef.current?.frame ?? startFrame;
    const nextStartFrame = normalizeStartFrame(current);
    setStartFrame(nextStartFrame);
    setStartFrameInput(String(nextStartFrame));
  }, [normalizeStartFrame, startFrame]);

  useEffect(() => {
    if (!parsed) {
      return;
    }
    const clampedStartFrame = normalizeStartFrame(startFrame);
    if (clampedStartFrame === startFrame) {
      return;
    }
    setStartFrame(clampedStartFrame);
    setStartFrameInput(String(clampedStartFrame));
  }, [maxStartFrame, normalizeStartFrame, parsed, startFrame]);

  const exportCanvas = useCallback((canvasRef, filename) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, []);

  return (
    <div className="app">
      <header>
        <h1>Wii Channel Banner Renderer</h1>
        <p>Drop a .WAD file to extract and render its channel banner and icon</p>
      </header>

      <div
        className={`drop-zone ${isDragOver ? "dragover" : ""}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragOver(false);
          const file = event.dataTransfer.files?.[0];
          if (file) {
            void handleFile(file);
          }
        }}
      >
        <div className="drop-title">
          {isProcessing
            ? `Processing ${selectedFileName || "file"}...`
            : selectedFileName
              ? `Loaded: ${selectedFileName}`
              : "Drop .WAD file here"}
        </div>
        <span>or click to browse</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".wad"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleFile(file);
            }
            event.target.value = "";
          }}
        />
      </div>

      {recentWads.length > 0 ? (
        <div className="recent-wads">
          <div className="recent-wads-header">
            <div className="recent-wads-title">Recent WADs</div>
            <button
              className="clear-recent-button"
              onClick={() => void clearRecentWadsList()}
              type="button"
              disabled={isProcessing || Boolean(isLoadingRecentId)}
            >
              Clear
            </button>
          </div>
          <div className="recent-wads-list">
            {recentWads.map((entry) => {
              const isLoadingThis = isLoadingRecentId === entry.id;
              return (
                <button
                  className="recent-wad-item"
                  key={entry.id}
                  onClick={() => void loadRecentWad(entry.id)}
                  type="button"
                  disabled={isProcessing || isLoadingThis}
                >
                  <span className="recent-wad-preview" aria-hidden="true">
                    {entry.iconPreviewUrl ? (
                      <img src={entry.iconPreviewUrl} alt="" />
                    ) : (
                      <span className="recent-wad-preview-empty">No preview</span>
                    )}
                  </span>
                  <span className="recent-wad-name">
                    {isLoadingThis ? `Loading ${entry.name}...` : entry.name}
                  </span>
                  <span className="recent-wad-meta">
                    {formatByteSize(entry.size)} • {formatRecentTimestamp(entry.loadedAt)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {showRenderArea ? (
        <div className="render-area visible">
          <div className="tab-bar">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`tab ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "preview" ? (
            <div className="tab-content active">
              <div className="banner-display">
                <div className="section-title">Channel Banner</div>
                <div className="canvas-wrapper">
                  <div className="canvas-container">
                    <label>Banner</label>
                    <canvas ref={bannerCanvasRef} width="608" height="456" />
                  </div>
                  <div className="canvas-container">
                    <label>Icon</label>
                    <canvas ref={iconCanvasRef} width="128" height="128" />
                  </div>
                </div>
                <div className="controls">
                  <button className="primary" onClick={togglePlayback} type="button">
                    {isPlaying ? "Pause Animation" : "Play Animation"}
                  </button>
                  <button onClick={resetPlayback} type="button">
                    Reset
                  </button>
                  <button
                    onClick={() => exportCanvas(bannerCanvasRef, "banner.png")}
                    type="button"
                  >
                    Export Banner PNG
                  </button>
                  <button onClick={() => exportCanvas(iconCanvasRef, "icon.png")} type="button">
                    Export Icon PNG
                  </button>
                </div>
                <div className="frame-settings">
                  <label htmlFor="start-frame">Start Sequence Frame</label>
                  <input
                    id="start-frame"
                    type="number"
                    min="0"
                    max={maxStartFrame}
                    step="1"
                    value={startFrameInput}
                    onChange={(event) => setStartFrameInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        applyStartFrame();
                      }
                    }}
                  />
                  <button onClick={applyStartFrame} type="button">
                    Apply
                  </button>
                  <button onClick={useCurrentFrame} type="button">
                    Use Current
                  </button>
                  <span className="frame-settings-range">0-{maxStartFrame}</span>
                </div>
                <div className="state-settings">
                  <div className="state-control">
                    <label htmlFor="display-aspect">Display Aspect</label>
                    <select
                      id="display-aspect"
                      value={previewDisplayAspect}
                      onChange={(event) => setPreviewDisplayAspect(event.target.value)}
                    >
                      {DISPLAY_ASPECT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="state-control">
                    <label htmlFor="tev-quality">TEV Quality</label>
                    <select
                      id="tev-quality"
                      value={tevQuality}
                      onChange={(event) => setTevQuality(event.target.value)}
                    >
                      <option value="fast">Fast</option>
                      <option value="accurate">Accurate</option>
                    </select>
                  </div>
                  {bannerRenderStateOptions.length > 0 ? (
                    <div className="state-control">
                      <label htmlFor="banner-state">Banner State</label>
                      <select
                        id="banner-state"
                        value={bannerRenderState}
                        onChange={(event) => setBannerRenderState(event.target.value)}
                      >
                        <option value="auto">Auto</option>
                        {bannerRenderStateOptions.map((state) => (
                          <option key={state} value={state}>
                            {state}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  {bannerPaneStateGroups.map((group) => {
                    const controlId = `banner-pane-state-${normalizeDomId(group.id)}`;
                    const parsedValue = Number.parseInt(String(bannerPaneStateSelections[group.id]), 10);
                    const value = Number.isFinite(parsedValue) ? String(parsedValue) : "auto";
                    return (
                      <div className="state-control" key={`banner-pane-group-${group.id}`}>
                        <label htmlFor={controlId}>Banner {group.label}</label>
                        <select
                          id={controlId}
                          value={value}
                          onChange={(event) => {
                            const next = event.target.value === "auto"
                              ? null
                              : Number.parseInt(event.target.value, 10);
                            setBannerPaneStateSelections((previous) => ({ ...previous, [group.id]: next }));
                          }}
                        >
                          <option value="auto">Auto</option>
                          {group.options.map((option) => (
                            <option key={`${group.id}-${option.index}`} value={String(option.index)}>
                              {option.paneName}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                  {iconRenderStateOptions.length > 0 ? (
                    <div className="state-control">
                      <label htmlFor="icon-state">Icon State</label>
                      <select
                        id="icon-state"
                        value={iconRenderState}
                        onChange={(event) => setIconRenderState(event.target.value)}
                      >
                        <option value="auto">Auto</option>
                        {iconRenderStateOptions.map((state) => (
                          <option key={state} value={state}>
                            {state}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  {iconPaneStateGroups.map((group) => {
                    const controlId = `icon-pane-state-${normalizeDomId(group.id)}`;
                    const parsedValue = Number.parseInt(String(iconPaneStateSelections[group.id]), 10);
                    const value = Number.isFinite(parsedValue) ? String(parsedValue) : "auto";
                    return (
                      <div className="state-control" key={`icon-pane-group-${group.id}`}>
                        <label htmlFor={controlId}>Icon {group.label}</label>
                        <select
                          id={controlId}
                          value={value}
                          onChange={(event) => {
                            const next = event.target.value === "auto"
                              ? null
                              : Number.parseInt(event.target.value, 10);
                            setIconPaneStateSelections((previous) => ({ ...previous, [group.id]: next }));
                          }}
                        >
                          <option value="auto">Auto</option>
                          {group.options.map((option) => (
                            <option key={`${group.id}-${option.index}`} value={String(option.index)}>
                              {option.paneName}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                  {availableTitleLocales.length > 1 ? (
                    <div className="state-control">
                      <label htmlFor="title-locale">Locale</label>
                      <select
                        id="title-locale"
                        value={titleLocale}
                        onChange={(event) => setTitleLocale(event.target.value)}
                      >
                        <option value="auto">Auto</option>
                        {availableTitleLocales.map((localeCode) => (
                          <option key={localeCode} value={localeCode}>
                            {TITLE_LOCALE_LABELS[localeCode] ?? localeCode}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
                {canCustomizeWeather ? (
                  <div className="custom-weather-settings">
                    <label className="custom-weather-toggle">
                      <input
                        type="checkbox"
                        checked={useCustomWeather}
                        onChange={(event) => setUseCustomWeather(event.target.checked)}
                      />
                      <span>Use Custom Weather Data</span>
                    </label>
                    {useCustomWeather ? (
                      <div className="custom-weather-grid">
                        <div className="state-control">
                          <label htmlFor="custom-weather-condition">Condition</label>
                          <select
                            id="custom-weather-condition"
                            value={customCondition}
                            onChange={(event) => setCustomCondition(event.target.value)}
                          >
                            {WEATHER_CONDITION_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="state-control">
                          <label htmlFor="custom-weather-temp">Temperature</label>
                          <div className="custom-weather-temp-row">
                            <input
                              id="custom-weather-temp"
                              type="number"
                              value={customTemperature}
                              onChange={(event) => setCustomTemperature(event.target.value)}
                            />
                            <select
                              value={customTemperatureUnit}
                              onChange={(event) => setCustomTemperatureUnit(event.target.value)}
                            >
                              <option value="F">F</option>
                              <option value="C">C</option>
                            </select>
                          </div>
                        </div>
                        <div className="state-control">
                          <label htmlFor="custom-weather-city">City</label>
                          <input
                            id="custom-weather-city"
                            type="text"
                            value={customCity}
                            onChange={(event) => setCustomCity(event.target.value)}
                          />
                        </div>
                        <div className="state-control">
                          <label htmlFor="custom-weather-time">Time Label</label>
                          <input
                            id="custom-weather-time"
                            type="text"
                            value={customTimeLabel}
                            onChange={(event) => setCustomTimeLabel(event.target.value)}
                          />
                        </div>
                        <div className="state-control custom-weather-wide">
                          <label htmlFor="custom-weather-telop">Description</label>
                          <textarea
                            id="custom-weather-telop"
                            value={customTelop}
                            onChange={(event) => setCustomTelop(event.target.value)}
                            rows={3}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="anim-status">{animStatus}</div>

                <div className="audio-section">
                  <label>Channel Audio</label>
                  {audioUrl ? (
                    <audio
                      ref={audioElementRef}
                      controls
                      loop={parsed?.results?.audio?.loopFlag ?? false}
                      src={audioUrl}
                    />
                  ) : (
                    <div className="empty-state">No channel audio decoded.</div>
                  )}
                  <div className="audio-meta">{audioInfo}</div>
                </div>
              </div>

              <div className="info-panel">
                {parsed ? (
                  <>
                    <div>
                      <span className="key">Title ID:</span> <span className="val">{parsed.wad.titleId}</span>
                    </div>
                    <div>
                      <span className="key">WAD Type:</span>{" "}
                      <span className="val">0x{parsed.wad.wadType.toString(16)}</span>
                    </div>
                    <div>
                      <span className="key">Contents:</span>{" "}
                      <span className="val">{parsed.wad.numContents} file(s)</span>
                    </div>
                  </>
                ) : (
                  <span className="val">No WAD data parsed.</span>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "textures" ? (
            <div className="tab-content active">
              <div className="section-title">Banner Textures</div>
              <div className="textures-grid">
                {bannerTextureEntries.length === 0 ? (
                  <div className="empty-state">No banner textures decoded.</div>
                ) : (
                  bannerTextureEntries.map((entry) => <TextureCard key={entry.key} entry={entry} />)
                )}
              </div>

              <div className="section-title icon-title">Icon Textures</div>
              <div className="textures-grid">
                {iconTextureEntries.length === 0 ? (
                  <div className="empty-state">No icon textures decoded.</div>
                ) : (
                  iconTextureEntries.map((entry) => <TextureCard key={entry.key} entry={entry} />)
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "layout" ? (
            <div className="tab-content active">
              <div className="section-title">BRLYT Layout Data</div>
              <pre className="info-panel info-pre">{layoutInfo}</pre>
              <div className="section-title icon-title">BRLAN Animation Data</div>
              <pre className="info-panel info-pre">{animationInfo}</pre>
            </div>
          ) : null}

          {activeTab === "log" ? (
            <div className="tab-content active">
              <div className="section-title">Parse Log</div>
              <div className="log">
                {logEntries.map((entry, index) => (
                  <div className={entry.level} key={`${entry.level}-${index}`}>
                    [{entry.level.toUpperCase()}] {entry.message}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
