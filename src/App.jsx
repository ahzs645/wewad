import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BannerRenderer,
  createGlBannerRenderer,
  flattenTextures,
  processArchive,
  processWAD,
  processZipBundle,
} from "@firstform/wii-channel-renderer";

import { TABS, PREVIEW_QUALITY_OPTIONS, DEFAULT_PREVIEW_QUALITY, resolvePreviewQuality } from "./constants";
import { createArrayLogger, formatLayoutInfo, formatAnimationInfo, formatDuration } from "./utils/formatters";
import { suggestInitialFrame, resolveAnimationSelection } from "./utils/animation";
import { buildWiiShopIconOverrides, collectRenderStateOptions, mergeRelatedRsoAnimations } from "./utils/renderState";
import { resolveWeatherRenderState, resolveNewsRenderState, resolveCustomWeatherBannerFrame } from "./utils/weather";
import { getUsedTextureNames, resolveIconViewport, createRecentIconPreview } from "./utils/layout";
import { createAudioSyncController } from "./utils/audioSync";
import { saveRecentWad } from "./utils/recentWads";
import { sortTitleLocales, arePaneStateGroupsEqual, shallowEqualSelections, normalizePaneStateSelections } from "./utils/misc";

import { useTheme } from "./hooks/useTheme";
import { useRecentWads } from "./hooks/useRecentWads";
import { useCustomizationSettings } from "./hooks/useCustomizationSettings";
import { useExportSettings } from "./hooks/useExportSettings";
import { useRendererPlayback } from "./hooks/useRendererPlayback";
import { useBundleExportActions } from "./hooks/useBundleExportActions";

import { Sidebar } from "./components/Sidebar";
import { PreviewTab } from "./components/tabs/PreviewTab";
import { ExportTab } from "./components/tabs/ExportTab";
import { TexturesTab } from "./components/tabs/TexturesTab";
import { ChannelDataTab } from "./components/tabs/ChannelDataTab";
import { DebugTab } from "./components/tabs/DebugTab";
import { LayoutTab } from "./components/tabs/LayoutTab";
import { LogTab } from "./components/tabs/LogTab";

export default function App() {
  // --- Refs ---
  const fileInputRef = useRef(null);
  const bannerCanvasRef = useRef(null);
  const iconCanvasRef = useRef(null);
  const previewAudioRef = useRef(null);
  const bannerRendererRef = useRef(null);
  const iconRendererRef = useRef(null);
  const bundleFileInputRef = useRef(null);

  const audioSyncRef = useRef(null);
  const timelineRef = useRef(null);

  // --- Core state ---
  const [activeTab, setActiveTab] = useState("preview");
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [animStatus, setAnimStatus] = useState("Frame 0");
  const [phaseMode, setPhaseMode] = useState("full");
  const [startFrame, setStartFrame] = useState(0);
  const [startFrameInput, setStartFrameInput] = useState("0");
  const [hasExplicitStartFrame, setHasExplicitStartFrame] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [parsed, setParsed] = useState(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [logEntries, setLogEntries] = useState([]);

  // --- Render state & locale ---
  const [bannerRenderState, setBannerRenderState] = useState("auto");
  const [bannerAnimOverride, setBannerAnimOverride] = useState(null);
  const [bannerDiscType, setBannerDiscType] = useState("auto");
  const [iconRenderState, setIconRenderState] = useState("auto");
  const [iconAnimOverride, setIconAnimOverride] = useState(null);
  const [iconScene, setIconScene] = useState("auto");
  const [titleLocale, setTitleLocale] = useState("auto");
  const [availableTitleLocales, setAvailableTitleLocales] = useState([]);
  const [bannerPaneStateGroups, setBannerPaneStateGroups] = useState([]);
  const [iconPaneStateGroups, setIconPaneStateGroups] = useState([]);
  const [bannerPaneStateSelections, setBannerPaneStateSelections] = useState({});
  const [iconPaneStateSelections, setIconPaneStateSelections] = useState({});

  // --- Display & export ---
  const [previewDisplay, setPreviewDisplay] = useState("both");
  const [previewDisplayAspect, setPreviewDisplayAspect] = useState("4:3");
  const [tevQuality, setTevQuality] = useState("fast");
  const [previewQuality, setPreviewQuality] = useState(DEFAULT_PREVIEW_QUALITY);
  const [bannerBackdropMask, setBannerBackdropMask] = useState(false);
  const [rendererBackend, setRendererBackend] = useState("canvas");
  const exportSettings = useExportSettings();

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

  const bannerAnimSelection = useMemo(
    () => resolveAnimationSelection(parsed?.results?.banner, bannerRenderState, bannerAnimOverride),
    [parsed, bannerRenderState, bannerAnimOverride],
  );

  const customizationSettings = useCustomizationSettings({ parsed });
  const {
    weather: weatherCustomization,
    news: newsCustomization,
    resetCustomization,
  } = customizationSettings;
  const useCustomWeather = weatherCustomization.enabled;
  const customWeatherData = weatherCustomization.data;
  const canCustomizeWeather = weatherCustomization.canCustomize;
  const customNewsData = newsCustomization.data;

  const {
    bannerPlaying,
    iconPlaying,
    isPlaying,
    stopPlaybackState,
    togglePlayback,
    resetPlayback,
    handleTrackTogglePlay,
    handleTrackSeek,
  } = useRendererPlayback({
    bannerRendererRef,
    iconRendererRef,
    audioSyncRef,
    customWeatherData,
    canCustomizeWeather,
  });

  const effectiveIconRenderState = useMemo(() => {
    if (useCustomWeather) {
      return resolveWeatherRenderState(parsed?.results?.icon) ?? iconRenderState;
    }
    if (newsCustomization.enabled) {
      return resolveNewsRenderState(parsed?.results?.icon) ?? iconRenderState;
    }
    return iconRenderState;
  }, [iconRenderState, parsed, useCustomWeather, newsCustomization.enabled]);

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

  // Detect the Wii Shop Channel banner layout (same heuristic the renderer uses).
  // Only this layout has the mask_01/backdrop panes the backdrop-mask path needs,
  // so the toggle is only surfaced here.
  const showBackdropMaskOption = useMemo(() => {
    const layout = parsed?.results?.banner?.renderLayout;
    if (!layout?.panes) return false;
    const names = new Set(layout.panes.map((p) => p.name));
    const textures = layout.textures ?? [];
    return (
      names.has("backCLs") &&
      names.has("mask_01") &&
      names.has("logo_base") &&
      textures.includes("logo_pic01.tpl") &&
      textures.includes("logo_pic02.tpl")
    );
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

    if (bannerDiscType === "all") {
      // Show all disc types simultaneously (Wii+GC visible by default, enable DVD too).
      overrides.set("N_DVD0", true);
      overrides.set("N_Unknown", false);
      overrides.set("UnknownDisk", false);
      overrides.set("ShadeWii_00", false);
      overrides.set("N_Ref0_00", false);
      overrides.set("N_RefUnknown", false);
      overrides.set("RefUnknown", false);
    } else if (bannerDiscType === "none") {
      // Hide everything disc-related.
      overrides.set("N_DVD0", false);
      overrides.set("N_Wii0", false);
      overrides.set("N_GC0", false);
      overrides.set("N_Shade0", false);
      overrides.set("N_Ref0", false);
      overrides.set("N_Unknown", false);
      overrides.set("N_Ref0_00", false);
      overrides.set("ShadeWii_00", false);
    } else if (bannerDiscType === "auto") {
      // Layout defaults: Wii+GC visible, DVD hidden. Just clean up junk panes.
      overrides.set("N_Unknown", false);
      overrides.set("UnknownDisk", false);
      overrides.set("ShadeWii_00", false);
      overrides.set("N_Ref0_00", false);
      overrides.set("N_RefUnknown", false);
      overrides.set("RefUnknown", false);
    } else {
      const wii = bannerDiscType === "wii";
      const gc = bannerDiscType === "gc";
      const dvd = bannerDiscType === "dvd";
      // Show the master disc container (N_DVD0 is visible=false by default).
      overrides.set("N_DVD0", dvd);
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

  // Disc Channel icon has two scenes: N_GCIcon (normal) and N_DiscUpdateIcon
  // (system update). On real Wii only one shows at a time.
  const showIconSceneOption = useMemo(() => {
    const iconResult = parsed?.results?.icon;
    if (!iconResult) return false;
    // Check both renderLayout and raw layout panes for the disc channel icon scenes
    const panes = iconResult.renderLayout?.panes ?? iconResult.layout?.panes ?? [];
    if (panes.length === 0) return false;
    const names = new Set(panes.map((p) => p.name));
    return names.has("N_DiscUpdateIcon") && names.has("N_GCIcon");
  }, [parsed]);

  const iconPaneVisibilityOverrides = useMemo(() => {
    const overrides = new Map();

    // Wii Shop Channel icon: hide the empty WiiConnect24 recommendation slots
    // (duplicate "ghost cards" + blank caption text) so the offline icon shows
    // the bags logo + wordmark on the tiled background. No-op for other layouts.
    const wiiShop = buildWiiShopIconOverrides(parsed?.results?.icon);
    if (wiiShop) {
      for (const [name, visible] of wiiShop) overrides.set(name, visible);
    }

    if (showIconSceneOption) {
      // Disc Channel icon: hide the inactive scene.
      overrides.set(iconScene === "update" ? "N_GCIcon" : "N_DiscUpdateIcon", false);
    }

    return overrides.size > 0 ? overrides : null;
  }, [parsed, showIconSceneOption, iconScene]);

  const iconAnimSelection = useMemo(() => {
    const selection = resolveAnimationSelection(parsed?.results?.icon, effectiveIconRenderState, iconAnimOverride);
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
  }, [parsed, effectiveIconRenderState, iconAnimOverride]);

  const timelineTracks = useMemo(() => {
    if (!parsed) return [];
    const buildTrack = (sel, id, label) => {
      const startFrames = phaseMode === "loopOnly" ? 0 : (sel.startAnim?.frameSize ?? 0);
      const loopFrames = phaseMode === "startOnly" ? 0 : (sel.loopAnim?.frameSize ?? sel.anim?.frameSize ?? 0);
      if (startFrames + loopFrames <= 0) return null;
      return { id, label, startFrames, loopFrames, playbackMode: sel.playbackMode ?? "loop" };
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

  const effectiveBannerStartFrame = useMemo(() => {
    if (!customWeatherData || !canCustomizeWeather) return startFrame;
    return resolveCustomWeatherBannerFrame(bannerAnimSelection, startFrame);
  }, [bannerAnimSelection, canCustomizeWeather, customWeatherData, startFrame]);

  const effectiveIconStartFrame = useMemo(() => {
    const baseFrame = hasExplicitStartFrame ? startFrame : 0;
    if (!customWeatherData || !canCustomizeWeather) return baseFrame;
    return resolveCustomWeatherBannerFrame(iconAnimSelection, baseFrame);
  }, [canCustomizeWeather, customWeatherData, hasExplicitStartFrame, iconAnimSelection, startFrame]);

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
    audioSyncRef.current?.stop();
  }, []);

  const handleFile = useCallback(
    async (file) => {
      if (!file) return;

      setSelectedFileName(file.name);
      setIsProcessing(true);
      stopPlaybackState();
      setAnimStatus("Frame 0");
      setPhaseMode("full");
      setActiveTab("preview");
      setBannerRenderState("auto");
      setBannerAnimOverride(null);
      setBannerDiscType("auto");
      setIconRenderState("auto");
      setIconAnimOverride(null);
      setIconScene("auto");
      setTitleLocale("auto");
      setAvailableTitleLocales([]);
      setBannerPaneStateGroups([]);
      setIconPaneStateGroups([]);
      setBannerPaneStateSelections({});
      setIconPaneStateSelections({});
      resetCustomization();

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
        setHasExplicitStartFrame(false);
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
    [resetCustomization, stopPlaybackState, stopRenderers, setRecentWads],
  );

  // Keep the ref in sync so the useRecentWads hook can call handleFile
  handleFileRef.current = handleFile;

  const applyStartFrame = useCallback(() => {
    const next = normalizeStartFrame(startFrameInput);
    setStartFrame(next);
    setStartFrameInput(String(next));
    setHasExplicitStartFrame(true);
  }, [normalizeStartFrame, startFrameInput]);

  const useCurrentFrame = useCallback(() => {
    const current = bannerRendererRef.current?.frame ?? iconRendererRef.current?.frame ?? startFrame;
    const next = normalizeStartFrame(current);
    setStartFrame(next);
    setStartFrameInput(String(next));
    setHasExplicitStartFrame(true);
  }, [normalizeStartFrame, startFrame]);

  const exportCanvas = useCallback((canvasRef, filename) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, []);

  const exportActions = useBundleExportActions({
    parsed,
    selectedFileName,
    bannerCanvasRef,
    iconCanvasRef,
    bundleFileInputRef,
    exportSettings,
    bannerAnimSelection,
    iconAnimSelection,
    tevQuality,
    titleLocale,
    bannerPaneStateSelections,
  });

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

  // Web Audio controller (replaces HTML <audio> + sync)
  useEffect(() => {
    const audio = parsed?.results?.audio;
    if (!audio?.pcm16?.length) {
      audioSyncRef.current?.dispose();
      audioSyncRef.current = null;
      setHasAudio(false);
      return undefined;
    }
    const animationLoops = phaseMode !== "startOnly";
    const controller = createAudioSyncController(previewAudioRef.current, audio, 60, { animationLoops });
    audioSyncRef.current = controller;
    setHasAudio(Boolean(controller));
    return () => {
      controller?.dispose();
      audioSyncRef.current = null;
      setHasAudio(false);
    };
  }, [parsed, phaseMode]);

  // Main renderer setup
  useEffect(() => {
    stopRenderers();
    stopPlaybackState();

    if (!parsed || activeTab !== "preview") {
      return () => stopRenderers();
    }

    const bannerResult = parsed.results.banner;
    const iconResult = parsed.results.icon;
    const requestedLocale = titleLocale === "auto" ? undefined : titleLocale;
    const qualityPreset = resolvePreviewQuality(previewQuality);
    // Pick the rendering backend. WebGL is experimental; fall back to Canvas if it
    // throws (e.g. context creation fails) so the preview never breaks.
    const makeRenderer = (canvas, rLayout, rAnim, rTpl, rOptions) => {
      if (rendererBackend === "webgl") {
        try {
          return createGlBannerRenderer(canvas, rLayout, rAnim, rTpl, rOptions);
        } catch (error) {
          console.warn("WebGL backend unavailable, falling back to Canvas:", error);
        }
      }
      return new BannerRenderer(canvas, rLayout, rAnim, rTpl, rOptions);
    };

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
      const bannerRenderer = makeRenderer(
        bannerCanvasRef.current,
        bannerResult.renderLayout,
        bannerPhaseOpts.anim,
        bannerResult.tplImages,
        {
          initialFrame: effectiveBannerStartFrame,
          maxRenderFps: qualityPreset.maxRenderFps,
          maxDevicePixelRatio: qualityPreset.maxDevicePixelRatio,
          enableWiiShopBackdropMask: bannerBackdropMask,
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
      const effectiveIconRenderLayout = iconAnimSelection.renderLayout ?? iconResult.renderLayout;
      const iconViewport = resolveIconViewport(effectiveIconRenderLayout);
      const iconLayout = { ...effectiveIconRenderLayout, width: iconViewport.width, height: iconViewport.height };
      const iconPhaseOpts = resolvePhaseModeOptions(iconAnimSelection);
      const iconRenderer = makeRenderer(
        iconCanvasRef.current,
        iconLayout,
        iconPhaseOpts.anim,
        iconResult.tplImages,
        {
          initialFrame: effectiveIconStartFrame,
          maxRenderFps: qualityPreset.maxRenderFps,
          maxDevicePixelRatio: qualityPreset.maxDevicePixelRatio,
          startAnim: iconPhaseOpts.startAnim,
          loopAnim: iconPhaseOpts.loopAnim,
          renderState: iconAnimSelection.renderState,
          playbackMode: iconPhaseOpts.playbackMode,
          paneStateSelections: customWeatherData || customNewsData ? null : iconPaneStateSelections,
          paneVisibilityOverrides: iconPaneVisibilityOverrides,
          titleLocale: requestedLocale,
          customWeather: customWeatherData,
          customNews: customNewsData,
          displayAspect: previewDisplayAspect,
          referenceAspectRatio: iconViewport.width / iconViewport.height,
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
    previewDisplayAspect, tevQuality, previewQuality, bannerBackdropMask, rendererBackend, phaseMode, bannerPaneVisibilityOverrides, bannerAlphaMaskPanes, bannerTextOverrides,
    iconPaneVisibilityOverrides, iconScene, stopPlaybackState,
  ]);

  // Start frame sync
  useEffect(() => {
    const bannerRenderer = bannerRendererRef.current;
    const iconRenderer = iconRendererRef.current;
    if (!bannerRenderer && !iconRenderer) return;
    bannerRenderer?.setStartFrame(effectiveBannerStartFrame);
    iconRenderer?.setStartFrame(effectiveIconStartFrame);
    audioSyncRef.current?.stop();
    stopPlaybackState();
  }, [effectiveBannerStartFrame, effectiveIconStartFrame, startFrame, stopPlaybackState]);

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
                  preview={{ previewDisplay, setPreviewDisplay }}
                  canvases={{
                    bannerCanvasRef,
                    iconCanvasRef,
                    audioElementRef: previewAudioRef,
                    exportCanvas,
                  }}
                  playback={{ isPlaying, togglePlayback, resetPlayback }}
                  frameControls={{
                    startFrameInput,
                    setStartFrameInput,
                    maxStartFrame,
                    applyStartFrame,
                    useCurrentFrame,
                  }}
                  displaySettings={{
                    previewDisplayAspect,
                    setPreviewDisplayAspect,
                    tevQuality,
                    setTevQuality,
                    previewQuality,
                    setPreviewQuality,
                    rendererBackend,
                    setRendererBackend,
                  }}
                  renderSettings={{
                    bannerRenderState,
                    setBannerRenderState,
                    bannerRenderStateOptions,
                    bannerAnimOverride,
                    setBannerAnimOverride,
                    bannerDiscType,
                    setBannerDiscType,
                    showDiscTypeOption: bannerDiscPaneNames != null,
                    iconAnimOverride,
                    setIconAnimOverride,
                    iconScene,
                    setIconScene,
                    showIconSceneOption,
                    iconRenderState,
                    setIconRenderState,
                    iconRenderStateOptions,
                    titleLocale,
                    setTitleLocale,
                    availableTitleLocales,
                    bannerPaneStateGroups,
                    bannerPaneStateSelections,
                    setBannerPaneStateSelections,
                    iconPaneStateGroups,
                    iconPaneStateSelections,
                    setIconPaneStateSelections,
                    bannerBackdropMask,
                    setBannerBackdropMask,
                    showBackdropMaskOption,
                  }}
                  customization={customizationSettings}
                  status={{ animStatus, hasAudio, audioInfo }}
                  parsed={parsed}
                  timeline={{
                    phaseMode,
                    setPhaseMode,
                    hasStartAnim,
                    hasLoopAnim,
                    timelineRef,
                    timelineTracks: timelineTracks.map(t => ({
                      ...t,
                      isPlaying: t.id === "banner" ? bannerPlaying : iconPlaying,
                    })),
                    onTrackTogglePlay: handleTrackTogglePlay,
                    onTrackSeek: handleTrackSeek,
                  }}
                />
              ) : null}

              {activeTab === "export" ? (
                <ExportTab
                  exportState={exportSettings}
                  exportActions={exportActions}
                  parsed={parsed}
                  renderSettings={{
                    tevQuality,
                    setTevQuality,
                    bannerAnimOverride,
                    setBannerAnimOverride,
                    bannerDiscType,
                    setBannerDiscType,
                    showDiscTypeOption: bannerDiscPaneNames != null,
                    iconAnimOverride,
                    setIconAnimOverride,
                    titleLocale,
                    setTitleLocale,
                    availableTitleLocales,
                    bannerPaneStateGroups,
                    bannerPaneStateSelections,
                    setBannerPaneStateSelections,
                    iconPaneStateGroups,
                    iconPaneStateSelections,
                    setIconPaneStateSelections,
                  }}
                />
              ) : null}

              {activeTab === "textures" ? (
                <TexturesTab
                  bannerTextureEntries={bannerTextureEntries}
                  iconTextureEntries={iconTextureEntries}
                />
              ) : null}

              {activeTab === "channelData" ? (
                <ChannelDataTab
                  wadTitleId={parsed?.wad?.titleId}
                  customization={customizationSettings}
                  onAppliedToPreview={() => setActiveTab("preview")}
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
