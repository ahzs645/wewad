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
};

export const TITLE_LOCALE_ORDER = ["JP", "NE", "GE", "SP", "IT", "FR", "US", "KR"];

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
