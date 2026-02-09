import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BannerRenderer,
  TPL_FORMATS,
  flattenTextures,
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

function suggestInitialFrame(result) {
  const startAnim = result?.results?.banner?.animStart;
  if (!startAnim) {
    return 0;
  }

  const maxFrame = Math.max(0, (startAnim.frameSize ?? 1) - 1);
  const titleReveal = findAlphaRevealFrame(startAnim, /^N_title/i);
  if (titleReveal != null) {
    return clampFrame(titleReveal, maxFrame);
  }

  const anyReveal = findAlphaRevealFrame(startAnim);
  if (anyReveal != null) {
    return clampFrame(anyReveal, maxFrame);
  }

  return 0;
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

function resolveAnimationSelection(targetResult, selectedState) {
  const activeState = normalizeRenderState(selectedState);
  if (!targetResult) {
    return { anim: null, startAnim: null, loopAnim: null, renderState: activeState };
  }

  if (!activeState) {
    return {
      anim: targetResult.anim ?? null,
      startAnim: targetResult.animStart ?? null,
      loopAnim: targetResult.animLoop ?? targetResult.anim ?? null,
      renderState: null,
    };
  }

  const stateAnimEntry = (targetResult.animEntries ?? []).find(
    (entry) => normalizeRenderState(entry?.state) === activeState,
  );
  const selectedAnim =
    stateAnimEntry?.anim ??
    targetResult.animLoop ??
    targetResult.animStart ??
    targetResult.anim ??
    null;

  return {
    anim: selectedAnim,
    startAnim: null,
    loopAnim: selectedAnim,
    renderState: activeState,
  };
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
    nextSelections[group.id] = hasCurrent ? currentValue : group.options[0]?.index ?? 0;
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

  const bannerRenderStateOptions = useMemo(
    () => collectRenderStateOptions(parsed?.results?.banner),
    [parsed],
  );
  const iconRenderStateOptions = useMemo(
    () => collectRenderStateOptions(parsed?.results?.icon),
    [parsed],
  );

  const bannerAnimSelection = useMemo(
    () => resolveAnimationSelection(parsed?.results?.banner, bannerRenderState),
    [parsed, bannerRenderState],
  );
  const iconAnimSelection = useMemo(
    () => resolveAnimationSelection(parsed?.results?.icon, iconRenderState),
    [parsed, iconRenderState],
  );

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
          initialFrame: startFrame,
          startAnim: bannerAnimSelection.startAnim ?? null,
          loopAnim: bannerAnimSelection.loopAnim ?? bannerAnimSelection.anim ?? null,
          renderState: bannerAnimSelection.renderState,
          paneStateSelections: bannerPaneStateSelections,
          titleLocale: requestedLocale,
          onFrame: (frame, total, phase) => {
            const phaseLabel = phase === "start" ? "Start" : "Loop";
            setAnimStatus(`${phaseLabel} ${frame} / ${total}`);
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
          initialFrame: startFrame,
          startAnim: iconAnimSelection.startAnim ?? null,
          loopAnim: iconAnimSelection.loopAnim ?? iconAnimSelection.anim ?? null,
          renderState: iconAnimSelection.renderState,
          paneStateSelections: iconPaneStateSelections,
          titleLocale: requestedLocale,
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
    stopRenderers,
    bannerAnimSelection,
    iconAnimSelection,
    titleLocale,
    bannerPaneStateSelections,
    iconPaneStateSelections,
  ]);

  useEffect(() => {
    const bannerRenderer = bannerRendererRef.current;
    const iconRenderer = iconRendererRef.current;
    const audioElement = audioElementRef.current;
    if (!bannerRenderer && !iconRenderer && !audioElement) {
      return;
    }

    bannerRenderer?.setStartFrame(startFrame);
    iconRenderer?.setStartFrame(startFrame);
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    setIsPlaying(false);
  }, [startFrame]);

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

    bannerRenderer?.play();
    iconRenderer?.play();
    if (audioElement && audioUrl) {
      const playPromise = audioElement.play();
      if (typeof playPromise?.catch === "function") {
        playPromise.catch(() => {});
      }
    }
    setIsPlaying(true);
  }, [audioUrl, isPlaying]);

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
                {(bannerRenderStateOptions.length > 0 ||
                  iconRenderStateOptions.length > 0 ||
                  bannerPaneStateGroups.length > 0 ||
                  iconPaneStateGroups.length > 0 ||
                  availableTitleLocales.length > 1) ? (
                  <div className="state-settings">
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
                      const fallbackValue = group.options[0]?.index ?? 0;
                      const value = Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
                      return (
                        <div className="state-control" key={`banner-pane-group-${group.id}`}>
                          <label htmlFor={controlId}>Banner {group.label}</label>
                          <select
                            id={controlId}
                            value={String(value)}
                            onChange={(event) => {
                              const next = Number.parseInt(event.target.value, 10);
                              setBannerPaneStateSelections((previous) => ({ ...previous, [group.id]: next }));
                            }}
                          >
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
                      const fallbackValue = group.options[0]?.index ?? 0;
                      const value = Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
                      return (
                        <div className="state-control" key={`icon-pane-group-${group.id}`}>
                          <label htmlFor={controlId}>Icon {group.label}</label>
                          <select
                            id={controlId}
                            value={String(value)}
                            onChange={(event) => {
                              const next = Number.parseInt(event.target.value, 10);
                              setIconPaneStateSelections((previous) => ({ ...previous, [group.id]: next }));
                            }}
                          >
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
