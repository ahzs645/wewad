import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BannerRenderer,
  flattenTextures,
  processArchive,
  processWAD,
  processZipBundle,
} from "./lib/wadRenderer";
import { downloadBlob, exportBundle, loadBundle, revokeBundle } from "./lib/exportBundle";
import { exportGsapBundle } from "./lib/gsapExport";

import { TABS, WEATHER_CONDITION_OPTIONS } from "./constants";
import { createArrayLogger, formatLayoutInfo, formatAnimationInfo, formatDuration } from "./utils/formatters";
import { suggestInitialFrame, resolveAnimationSelection } from "./utils/animation";
import { collectRenderStateOptions, mergeRelatedRsoAnimations } from "./utils/renderState";
import { hasWeatherScene, hasNewsScene, resolveWeatherRenderState, resolveCustomWeatherBannerFrame } from "./utils/weather";
import { getUsedTextureNames, resolveIconViewport, createRecentIconPreview } from "./utils/layout";
import { createWavBuffer } from "./utils/audio";
import { createAudioSyncController } from "./utils/audioSync";
import { saveRecentWad } from "./utils/recentWads";
import { sortTitleLocales, arePaneStateGroupsEqual, shallowEqualSelections, normalizePaneStateSelections } from "./utils/misc";

import { useTheme } from "./hooks/useTheme";
import { useRecentWads } from "./hooks/useRecentWads";

import { Sidebar } from "./components/Sidebar";
import { PreviewTab } from "./components/tabs/PreviewTab";
import { ExportTab } from "./components/tabs/ExportTab";
import { TexturesTab } from "./components/tabs/TexturesTab";
import { DebugTab } from "./components/tabs/DebugTab";
import { LayoutTab } from "./components/tabs/LayoutTab";
import { LogTab } from "./components/tabs/LogTab";

export default function App() {
  // --- Refs ---
  const fileInputRef = useRef(null);
  const bannerCanvasRef = useRef(null);
  const iconCanvasRef = useRef(null);
  const audioElementRef = useRef(null);
  const bannerRendererRef = useRef(null);
  const iconRendererRef = useRef(null);
  const bundleFileInputRef = useRef(null);

  const audioSyncRef = useRef(null);
  const timelineRef = useRef(null);

  // --- Core state ---
  const [activeTab, setActiveTab] = useState("preview");
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [bannerPlaying, setBannerPlaying] = useState(false);
  const [iconPlaying, setIconPlaying] = useState(false);
  const isPlaying = bannerPlaying || iconPlaying;
  const [animStatus, setAnimStatus] = useState("Frame 0");
  const [phaseMode, setPhaseMode] = useState("full");
  const [startFrame, setStartFrame] = useState(0);
  const [startFrameInput, setStartFrameInput] = useState("0");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [parsed, setParsed] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [logEntries, setLogEntries] = useState([]);

  // --- Render state & locale ---
  const [bannerRenderState, setBannerRenderState] = useState("auto");
  const [bannerAnimOverride, setBannerAnimOverride] = useState(null);
  const [bannerDiscType, setBannerDiscType] = useState("auto");
  const [iconRenderState, setIconRenderState] = useState("auto");
  const [titleLocale, setTitleLocale] = useState("auto");
  const [availableTitleLocales, setAvailableTitleLocales] = useState([]);
  const [bannerPaneStateGroups, setBannerPaneStateGroups] = useState([]);
  const [iconPaneStateGroups, setIconPaneStateGroups] = useState([]);
  const [bannerPaneStateSelections, setBannerPaneStateSelections] = useState({});
  const [iconPaneStateSelections, setIconPaneStateSelections] = useState({});

  // --- Custom weather/news ---
  const [useCustomWeather, setUseCustomWeather] = useState(false);
  const [customCondition, setCustomCondition] = useState("partly_cloudy");
  const [customCity, setCustomCity] = useState("Seattle");
  const [customTelop, setCustomTelop] = useState("Partly cloudy with a chance of evening rain.");
  const [customTimeLabel, setCustomTimeLabel] = useState("Updated 9:41 AM");
  const [customTemperature, setCustomTemperature] = useState("72");
  const [customTemperatureUnit, setCustomTemperatureUnit] = useState("F");
  const [useCustomNews, setUseCustomNews] = useState(false);
  const [customHeadlines, setCustomHeadlines] = useState("Breaking: Wii Channel banners now render in the browser\nNintendo announces new system update\nLocal weather: sunny skies expected all week");

  // --- Display & export ---
  const [previewDisplay, setPreviewDisplay] = useState("both");
  const [previewDisplayAspect, setPreviewDisplayAspect] = useState("4:3");
  const [tevQuality, setTevQuality] = useState("fast");
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [exportAspect, setExportAspect] = useState("4:3");
  const [bundlePreview, setBundlePreview] = useState(null);
  const [bundlePreviewSection, setBundlePreviewSection] = useState("snapshots");

  // --- Custom hooks ---
  const { themePreference, setThemePreference } = useTheme();

  const handleFileRef = useRef(null);
  const { recentWads, setRecentWads, isLoadingRecentId, loadRecentWad, clearRecentWadsList } =
    useRecentWads(
      useCallback((file) => handleFileRef.current?.(file), []),
      isProcessing,
    );

  // --- Derived / memoized values ---
  const bannerRenderStateOptions = useMemo(
    () => collectRenderStateOptions(parsed?.results?.banner),
    [parsed],
  );
  const iconRenderStateOptions = useMemo(
    () => collectRenderStateOptions(parsed?.results?.icon),
    [parsed],
  );

  const effectiveIconRenderState = useMemo(() => {
    if (!useCustomWeather) return iconRenderState;
    return resolveWeatherRenderState(parsed?.results?.icon) ?? iconRenderState;
  }, [iconRenderState, parsed, useCustomWeather]);

  const bannerAnimSelection = useMemo(
    () => resolveAnimationSelection(parsed?.results?.banner, bannerRenderState, bannerAnimOverride),
    [parsed, bannerRenderState, bannerAnimOverride],
  );

  // Detect whether the banner layout has Disc Channel disc-type panes.
  const bannerDiscPaneNames = useMemo(() => {
    const panes = parsed?.results?.banner?.renderLayout?.panes;
    if (!panes) return null;
    const names = new Set(panes.map((p) => p.name));
    if (names.has("WiiDisk") && names.has("GCDisk") && names.has("DVDDisk")) {
      return names;
    }
    return null;
  }, [parsed]);

  // Build pane visibility overrides for disc channel layouts.
  // Always hide panes that render incorrectly in Canvas 2D (GX clipping masks,
  // untextured window panes, reflection panes with complex TEV materials).
  // Note: WeWAD's BRLYT parser produces a flat sibling structure under N_Disk —
  // discs, shadows, reflections, and masks are all siblings, not nested children.
  const bannerPaneVisibilityOverrides = useMemo(() => {
    if (!bannerDiscPaneNames) return null;
    const overrides = new Map();
    // BackMask2 is a GX clipping mask — renders as solid gray/black in Canvas 2D.
    overrides.set("BackMask2", false);
    // Window panes have untextured content materials (color1=[0,0,0,0]) —
    // on real hardware their content is filled dynamically by the System Menu.
    overrides.set("W_DVD", false);
    overrides.set("W_Wii", false);
    overrides.set("W_GC", false);

    if (bannerDiscType !== "auto") {
      // Show the master disc container (N_DVD0 is visible=false by default).
      overrides.set("N_DVD0", true);
      const wii = bannerDiscType === "wii";
      const gc = bannerDiscType === "gc";
      const dvd = bannerDiscType === "dvd";
      // Disc meshes
      overrides.set("DVDDisk", dvd);
      overrides.set("N_Wii0", wii);
      overrides.set("WiiDisk", wii);
      overrides.set("N_GC0", gc);
      overrides.set("GCDisk", gc);
      // Shadows
      overrides.set("SahdeDVD", dvd);
      overrides.set("ShadeWii", wii);
      overrides.set("ShadeGC", gc);
      // Reflections
      overrides.set("N_RefDVD", dvd);
      overrides.set("RefDVD", dvd);
      overrides.set("N_RefWii", wii);
      overrides.set("RefWii", wii);
      overrides.set("N_RefGC", gc);
      overrides.set("RefGC", gc);
      // Unknown disc + reflection
      overrides.set("N_Unknown", false);
      overrides.set("UnknownDisk", false);
      overrides.set("ShadeWii_00", false);
      overrides.set("N_Ref0_00", false);
      overrides.set("N_RefUnknown", false);
      overrides.set("RefUnknown", false);
    }
    return overrides;
  }, [bannerDiscPaneNames, bannerDiscType]);

  // Reflection panes rely on BackMask2 for circular clipping on real hardware.
  // In Canvas 2D we post-multiply the TEV alpha by the first texture's alpha
  // so the disc's circular shape is preserved.
  const bannerAlphaMaskPanes = useMemo(() => {
    if (!bannerDiscPaneNames) return null;
    return new Set(["RefDVD", "RefWii", "RefGC", "RefUnknown"]);
  }, [bannerDiscPaneNames]);

  // Disc Channel text overrides — the System Menu firmware writes localized BMG
  // strings into text panes at runtime.  We replicate that here.
  const bannerTextOverrides = useMemo(() => {
    if (!bannerDiscPaneNames) return null;
    const DISC_CHANNEL_STRINGS = {
      US: { title: "Disc Channel", insert: "Please insert a disc." },
      JP: { title: "ディスクドライブチャンネル", insert: "ディスクを挿入してください。" },
      FR: { title: "Chaîne disques", insert: "Veuillez insérer un disque." },
      GE: { title: "Disc-Kanal", insert: "Bitte schiebe eine Disc ein." },
      IT: { title: "Canale Disco", insert: "Inserisci un disco." },
      NE: { title: "Diskkanaal", insert: "Voer een disk in." },
      SP: { title: "Canal Disco", insert: "Inserta un disco en la consola." },
    };
    const localeKey = titleLocale === "auto" ? "US" : (titleLocale || "US");
    const strings = DISC_CHANNEL_STRINGS[localeKey] ?? DISC_CHANNEL_STRINGS.US;
    return {
      T_Bar: strings.title,
      T_Comment0: strings.insert,
      T_Comment1: "",
    };
  }, [bannerDiscPaneNames, titleLocale]);

  const iconAnimSelection = useMemo(() => {
    const selection = resolveAnimationSelection(parsed?.results?.icon, effectiveIconRenderState);
    if (!selection.anim || !selection.renderState) return selection;

    const iconResult = parsed?.results?.icon;
    let mergedAnim = mergeRelatedRsoAnimations(selection.anim, iconResult, selection.renderState);
    if (mergedAnim === selection.anim) return selection;

    const layoutPanes = iconResult?.renderLayout?.panes;
    if (layoutPanes) {
      const animatedNames = new Set(mergedAnim.panes.map((p) => p.name));
      const txtBgHideEntries = layoutPanes
        .filter((p) => /^P_txtBg_\d+$/.test(p.name) && !animatedNames.has(p.name))
        .map((p) => ({
          name: p.name,
          tags: [{
            type: "RLVC",
            entries: [{
              targetGroup: 0, type: 0x10, dataType: 2, typeName: "RLVC",
              interpolation: "hermite", preExtrapolation: "clamp", postExtrapolation: "clamp",
              keyframes: [{ frame: 0, value: 0, blend: 0 }],
            }],
          }],
        }));
      if (txtBgHideEntries.length > 0) {
        mergedAnim = { ...mergedAnim, panes: [...mergedAnim.panes, ...txtBgHideEntries] };
      }
    }

    return {
      ...selection,
      anim: mergedAnim,
      loopAnim: selection.loopAnim === selection.anim ? mergedAnim : selection.loopAnim,
    };
  }, [parsed, effectiveIconRenderState]);

  const timelineTracks = useMemo(() => {
    if (!parsed) return [];
    const buildTrack = (sel, id, label) => {
      const startFrames = phaseMode === "loopOnly" ? 0 : (sel.startAnim?.frameSize ?? 0);
      const loopFrames = phaseMode === "startOnly" ? 0 : (sel.loopAnim?.frameSize ?? sel.anim?.frameSize ?? 0);
      if (startFrames + loopFrames <= 0) return null;
      return { id, label, startFrames, loopFrames };
    };
    const tracks = [];
    if (previewDisplay !== "icon") {
      const t = buildTrack(bannerAnimSelection, "banner", "Banner");
      if (t) tracks.push(t);
    }
    if (previewDisplay !== "banner") {
      const t = buildTrack(iconAnimSelection, "icon", "Icon");
      if (t) tracks.push(t);
    }
    return tracks;
  }, [parsed, phaseMode, previewDisplay, bannerAnimSelection, iconAnimSelection]);

  const hasStartAnim = timelineTracks.some((t) => t.startFrames > 0);
  const hasLoopAnim = timelineTracks.some((t) => t.loopFrames > 0);

  const canCustomizeWeather = useMemo(
    () => hasWeatherScene(parsed?.results?.banner?.renderLayout),
    [parsed],
  );

  const customWeatherData = useMemo(() => {
    if (!useCustomWeather || !canCustomizeWeather) return null;
    const parsedTemperature = Number.parseInt(customTemperature, 10);
    return {
      enabled: true,
      condition: customCondition,
      city: customCity,
      telop: WEATHER_CONDITION_OPTIONS.find((o) => o.value === customCondition)?.label ?? customCondition,
      timeLabel: customTimeLabel,
      temperature: Number.isFinite(parsedTemperature) ? parsedTemperature : null,
      temperatureUnit: customTemperatureUnit,
    };
  }, [useCustomWeather, canCustomizeWeather, customCondition, customCity, customTimeLabel, customTemperature, customTemperatureUnit]);

  const canCustomizeNews = useMemo(
    () => hasNewsScene(parsed?.results?.icon?.renderLayout),
    [parsed],
  );

  const customNewsData = useMemo(() => {
    if (!useCustomNews || !canCustomizeNews) return null;
    const headlines = customHeadlines.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    return headlines.length === 0 ? null : { enabled: true, headlines };
  }, [useCustomNews, canCustomizeNews, customHeadlines]);

  const effectiveBannerStartFrame = useMemo(() => {
    if (!customWeatherData || !canCustomizeWeather) return startFrame;
    return resolveCustomWeatherBannerFrame(bannerAnimSelection, startFrame);
  }, [bannerAnimSelection, canCustomizeWeather, customWeatherData, startFrame]);

  const effectiveIconStartFrame = useMemo(() => {
    if (!customWeatherData || !canCustomizeWeather) return startFrame;
    return resolveCustomWeatherBannerFrame(iconAnimSelection, startFrame);
  }, [canCustomizeWeather, customWeatherData, iconAnimSelection, startFrame]);

  const maxStartFrame = useMemo(() => {
    if (!parsed) return 959;
    const bannerStartFrames = bannerAnimSelection.startAnim?.frameSize ?? 0;
    const bannerFrames = bannerAnimSelection.anim?.frameSize ?? bannerAnimSelection.loopAnim?.frameSize ?? 0;
    const iconStartFrames = iconAnimSelection.startAnim?.frameSize ?? 0;
    const iconFrames = iconAnimSelection.anim?.frameSize ?? iconAnimSelection.loopAnim?.frameSize ?? 0;
    if (bannerStartFrames > 0) return Math.max(1, bannerStartFrames) - 1;
    if (iconStartFrames > 0) return Math.max(1, iconStartFrames) - 1;
    return Math.max(1, bannerFrames, iconFrames) - 1;
  }, [parsed, bannerAnimSelection, iconAnimSelection]);

  const bannerTextureEntries = useMemo(
    () => flattenTextures(parsed?.results.banner?.tplImages ?? {}),
    [parsed],
  );
  const iconTextureEntries = useMemo(
    () => flattenTextures(parsed?.results.icon?.tplImages ?? {}),
    [parsed],
  );
  const bannerUsedTextures = useMemo(
    () => getUsedTextureNames(parsed?.results.banner?.renderLayout),
    [parsed],
  );
  const iconUsedTextures = useMemo(
    () => getUsedTextureNames(parsed?.results.icon?.renderLayout),
    [parsed],
  );
  const layoutInfo = useMemo(() => formatLayoutInfo(parsed?.results.banner?.layout), [parsed]);
  const animationInfo = useMemo(() => formatAnimationInfo(parsed?.results.banner?.anim), [parsed]);
  const audioInfo = useMemo(() => {
    const audio = parsed?.results?.audio;
    if (!audio) return "No channel audio decoded.";
    const loopText = audio.loopFlag ? `loop starts at sample ${audio.loopStart}` : "no loop";
    return `${audio.channelCount} channel(s), ${audio.sampleRate} Hz, ${audio.sampleCount} samples, ${formatDuration(audio.durationSeconds)}, ${loopText}`;
  }, [parsed]);

  const showRenderArea = Boolean(parsed || logEntries.length > 0);

  // --- Callbacks ---
  const normalizeStartFrame = useCallback(
    (rawValue) => {
      const parsedValue = Number.parseInt(String(rawValue), 10);
      if (!Number.isFinite(parsedValue)) return 0;
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
      if (!file) return;

      setSelectedFileName(file.name);
      setIsProcessing(true);
      setBannerPlaying(false);
      setIconPlaying(false);
      setAnimStatus("Frame 0");
      setPhaseMode("full");
      setActiveTab("preview");
      setBannerRenderState("auto");
      setBannerAnimOverride(null);
      setBannerDiscType("auto");
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
        const ext = file.name.toLowerCase().split(".").pop();
        let result;
        if (ext === "arc") {
          result = processArchive(buffer, logger);
        } else if (ext === "zip") {
          result = await processZipBundle(buffer, logger);
        } else {
          result = await processWAD(buffer, logger);
        }

        if (!result.results.banner && !result.results.icon) {
          logger.warn("No banner or icon content could be rendered.");
        }

        const suggestedFrame = suggestInitialFrame(result);
        setStartFrame(suggestedFrame);
        setStartFrameInput(String(suggestedFrame));
        setAnimStatus(`Frame ${suggestedFrame}`);
        setParsed(result);

        try {
          const iconPreviewUrl = createRecentIconPreview(result, BannerRenderer);
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
    [stopRenderers, setRecentWads],
  );

  // Keep the ref in sync so the useRecentWads hook can call handleFile
  handleFileRef.current = handleFile;

  const togglePlayback = useCallback(() => {
    const bannerRenderer = bannerRendererRef.current;
    const iconRenderer = iconRendererRef.current;
    const audioElement = audioElementRef.current;
    const freezeVisualPlayback = Boolean(customWeatherData && canCustomizeWeather);

    if (!bannerRenderer && !iconRenderer && !audioElement) return;

    if (isPlaying) {
      bannerRenderer?.stop();
      iconRenderer?.stop();
      audioElement?.pause();
      setBannerPlaying(false);
      setIconPlaying(false);
      return;
    }

    if (!freezeVisualPlayback && bannerRenderer) { bannerRenderer.play(); setBannerPlaying(true); }
    if (!freezeVisualPlayback && iconRenderer) { iconRenderer.play(); setIconPlaying(true); }
    if (audioElement && audioUrl) {
      const info = bannerRenderer?.getPlaybackInfo() ?? iconRenderer?.getPlaybackInfo();
      if (info) audioSyncRef.current?.seekToFrame(info.audioFrame ?? info.globalFrame);
      audioElement.play()?.catch(() => {});
    }
  }, [audioUrl, canCustomizeWeather, customWeatherData, isPlaying]);

  const resetPlayback = useCallback(() => {
    bannerRendererRef.current?.stop();
    iconRendererRef.current?.stop();
    bannerRendererRef.current?.reset();
    iconRendererRef.current?.reset();
    const audioElement = audioElementRef.current;
    if (audioElement) { audioElement.pause(); audioElement.currentTime = 0; }
    setBannerPlaying(false);
    setIconPlaying(false);
  }, []);

  const handleTrackTogglePlay = useCallback((trackId) => {
    if (trackId === "banner") {
      const renderer = bannerRendererRef.current;
      if (!renderer) return;
      if (bannerPlaying) {
        renderer.stop();
        audioElementRef.current?.pause();
        setBannerPlaying(false);
      } else {
        renderer.play();
        if (audioElementRef.current && audioUrl) {
          const info = renderer.getPlaybackInfo();
          if (info) audioSyncRef.current?.seekToFrame(info.audioFrame ?? info.globalFrame);
          audioElementRef.current.play()?.catch(() => {});
        }
        setBannerPlaying(true);
      }
    } else if (trackId === "icon") {
      const renderer = iconRendererRef.current;
      if (!renderer) return;
      if (iconPlaying) {
        renderer.stop();
        setIconPlaying(false);
      } else {
        renderer.play();
        setIconPlaying(true);
      }
    }
  }, [bannerPlaying, iconPlaying, audioUrl]);

  const handleTrackSeek = useCallback((trackId, globalFrame) => {
    if (trackId === "banner") {
      bannerRendererRef.current?.seekToFrame(globalFrame);
      audioSyncRef.current?.seekToFrame(globalFrame);
    } else if (trackId === "icon") {
      iconRendererRef.current?.seekToFrame(globalFrame);
    }
  }, []);

  const applyStartFrame = useCallback(() => {
    const next = normalizeStartFrame(startFrameInput);
    setStartFrame(next);
    setStartFrameInput(String(next));
  }, [normalizeStartFrame, startFrameInput]);

  const useCurrentFrame = useCallback(() => {
    const current = bannerRendererRef.current?.frame ?? iconRendererRef.current?.frame ?? startFrame;
    const next = normalizeStartFrame(current);
    setStartFrame(next);
    setStartFrameInput(String(next));
  }, [normalizeStartFrame, startFrame]);

  const exportCanvas = useCallback((canvasRef, filename) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, []);

  const handleExportBundle = useCallback(async (includeFrames = false) => {
    if (!parsed || isExporting) return;
    setIsExporting(true);
    setExportProgress("Preparing...");

    try {
      const blob = await exportBundle({
        parsed,
        sourceFileName: selectedFileName,
        bannerCanvas: bannerCanvasRef.current,
        iconCanvas: iconCanvasRef.current,
        options: { includeFrames, includeTextures: true, includeAudio: true, exportAspect },
        BannerRenderer,
        bannerAnimSelection,
        iconAnimSelection,
        rendererOptions: {
          tevQuality,
          titleLocale: titleLocale === "auto" ? undefined : titleLocale,
          paneStateSelections: bannerPaneStateSelections,
        },
        onProgress: (stage, current, total) => {
          const labels = {
            loading: "Loading zip library...",
            snapshots: "Capturing snapshots...",
            textures: `Exporting textures (${current}/${total})...`,
            audio: "Exporting audio...",
            "banner-frames": `Rendering banner frames (${current}/${total})...`,
            "icon-frames": `Rendering icon frames (${current}/${total})...`,
            compressing: "Compressing zip...",
            done: "Done!",
          };
          setExportProgress(labels[stage] ?? `${stage} ${current}/${total}`);
        },
      });

      if (bundlePreview) revokeBundle(bundlePreview);
      const preview = await loadBundle(blob);
      setBundlePreview(preview);

      const titleId = parsed.wad?.titleId ?? "export";
      const safeName = selectedFileName
        ? selectedFileName.replace(/\.wad$/i, "").replace(/[^a-zA-Z0-9_\-() [\]]/g, "_")
        : titleId;
      downloadBlob(blob, `${safeName}.zip`);
    } catch (error) {
      console.error("Export failed:", error);
      setExportProgress(`Export failed: ${error.message}`);
    } finally {
      setTimeout(() => { setIsExporting(false); setExportProgress(""); }, 2000);
    }
  }, [parsed, isExporting, selectedFileName, bannerAnimSelection, iconAnimSelection, exportAspect, tevQuality, titleLocale, bannerPaneStateSelections, bundlePreview]);

  const handleExportGsap = useCallback(async () => {
    if (!parsed || isExporting) return;
    setIsExporting(true);
    setExportProgress("Preparing renderer bundle...");

    try {
      const blob = await exportGsapBundle({
        parsed,
        sourceFileName: selectedFileName,
        bannerAnimSelection,
        iconAnimSelection,
        rendererOptions: {
          tevQuality,
          titleLocale: titleLocale === "auto" ? undefined : titleLocale,
          paneStateSelections: bannerPaneStateSelections,
        },
        exportAspect,
        onProgress: (stage, current, total) => {
          const labels = {
            loading: "Loading zip library...",
            "banner-textures": `Encoding banner textures (${current}/${total})...`,
            "icon-textures": `Encoding icon textures (${current}/${total})...`,
            compressing: "Compressing zip...",
            done: "Done!",
          };
          setExportProgress(labels[stage] ?? `${stage} ${current}/${total}`);
        },
      });

      const titleId = parsed.wad?.titleId ?? "export";
      const safeName = selectedFileName
        ? selectedFileName.replace(/\.wad$/i, "").replace(/[^a-zA-Z0-9_\-() [\]]/g, "_")
        : titleId;
      downloadBlob(blob, `${safeName}-renderer-bundle.zip`);
    } catch (error) {
      console.error("Renderer bundle export failed:", error);
      setExportProgress(`Export failed: ${error.message}`);
    } finally {
      setTimeout(() => { setIsExporting(false); setExportProgress(""); }, 2000);
    }
  }, [parsed, isExporting, selectedFileName, bannerAnimSelection, iconAnimSelection, exportAspect, tevQuality, titleLocale, bannerPaneStateSelections]);

  const handleLoadBundleZip = useCallback(async (file) => {
    if (!file) return;
    try {
      if (bundlePreview) revokeBundle(bundlePreview);
      const preview = await loadBundle(file);
      setBundlePreview(preview);
    } catch (error) {
      console.error("Failed to load bundle:", error);
    }
  }, [bundlePreview]);

  // --- Effects ---

  // Validate render state selections against available options
  useEffect(() => {
    if (bannerRenderState !== "auto" && !bannerRenderStateOptions.includes(bannerRenderState)) {
      setBannerRenderState("auto");
    }
  }, [bannerRenderState, bannerRenderStateOptions]);

  useEffect(() => {
    if (iconRenderState !== "auto" && !iconRenderStateOptions.includes(iconRenderState)) {
      setIconRenderState("auto");
    }
  }, [iconRenderState, iconRenderStateOptions]);

  // Audio URL
  useEffect(() => {
    const audio = parsed?.results?.audio;
    if (!audio) { setAudioUrl(null); return undefined; }
    const wavBuffer = createWavBuffer(audio);
    if (!wavBuffer) { setAudioUrl(null); return undefined; }
    const nextAudioUrl = URL.createObjectURL(new Blob([wavBuffer], { type: "audio/wav" }));
    setAudioUrl(nextAudioUrl);
    return () => URL.revokeObjectURL(nextAudioUrl);
  }, [parsed]);

  // Audio sync controller
  useEffect(() => {
    const audio = parsed?.results?.audio;
    const audioEl = audioElementRef.current;
    if (!audio || !audioEl || !audioUrl) {
      audioSyncRef.current = null;
      return undefined;
    }
    const animationLoops = phaseMode !== "startOnly";
    const controller = createAudioSyncController(audioEl, audio, 60, { animationLoops });
    audioSyncRef.current = controller;
    const onTimeUpdate = () => controller?.handleTimeUpdate();
    const onEnded = () => controller?.handleEnded();
    audioEl.addEventListener("timeupdate", onTimeUpdate);
    audioEl.addEventListener("ended", onEnded);
    return () => {
      audioEl.removeEventListener("timeupdate", onTimeUpdate);
      audioEl.removeEventListener("ended", onEnded);
      audioSyncRef.current = null;
    };
  }, [parsed, audioUrl, phaseMode]);

  // Main renderer setup
  useEffect(() => {
    stopRenderers();
    setBannerPlaying(false);
    setIconPlaying(false);
    setAvailableTitleLocales([]);
    setBannerPaneStateGroups([]);
    setIconPaneStateGroups([]);

    if (!parsed || activeTab !== "preview") {
      return () => stopRenderers();
    }

    const bannerResult = parsed.results.banner;
    const iconResult = parsed.results.icon;
    const requestedLocale = titleLocale === "auto" ? undefined : titleLocale;

    const resolvePhaseModeOptions = (selection) => {
      if (phaseMode === "startOnly" && selection.startAnim) {
        return {
          anim: selection.startAnim,
          startAnim: null,
          loopAnim: null,
          playbackMode: "hold",
        };
      }
      if (phaseMode === "loopOnly") {
        return {
          anim: selection.loopAnim ?? selection.anim ?? null,
          startAnim: null,
          loopAnim: selection.loopAnim ?? selection.anim ?? null,
          playbackMode: selection.playbackMode ?? "loop",
        };
      }
      return {
        anim: selection.anim,
        startAnim: selection.startAnim ?? null,
        loopAnim: selection.loopAnim ?? selection.anim ?? null,
        playbackMode: selection.playbackMode ?? "loop",
      };
    };

    if (bannerResult && bannerCanvasRef.current) {
      const bannerPhaseOpts = resolvePhaseModeOptions(bannerAnimSelection);
      const bannerRenderer = new BannerRenderer(
        bannerCanvasRef.current,
        bannerResult.renderLayout,
        bannerPhaseOpts.anim,
        bannerResult.tplImages,
        {
          initialFrame: effectiveBannerStartFrame,
          startAnim: bannerPhaseOpts.startAnim,
          loopAnim: bannerPhaseOpts.loopAnim,
          renderState: bannerAnimSelection.renderState,
          playbackMode: bannerPhaseOpts.playbackMode,
          paneStateSelections: customWeatherData ? null : bannerPaneStateSelections,
          titleLocale: requestedLocale,
          customWeather: customWeatherData,
          paneVisibilityOverrides: bannerPaneVisibilityOverrides,
          paneAlphaMaskFromFirstTexture: bannerAlphaMaskPanes,
          textOverrides: bannerTextOverrides,
          displayAspect: previewDisplayAspect,
          tevQuality,
          fonts: bannerResult.fonts,
          onFrame: (frame, total, phase, globalFrame, audioFrame) => {
            timelineRef.current?.updatePlayhead("banner", globalFrame);
            audioSyncRef.current?.syncFrame(audioFrame);
          },
        },
      );
      bannerRenderer.render();
      bannerRendererRef.current = bannerRenderer;
    }

    if (iconResult && iconCanvasRef.current) {
      const iconViewport = resolveIconViewport(iconResult.renderLayout);
      const iconLayout = { ...iconResult.renderLayout, width: iconViewport.width, height: iconViewport.height };
      const iconPhaseOpts = resolvePhaseModeOptions(iconAnimSelection);
      const iconRenderer = new BannerRenderer(
        iconCanvasRef.current,
        iconLayout,
        iconPhaseOpts.anim,
        iconResult.tplImages,
        {
          initialFrame: effectiveIconStartFrame,
          startAnim: iconPhaseOpts.startAnim,
          loopAnim: iconPhaseOpts.loopAnim,
          renderState: iconAnimSelection.renderState,
          playbackMode: iconPhaseOpts.playbackMode,
          paneStateSelections: customWeatherData ? null : iconPaneStateSelections,
          titleLocale: requestedLocale,
          customWeather: customWeatherData,
          customNews: customNewsData,
          displayAspect: previewDisplayAspect,
          tevQuality,
          fonts: iconResult.fonts,
          onFrame: (frame, total, phase, globalFrame, _audioFrame) => {
            timelineRef.current?.updatePlayhead("icon", globalFrame);
          },
        },
      );
      iconRenderer.render();
      iconRendererRef.current = iconRenderer;
    }

    const nextBannerPaneGroups = bannerRendererRef.current?.getAvailablePaneStateGroups?.() ?? [];
    const nextIconPaneGroups = iconRendererRef.current?.getAvailablePaneStateGroups?.() ?? [];
    setBannerPaneStateGroups((prev) => arePaneStateGroupsEqual(prev, nextBannerPaneGroups) ? prev : nextBannerPaneGroups);
    setIconPaneStateGroups((prev) => arePaneStateGroupsEqual(prev, nextIconPaneGroups) ? prev : nextIconPaneGroups);
    setBannerPaneStateSelections((prev) => {
      const normalized = normalizePaneStateSelections(prev, nextBannerPaneGroups);
      return shallowEqualSelections(prev, normalized) ? prev : normalized;
    });
    setIconPaneStateSelections((prev) => {
      const normalized = normalizePaneStateSelections(prev, nextIconPaneGroups);
      return shallowEqualSelections(prev, normalized) ? prev : normalized;
    });

    const localeSet = new Set();
    for (const locale of bannerRendererRef.current?.getAvailableTitleLocales?.() ?? []) localeSet.add(locale);
    for (const locale of iconRendererRef.current?.getAvailableTitleLocales?.() ?? []) localeSet.add(locale);
    const sortedLocales = sortTitleLocales([...localeSet]);
    setAvailableTitleLocales(sortedLocales);
    if (titleLocale !== "auto" && !localeSet.has(titleLocale)) setTitleLocale("auto");

    return () => stopRenderers();
  }, [
    activeTab, parsed, startFrame, effectiveBannerStartFrame, effectiveIconStartFrame,
    stopRenderers, bannerAnimSelection, iconAnimSelection, titleLocale,
    bannerPaneStateSelections, iconPaneStateSelections, customWeatherData, customNewsData,
    previewDisplayAspect, tevQuality, phaseMode, bannerPaneVisibilityOverrides, bannerAlphaMaskPanes, bannerTextOverrides,
  ]);

  // Start frame sync
  useEffect(() => {
    const bannerRenderer = bannerRendererRef.current;
    const iconRenderer = iconRendererRef.current;
    const audioElement = audioElementRef.current;
    if (!bannerRenderer && !iconRenderer && !audioElement) return;
    bannerRenderer?.setStartFrame(effectiveBannerStartFrame);
    iconRenderer?.setStartFrame(effectiveIconStartFrame);
    if (audioElement) { audioElement.pause(); audioElement.currentTime = 0; }
    setBannerPlaying(false);
    setIconPlaying(false);
  }, [effectiveBannerStartFrame, effectiveIconStartFrame, startFrame]);

  // Clamp start frame when max changes
  useEffect(() => {
    if (!parsed) return;
    const clamped = normalizeStartFrame(startFrame);
    if (clamped === startFrame) return;
    setStartFrame(clamped);
    setStartFrameInput(String(clamped));
  }, [maxStartFrame, normalizeStartFrame, parsed, startFrame]);

  // --- Render ---
  return (
    <div className="app">
      <Sidebar
        fileInputRef={fileInputRef}
        isDragOver={isDragOver}
        setIsDragOver={setIsDragOver}
        isProcessing={isProcessing}
        selectedFileName={selectedFileName}
        handleFile={handleFile}
        recentWads={recentWads}
        isLoadingRecentId={isLoadingRecentId}
        loadRecentWad={loadRecentWad}
        clearRecentWadsList={clearRecentWadsList}
        themePreference={themePreference}
        setThemePreference={setThemePreference}
      />

      <div className="main-area">
        {showRenderArea ? (
          <nav className="tab-bar">
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
          </nav>
        ) : null}

        <main className="main-content">
          {showRenderArea ? (
            <div className="render-area">
              {activeTab === "preview" ? (
                <PreviewTab
                  previewDisplay={previewDisplay} setPreviewDisplay={setPreviewDisplay}
                  bannerCanvasRef={bannerCanvasRef} iconCanvasRef={iconCanvasRef}
                  isPlaying={isPlaying} togglePlayback={togglePlayback} resetPlayback={resetPlayback}
                  exportCanvas={exportCanvas}
                  startFrameInput={startFrameInput} setStartFrameInput={setStartFrameInput}
                  maxStartFrame={maxStartFrame} applyStartFrame={applyStartFrame} useCurrentFrame={useCurrentFrame}
                  previewDisplayAspect={previewDisplayAspect} setPreviewDisplayAspect={setPreviewDisplayAspect}
                  tevQuality={tevQuality} setTevQuality={setTevQuality}
                  bannerRenderState={bannerRenderState} setBannerRenderState={setBannerRenderState}
                  bannerRenderStateOptions={bannerRenderStateOptions}
                  bannerAnimOverride={bannerAnimOverride} setBannerAnimOverride={setBannerAnimOverride}
                  bannerDiscType={bannerDiscType} setBannerDiscType={setBannerDiscType}
                  showDiscTypeOption={bannerDiscPaneNames != null}
                  iconRenderState={iconRenderState} setIconRenderState={setIconRenderState}
                  iconRenderStateOptions={iconRenderStateOptions}
                  titleLocale={titleLocale} setTitleLocale={setTitleLocale}
                  availableTitleLocales={availableTitleLocales}
                  bannerPaneStateGroups={bannerPaneStateGroups}
                  bannerPaneStateSelections={bannerPaneStateSelections}
                  setBannerPaneStateSelections={setBannerPaneStateSelections}
                  iconPaneStateGroups={iconPaneStateGroups}
                  iconPaneStateSelections={iconPaneStateSelections}
                  setIconPaneStateSelections={setIconPaneStateSelections}
                  useCustomWeather={useCustomWeather} setUseCustomWeather={setUseCustomWeather}
                  customCondition={customCondition} setCustomCondition={setCustomCondition}
                  customCity={customCity} setCustomCity={setCustomCity}
                  customTelop={customTelop} setCustomTelop={setCustomTelop}
                  customTimeLabel={customTimeLabel} setCustomTimeLabel={setCustomTimeLabel}
                  customTemperature={customTemperature} setCustomTemperature={setCustomTemperature}
                  customTemperatureUnit={customTemperatureUnit} setCustomTemperatureUnit={setCustomTemperatureUnit}
                  useCustomNews={useCustomNews} setUseCustomNews={setUseCustomNews}
                  customHeadlines={customHeadlines} setCustomHeadlines={setCustomHeadlines}
                  animStatus={animStatus}
                  audioUrl={audioUrl} audioElementRef={audioElementRef} audioInfo={audioInfo}
                  parsed={parsed}
                  showWeatherOptions={canCustomizeWeather} showNewsOptions={canCustomizeNews}
                  phaseMode={phaseMode} setPhaseMode={setPhaseMode}
                  hasStartAnim={hasStartAnim} hasLoopAnim={hasLoopAnim}
                  timelineRef={timelineRef}
                  timelineTracks={timelineTracks.map(t => ({
                    ...t,
                    isPlaying: t.id === "banner" ? bannerPlaying : iconPlaying,
                  }))}
                  onTrackTogglePlay={handleTrackTogglePlay}
                  onTrackSeek={handleTrackSeek}
                />
              ) : null}

              {activeTab === "export" ? (
                <ExportTab
                  exportAspect={exportAspect} setExportAspect={setExportAspect}
                  isExporting={isExporting} exportProgress={exportProgress}
                  parsed={parsed}
                  handleExportBundle={handleExportBundle}
                  handleExportGsap={handleExportGsap}
                  bundleFileInputRef={bundleFileInputRef}
                  handleLoadBundleZip={handleLoadBundleZip}
                  bundlePreview={bundlePreview}
                  bundlePreviewSection={bundlePreviewSection} setBundlePreviewSection={setBundlePreviewSection}
                />
              ) : null}

              {activeTab === "textures" ? (
                <TexturesTab
                  bannerTextureEntries={bannerTextureEntries}
                  iconTextureEntries={iconTextureEntries}
                />
              ) : null}

              {activeTab === "debug" ? (
                <DebugTab
                  bannerTextureEntries={bannerTextureEntries}
                  iconTextureEntries={iconTextureEntries}
                  bannerUsedTextures={bannerUsedTextures}
                  iconUsedTextures={iconUsedTextures}
                />
              ) : null}

              {activeTab === "layout" ? (
                <LayoutTab layoutInfo={layoutInfo} animationInfo={animationInfo} />
              ) : null}

              {activeTab === "log" ? (
                <LogTab logEntries={logEntries} />
              ) : null}
            </div>
          ) : (
            <div className="main-content-empty">
              Load a WAD file to get started
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
