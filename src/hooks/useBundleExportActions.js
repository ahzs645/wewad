import { useCallback, useMemo } from "react";
import { BannerRenderer } from "@firstform/wii-channel-renderer";
import { downloadBlob, exportBundle, loadBundle, revokeBundle } from "@firstform/wii-channel-renderer/export-bundle";
import { exportGsapBundle } from "../lib/gsapExport";

function getExportFileBaseName(parsed, selectedFileName) {
  const titleId = parsed.wad?.titleId ?? "export";
  return selectedFileName
    ? selectedFileName.replace(/\.wad$/i, "").replace(/[^a-zA-Z0-9_\-() [\]]/g, "_")
    : titleId;
}

export function useBundleExportActions({
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
}) {
  const {
    isExporting,
    setIsExporting,
    setExportProgress,
    exportAspect,
    exportAnimMode,
    bundlePreview,
    setBundlePreview,
  } = exportSettings;

  const rendererOptions = useMemo(() => ({
    tevQuality,
    titleLocale: titleLocale === "auto" ? undefined : titleLocale,
    paneStateSelections: bannerPaneStateSelections,
  }), [bannerPaneStateSelections, tevQuality, titleLocale]);

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
        rendererOptions,
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
      downloadBlob(blob, `${getExportFileBaseName(parsed, selectedFileName)}.zip`);
    } catch (error) {
      console.error("Export failed:", error);
      setExportProgress(`Export failed: ${error.message}`);
    } finally {
      setTimeout(() => { setIsExporting(false); setExportProgress(""); }, 2000);
    }
  }, [
    bannerAnimSelection,
    bannerCanvasRef,
    bundlePreview,
    exportAspect,
    iconAnimSelection,
    iconCanvasRef,
    isExporting,
    parsed,
    rendererOptions,
    selectedFileName,
    setBundlePreview,
    setExportProgress,
    setIsExporting,
  ]);

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
        rendererOptions,
        exportAspect,
        exportAllAnimations: exportAnimMode === "all",
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

      downloadBlob(blob, `${getExportFileBaseName(parsed, selectedFileName)}-renderer-bundle.zip`);
    } catch (error) {
      console.error("Renderer bundle export failed:", error);
      setExportProgress(`Export failed: ${error.message}`);
    } finally {
      setTimeout(() => { setIsExporting(false); setExportProgress(""); }, 2000);
    }
  }, [
    bannerAnimSelection,
    exportAnimMode,
    exportAspect,
    iconAnimSelection,
    isExporting,
    parsed,
    rendererOptions,
    selectedFileName,
    setExportProgress,
    setIsExporting,
  ]);

  const handleLoadBundleZip = useCallback(async (file) => {
    if (!file) return;
    try {
      if (bundlePreview) revokeBundle(bundlePreview);
      const preview = await loadBundle(file);
      setBundlePreview(preview);
    } catch (error) {
      console.error("Failed to load bundle:", error);
    }
  }, [bundlePreview, setBundlePreview]);

  return {
    handleExportBundle,
    handleExportGsap,
    bundleFileInputRef,
    handleLoadBundleZip,
  };
}
