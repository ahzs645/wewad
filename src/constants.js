export const TABS = [
  { id: "preview", label: "Preview" },
  { id: "export", label: "Export" },
  { id: "textures", label: "Textures" },
  { id: "debug", label: "Debug" },
  { id: "layout", label: "Layout Info" },
  { id: "log", label: "Parse Log" },
];

export const DISPLAY_ASPECT_OPTIONS = [
  { value: "4:3", label: "4:3 (Wii Standard)" },
  { value: "16:9", label: "16:9 (Wii Widescreen)" },
  { value: "16:10", label: "16:10" },
  { value: "native", label: "Native Layout" },
];

// Live-preview performance presets. The renderer can draw at the full display
// refresh rate and devicePixelRatio, but the banner/icon are software-rendered
// (per-pixel TEV, 100+ panes), so on HiDPI or high-refresh displays that makes
// interactive playback stutter. Each preset bounds the per-frame work without
// changing animation timing (playback stays real-time accurate): maxRenderFps
// caps how often the canvas repaints, maxDevicePixelRatio caps the backing-store
// resolution.
export const PREVIEW_QUALITY_OPTIONS = [
  { value: "smooth", label: "Smooth (60 fps)", maxRenderFps: 60, maxDevicePixelRatio: 2 },
  { value: "balanced", label: "Balanced (30 fps)", maxRenderFps: 30, maxDevicePixelRatio: 2 },
  { value: "performance", label: "Performance (20 fps)", maxRenderFps: 20, maxDevicePixelRatio: 1.5 },
];

export const DEFAULT_PREVIEW_QUALITY = "balanced";

// Rendering backend for the live preview. "canvas" is the mature default;
// "webgl" is an experimental backend that composites panes with exact GX blend
// equations on the GPU (see docs/WEBGL_TEV_MIGRATION_PLAN.md).
export const RENDERER_BACKEND_OPTIONS = [
  { value: "canvas", label: "Canvas 2D (default)" },
  { value: "webgl", label: "WebGL (experimental)" },
];

export function resolvePreviewQuality(value) {
  return (
    PREVIEW_QUALITY_OPTIONS.find((option) => option.value === value) ??
    PREVIEW_QUALITY_OPTIONS.find((option) => option.value === DEFAULT_PREVIEW_QUALITY) ??
    PREVIEW_QUALITY_OPTIONS[0]
  );
}

export const RECENT_WAD_DB_NAME = "wewad";
export const RECENT_WAD_STORE_NAME = "recentWads";
export const RECENT_WAD_DB_VERSION = 1;
export const MAX_RECENT_WADS = 8;

export const TITLE_LOCALE_LABELS = {
  JP: "Japanese (JP)",
  NE: "Dutch (NE)",
  GE: "German (GE)",
  SP: "Spanish (SP)",
  IT: "Italian (IT)",
  FR: "French (FR)",
  US: "English (US)",
  KR: "Korean (KR)",
  CN: "Chinese (CN)",
};

export const TITLE_LOCALE_ORDER = ["JP", "NE", "GE", "SP", "IT", "FR", "US", "KR", "CN"];

export const WEATHER_CONDITION_OPTIONS = [
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
