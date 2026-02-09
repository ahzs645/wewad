const WEATHER_ICON_PANE_NAMES = new Set([
  "W_sun_00",
  "W_cloud_00",
  "W_cloud_01",
  "W_cloud_02",
  "W_fog_00",
  "W_moon_00",
  "W_rain_00",
  "W_thunder_00",
  "W_wind_00",
  "W_hail_all",
  "W_sleet_all",
  "W_snow_all",
]);

const WEATHER_TEMP_DIGIT_PANE_NAMES = new Set([
  "kion_doF100",
  "kion_doF10",
  "kion_doF_do",
  "kion_doF_F",
]);

const WEATHER_FALLBACK_TEXT_PANE_PATTERN = /^textT\d+/i;
const WEATHER_FALLBACK_PANEL_PANE_PATTERN = /^textB\d+/i;
const WEATHER_TEMP_PANE_PATTERN = /^kion_doF/i;

const WEATHER_ICON_LAYER_PRIORITY = {
  W_sun_00: 0,
  W_moon_00: 0,
  W_cloud_00: 1,
  W_cloud_01: 1,
  W_cloud_02: 1,
  W_fog_00: 1,
  W_rain_00: 2,
  W_thunder_00: 2,
  W_wind_00: 2,
  W_hail_all: 2,
  W_sleet_all: 2,
  W_snow_all: 2,
};

const CONDITION_ICON_PRESETS = {
  clear: ["W_sun_00"],
  night: ["W_moon_00"],
  partly_cloudy: ["W_sun_00", "W_cloud_00"],
  cloudy: ["W_cloud_01", "W_cloud_02"],
  rain: ["W_cloud_01", "W_rain_00"],
  thunderstorm: ["W_cloud_01", "W_rain_00", "W_thunder_00"],
  snow: ["W_cloud_01", "W_snow_all"],
  sleet: ["W_cloud_01", "W_sleet_all"],
  hail: ["W_cloud_01", "W_hail_all"],
  fog: ["W_fog_00"],
  windy: ["W_cloud_00", "W_wind_00"],
};

function normalizeCondition(value) {
  if (!value) {
    return null;
  }

  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function isWeatherFallbackTextPane(renderer, pane) {
  if (!pane) {
    return false;
  }

  const paneName = String(pane.name ?? "");
  if (WEATHER_FALLBACK_TEXT_PANE_PATTERN.test(paneName)) {
    return true;
  }

  const transformChain = renderer.getPaneTransformChain?.(pane) ?? [];
  for (const chainPane of transformChain) {
    const chainPaneName = String(chainPane?.name ?? "");
    if (WEATHER_FALLBACK_TEXT_PANE_PATTERN.test(chainPaneName)) {
      return true;
    }
  }

  return false;
}

function isWeatherFallbackPanelPane(renderer, pane) {
  if (!pane) {
    return false;
  }

  const paneName = String(pane.name ?? "");
  if (WEATHER_FALLBACK_PANEL_PANE_PATTERN.test(paneName)) {
    return true;
  }

  const transformChain = renderer.getPaneTransformChain?.(pane) ?? [];
  for (const chainPane of transformChain) {
    const chainPaneName = String(chainPane?.name ?? "");
    if (WEATHER_FALLBACK_PANEL_PANE_PATTERN.test(chainPaneName)) {
      return true;
    }
  }

  return false;
}

function resolveCustomTemperatureBounds(renderer, pane, width, height) {
  const baseHalfWidth = Math.abs(width) / 2;
  const baseHalfHeight = Math.abs(height) / 2;
  let minX = -baseHalfWidth;
  let maxX = baseHalfWidth;
  let minY = -baseHalfHeight;
  let maxY = baseHalfHeight;

  const paneName = String(pane?.name ?? "");
  if (!paneName) {
    return {
      minX,
      maxX,
      minY,
      maxY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }

  for (const childPane of renderer.layout?.panes ?? []) {
    if (String(childPane?.parent ?? "") !== paneName) {
      continue;
    }

    const childName = String(childPane?.name ?? "");
    if (!WEATHER_TEMP_DIGIT_PANE_NAMES.has(childName) && !WEATHER_TEMP_PANE_PATTERN.test(childName)) {
      continue;
    }

    const childWidth = Math.max(1, Math.abs(childPane?.size?.w ?? width));
    const childHeight = Math.max(1, Math.abs(childPane?.size?.h ?? height));
    const childX = Number.isFinite(childPane?.translate?.x) ? childPane.translate.x : 0;
    const childY = Number.isFinite(childPane?.translate?.y) ? childPane.translate.y : 0;

    minX = Math.min(minX, childX - childWidth / 2);
    maxX = Math.max(maxX, childX + childWidth / 2);
    minY = Math.min(minY, childY - childHeight / 2);
    maxY = Math.max(maxY, childY + childHeight / 2);
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function isCustomWeatherEnabled() {
  return Boolean(this.customWeather && this.customWeather.enabled !== false);
}

export function resolveCustomWeatherIconPaneSet() {
  if (!this.isCustomWeatherEnabled()) {
    return null;
  }

  const customIconPaneNames = Array.isArray(this.customWeather.iconPaneNames)
    ? this.customWeather.iconPaneNames
        .map((name) => String(name))
        .filter((name) => WEATHER_ICON_PANE_NAMES.has(name))
    : null;
  if (customIconPaneNames && customIconPaneNames.length > 0) {
    return new Set(customIconPaneNames);
  }

  const condition = normalizeCondition(this.customWeather.condition);
  if (!condition) {
    return null;
  }

  const preset = CONDITION_ICON_PRESETS[condition];
  if (!preset || preset.length === 0) {
    return null;
  }

  return new Set(preset);
}

export function getCustomWeatherTextForPane(pane) {
  if (!this.isCustomWeatherEnabled() || !pane) {
    return null;
  }

  const paneName = String(pane.name ?? "");
  if (paneName === "city" || paneName === "city_sdw") {
    if (typeof this.customWeather.city === "string" && this.customWeather.city.trim().length > 0) {
      return this.customWeather.city.trim();
    }
    return null;
  }

  if (paneName === "telop" || paneName === "telop_sdw") {
    if (typeof this.customWeather.telop === "string" && this.customWeather.telop.trim().length > 0) {
      return this.customWeather.telop.trim();
    }
    return null;
  }

  if (paneName === "timeWW") {
    if (typeof this.customWeather.timeLabel === "string" && this.customWeather.timeLabel.trim().length > 0) {
      return this.customWeather.timeLabel.trim();
    }
    return null;
  }

  if (/^sprt_WW/i.test(paneName)) {
    if (typeof this.customWeather.supportText === "string" && this.customWeather.supportText.trim().length > 0) {
      return this.customWeather.supportText.trim();
    }
    return null;
  }

  return null;
}

export function shouldRenderPaneForCustomWeather(pane) {
  if (!this.isCustomWeatherEnabled() || !pane) {
    return true;
  }

  const paneName = String(pane.name ?? "");

  if (isWeatherFallbackTextPane(this, pane)) {
    return false;
  }
  if (isWeatherFallbackPanelPane(this, pane)) {
    return false;
  }

  if (this.customWeatherIconPaneSet && WEATHER_ICON_PANE_NAMES.has(paneName)) {
    return this.customWeatherIconPaneSet.has(paneName);
  }

  const customTemperature = Number.parseInt(String(this.customWeather.temperature), 10);
  if (Number.isFinite(customTemperature) && WEATHER_TEMP_DIGIT_PANE_NAMES.has(paneName)) {
    return false;
  }

  return true;
}

export function shouldDrawCustomTemperatureForPane(pane) {
  if (!this.isCustomWeatherEnabled() || !pane) {
    return false;
  }

  const customTemperature = Number.parseInt(String(this.customWeather.temperature), 10);
  if (!Number.isFinite(customTemperature)) {
    return false;
  }

  return String(pane.name ?? "") === "kion_doF1";
}

export function drawCustomTemperaturePane(context, pane, width, height) {
  const value = Number.parseInt(String(this.customWeather?.temperature), 10);
  if (!Number.isFinite(value)) {
    return false;
  }

  const unit = String(this.customWeather?.temperatureUnit ?? "F").trim().toUpperCase() === "C" ? "C" : "F";
  const text = `${value}\u00b0${unit}`;

  const bounds = resolveCustomTemperatureBounds(this, pane, width, height);
  const absWidth = Math.max(1, bounds.width);
  const absHeight = Math.max(1, bounds.height);
  const glyphCount = Math.max(1, text.length);
  const widthLimitedSize = (absWidth * 0.9) / Math.max(1, glyphCount * 0.56);
  const fontSize = Math.max(14, Math.min(absHeight * 0.95, widthLimitedSize));
  const baselineY = (bounds.minY + bounds.maxY) / 2;

  context.save();
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.font = `700 ${fontSize}px sans-serif`;
  context.lineJoin = "round";
  context.strokeStyle = "rgba(0, 54, 120, 0.65)";
  context.lineWidth = Math.max(2, fontSize * 0.12);
  context.fillStyle = "rgba(180, 225, 255, 0.98)";
  const x = bounds.minX + Math.max(2, absWidth * 0.03);
  context.strokeText(text, x, baselineY, absWidth);
  context.fillText(text, x, baselineY, absWidth);
  context.restore();
  return true;
}

export function getCustomWeatherVisibilityOverride(pane) {
  if (!this.isCustomWeatherEnabled() || !pane) {
    return null;
  }

  if (!this.customWeatherIconPaneSet) {
    return null;
  }

  const paneName = String(pane.name ?? "");
  if (!WEATHER_ICON_PANE_NAMES.has(paneName)) {
    return null;
  }

  return this.customWeatherIconPaneSet.has(paneName);
}

export function getCustomWeatherOrderedPanes(panes) {
  if (!this.isCustomWeatherEnabled() || !Array.isArray(panes) || panes.length < 2) {
    return panes;
  }

  const weatherEntries = [];
  for (let index = 0; index < panes.length; index += 1) {
    const pane = panes[index];
    const paneName = String(pane?.name ?? "");
    if (!WEATHER_ICON_PANE_NAMES.has(paneName)) {
      continue;
    }

    weatherEntries.push({
      index,
      pane,
      priority: WEATHER_ICON_LAYER_PRIORITY[paneName] ?? 1,
    });
  }

  if (weatherEntries.length < 2) {
    return panes;
  }

  const sortedWeatherEntries = [...weatherEntries].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return left.index - right.index;
  });

  const orderedPanes = [...panes];
  let replacementCursor = 0;
  for (let index = 0; index < panes.length; index += 1) {
    const paneName = String(panes[index]?.name ?? "");
    if (!WEATHER_ICON_PANE_NAMES.has(paneName)) {
      continue;
    }

    orderedPanes[index] = sortedWeatherEntries[replacementCursor].pane;
    replacementCursor += 1;
  }

  return orderedPanes;
}
