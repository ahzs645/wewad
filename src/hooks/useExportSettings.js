import { useState } from "react";

export function useExportSettings() {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [exportAspect, setExportAspect] = useState("4:3");
  const [exportAnimMode, setExportAnimMode] = useState("all");
  const [bundlePreview, setBundlePreview] = useState(null);
  const [bundlePreviewSection, setBundlePreviewSection] = useState("snapshots");

  return {
    isExporting,
    setIsExporting,
    exportProgress,
    setExportProgress,
    exportAspect,
    setExportAspect,
    exportAnimMode,
    setExportAnimMode,
    bundlePreview,
    setBundlePreview,
    bundlePreviewSection,
    setBundlePreviewSection,
  };
}
