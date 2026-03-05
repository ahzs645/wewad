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

function collectPerPaneRltpIndices(animData, paneNames) {
  const result = new Map();
  if (!animData?.panes) {
    return result;
  }

  for (const paneAnim of animData.panes) {
    const name = String(paneAnim?.name ?? "");
    if (!paneNames.has(name)) {
      continue;
    }

    for (const tag of paneAnim.tags ?? []) {
      if (tag.type !== "RLTP") {
        continue;
      }

      for (const entry of tag.entries ?? []) {
        for (const kf of entry.keyframes ?? []) {
          const idx = Math.floor(kf.value);
          if (Number.isFinite(idx) && idx >= 0) {
            let set = result.get(name);
            if (!set) {
              set = new Set();
              result.set(name, set);
            }
            set.add(idx);
          }
        }
      }
    }
  }

  return result;
}

function tryNameBasedDigitDiscovery(textures, baseTextureName) {
  // Find all numeric segments in the texture name and try varying each one 0-9.
  // Handles single digits ("num_7"), zero-padded ("num_07"), and multi-segment names.
  const segmentRegex = /(\d+)/g;
  const segments = [];
  let segMatch;
  while ((segMatch = segmentRegex.exec(baseTextureName)) !== null) {
    segments.push({
      start: segMatch.index,
      end: segMatch.index + segMatch[0].length,
      value: segMatch[0],
      numericValue: parseInt(segMatch[0], 10),
    });
  }

  if (segments.length === 0) {
    return null;
  }

  // Try each numeric segment as the potential digit position.
  // Prefer segments whose numeric value is 0-9 (more likely to be a digit).
  const sortedSegments = [...segments].sort((a, b) => {
    const aInRange = a.numericValue >= 0 && a.numericValue <= 9 ? 0 : 1;
    const bInRange = b.numericValue >= 0 && b.numericValue <= 9 ? 0 : 1;
    return aInRange - bInRange;
  });

  for (const seg of sortedSegments) {
    const prefix = baseTextureName.substring(0, seg.start);
    const suffix = baseTextureName.substring(seg.end);
    const padLen = seg.value.length;

    const digitMap = {};
    let found = 0;
    for (let d = 0; d <= 9; d++) {
      const numStr = padLen > 1 ? String(d).padStart(padLen, "0") : String(d);
      const candidateName = `${prefix}${numStr}${suffix}`;
      const idx = textures.indexOf(candidateName);
      if (idx >= 0) {
        digitMap[d] = idx;
        found += 1;
      }
    }

    if (found >= 10) {
      return digitMap;
    }
  }

  return null;
}

function tryCommonTplDigitDiscovery(renderer, textures) {
  // Look for digit textures extracted from a "common" TPL (e.g. TPLCommon.tpl.LZ).
  // These are named {stem}_01.tpl (digit 0) through {stem}_10.tpl (digit 9),
  // with {stem}_00.tpl being the minus sign.
  const commonPrefixes = [];
  for (const name of Object.keys(renderer.textureCanvases)) {
    const match = name.match(/^(.+?)_(\d{2})\.tpl$/i);
    if (match && match[2] === "01") {
      commonPrefixes.push(match[1]);
    }
  }

  for (const prefix of commonPrefixes) {
    // Check if we have images 01-10 (digits 0-9)
    let allFound = true;
    const digits = {};
    for (let d = 0; d <= 9; d++) {
      const imgName = `${prefix}_${String(d + 1).padStart(2, "0")}.tpl`;
      if (!renderer.textureCanvases[imgName]) {
        allFound = false;
        break;
      }
      // Append to layout textures if not already present, so textureIndex lookups work
      let idx = textures.indexOf(imgName);
      if (idx < 0) {
        idx = textures.length;
        textures.push(imgName);
      }
      digits[d] = idx;
    }

    if (!allFound) {
      continue;
    }

    // Also check for minus sign (image 00) — optional
    const minusName = `${prefix}_00.tpl`;
    let minusIdx = null;
    if (renderer.textureCanvases[minusName]) {
      minusIdx = textures.indexOf(minusName);
      if (minusIdx < 0) {
        minusIdx = textures.length;
        textures.push(minusName);
      }
    }

    return { digits, unitF: null, unitC: null, minusIdx };
  }

  return null;
}

export function resolveCustomWeatherDigitTextureMap() {
  this.customWeatherDigitMap = null;

  if (!this.isCustomWeatherEnabled()) {
    return;
  }

  const textures = this.layout?.textures ?? [];
  const materials = this.layout?.materials ?? [];
  if (textures.length === 0 || materials.length === 0) {
    return;
  }

  const numericDigitPaneNames = new Set(["kion_doF100", "kion_doF10", "kion_doF_do"]);
  const digitPanes = (this.layout?.panes ?? []).filter(
    (p) => numericDigitPaneNames.has(String(p?.name ?? "")),
  );

  if (digitPanes.length === 0) {
    return;
  }

  // Collect per-pane texture indices: both from material defaults and RLTP animations
  const perPaneIndices = new Map();

  for (const pane of digitPanes) {
    const name = String(pane.name);
    if (pane.materialIndex >= 0 && pane.materialIndex < materials.length) {
      const material = materials[pane.materialIndex];
      const tMaps = material?.textureMaps ?? [];
      if (tMaps.length > 0) {
        const idx = tMaps[0].textureIndex;
        if (Number.isFinite(idx) && idx >= 0 && idx < textures.length) {
          let set = perPaneIndices.get(name);
          if (!set) {
            set = new Set();
            perPaneIndices.set(name, set);
          }
          set.add(idx);
        }
      }
    }
  }

  for (const animData of [this.startAnim, this.loopAnim, this.anim]) {
    const rltp = collectPerPaneRltpIndices(animData, numericDigitPaneNames);
    for (const [name, indices] of rltp) {
      let set = perPaneIndices.get(name);
      if (!set) {
        set = new Set();
        perPaneIndices.set(name, set);
      }
      for (const idx of indices) {
        set.add(idx);
      }
    }
  }

  // Flatten all indices for logging and name-based discovery
  const allIndices = new Set();
  for (const [, indices] of perPaneIndices) {
    for (const idx of indices) {
      allIndices.add(idx);
    }
  }

  if (allIndices.size === 0) {
    return;
  }

  const perPaneLog = {};
  for (const [name, indices] of perPaneIndices) {
    perPaneLog[name] = [...indices].sort((a, b) => a - b).map((i) => `${i}=${textures[i] ?? "?"}`);
  }
  console.info("[WeWAD] Weather digit discovery — per-pane indices:", perPaneLog);

  // Strategy A: Name-based — look for varying digit in texture names.
  // Try each known RLTP texture as a seed for name-based discovery.
  for (const candidateIdx of allIndices) {
    const candidateName = textures[candidateIdx];
    if (!candidateName) {
      continue;
    }

    const nameDigitMap = tryNameBasedDigitDiscovery(textures, candidateName);
    if (!nameDigitMap) {
      continue;
    }

    // Validate all mapped textures have decoded canvases.
    let allDecoded = true;
    for (let d = 0; d <= 9; d++) {
      const idx = nameDigitMap[d];
      if (idx == null || !this.textureCanvases[textures[idx]]) {
        allDecoded = false;
        break;
      }
    }
    if (!allDecoded) {
      continue;
    }

    console.info("[WeWAD] Digit map (name-based):", Object.fromEntries(
      Object.entries(nameDigitMap).map(([d, i]) => [d, `${i}=${textures[i] ?? "?"}`]),
    ));
    this.customWeatherDigitMap = { digits: nameDigitMap, unitF: null, unitC: null };
    resolveUnitTextureIndices(this, textures, materials);
    return;
  }

  // Strategy B: Find 10 consecutive decoded textures near the known indices
  // and validate via name-based discovery (texture names must contain a digit pattern).
  // No blind sequential fallback — we only accept ranges where names confirm digit ordering.
  const sortedAll = [...allIndices].sort((a, b) => a - b);
  const minIdx = sortedAll[0];
  const maxIdx = sortedAll[sortedAll.length - 1];

  const searchStart = Math.max(0, minIdx - 12);
  const searchEnd = Math.min(textures.length - 10, maxIdx);

  for (let candidateBase = searchStart; candidateBase <= searchEnd; candidateBase++) {
    let allExist = true;
    for (let d = 0; d <= 9; d++) {
      if (!this.textureCanvases[textures[candidateBase + d]]) {
        allExist = false;
        break;
      }
    }
    if (!allExist) {
      continue;
    }

    // Must validate via name-based discovery — no blind sequential.
    for (let d = 0; d <= 9; d++) {
      const candidateName = textures[candidateBase + d];
      if (!candidateName) {
        continue;
      }
      const validatedMap = tryNameBasedDigitDiscovery(textures, candidateName);
      if (validatedMap) {
        console.info("[WeWAD] Digit map (sequential+name validated):", Object.fromEntries(
          Object.entries(validatedMap).map(([d, i]) => [d, `${i}=${textures[i] ?? "?"}`]),
        ));
        this.customWeatherDigitMap = { digits: validatedMap, unitF: null, unitC: null };
        resolveUnitTextureIndices(this, textures, materials);
        return;
      }
    }
  }

  // Strategy C: Look for digit textures from a decompressed common TPL (e.g. TPLCommon.tpl.LZ).
  // These are registered as TPLCommon_00.tpl (minus), TPLCommon_01.tpl (0) .. TPLCommon_10.tpl (9).
  const commonDigitMap = tryCommonTplDigitDiscovery(this, textures);
  if (commonDigitMap) {
    console.info("[WeWAD] Digit map (common TPL):", Object.fromEntries(
      Object.entries(commonDigitMap.digits).map(([d, i]) => [d, `${i}=${textures[i] ?? "?"}`]),
    ));
    this.customWeatherDigitMap = commonDigitMap;
    return;
  }

  // No digit textures found — Canvas 2D fallback will be used.
  console.info("[WeWAD] No digit textures found in WAD — using Canvas 2D temperature text.");
}

function resolveUnitTextureIndices(renderer, textures, materials) {
  const map = renderer.customWeatherDigitMap;
  if (!map) {
    return;
  }

  const unitPane = (renderer.layout?.panes ?? []).find((p) => String(p?.name ?? "") === "kion_doF_F");
  if (!unitPane || unitPane.materialIndex < 0 || unitPane.materialIndex >= materials.length) {
    return;
  }

  // Collect RLTP indices specifically for the unit pane
  const unitPaneNames = new Set(["kion_doF_F"]);
  const unitRltpIndices = new Set();
  for (const animData of [renderer.startAnim, renderer.loopAnim, renderer.anim]) {
    const rltp = collectPerPaneRltpIndices(animData, unitPaneNames);
    for (const [, indices] of rltp) {
      for (const idx of indices) {
        unitRltpIndices.add(idx);
      }
    }
  }

  // Also add the unit pane material's base texture index
  const unitMaterial = materials[unitPane.materialIndex];
  const unitTMaps = unitMaterial?.textureMaps ?? [];
  if (unitTMaps.length > 0) {
    const baseIdx = unitTMaps[0].textureIndex;
    if (Number.isFinite(baseIdx) && baseIdx >= 0 && baseIdx < textures.length) {
      unitRltpIndices.add(baseIdx);
    }
  }

  if (unitRltpIndices.size >= 2) {
    const sorted = [...unitRltpIndices].sort((a, b) => a - b);
    map.unitF = sorted[0];
    map.unitC = sorted.length > 1 ? sorted[1] : null;
  } else if (unitRltpIndices.size === 1) {
    const idx = [...unitRltpIndices][0];
    map.unitF = idx;
    // Check if next texture exists as a potential °C variant
    if (idx + 1 < textures.length && renderer.textureCanvases[textures[idx + 1]]) {
      map.unitC = idx + 1;
    }
  }
}

let _digitDebugLogged = false;

export function getCustomWeatherPaneTextureIndex(paneName) {
  if (!this.customWeatherDigitMap || !this.isCustomWeatherEnabled()) {
    return null;
  }

  const temp = Number.parseInt(String(this.customWeather?.temperature), 10);
  if (!Number.isFinite(temp)) {
    return null;
  }

  const absTemp = Math.abs(temp);
  const { digits, unitF, unitC } = this.customWeatherDigitMap;
  const textures = this.layout?.textures ?? [];

  let result = null;
  let debugDigit = null;

  if (paneName === "kion_doF100") {
    if (absTemp >= 100) {
      debugDigit = Math.floor(absTemp / 100) % 10;
      result = digits[debugDigit] ?? null;
    }
  } else if (paneName === "kion_doF10") {
    if (absTemp >= 10) {
      debugDigit = Math.floor(absTemp / 10) % 10;
      result = digits[debugDigit] ?? null;
    }
  } else if (paneName === "kion_doF_do") {
    debugDigit = absTemp % 10;
    result = digits[debugDigit] ?? null;
  } else if (paneName === "kion_doF_F") {
    const unit = String(this.customWeather?.temperatureUnit ?? "F").trim().toUpperCase();
    if (unit === "C" && unitC != null) {
      result = unitC;
    } else {
      result = unitF ?? null;
    }
  }

  // One-shot debug: log the first complete set of digit overrides
  if (!_digitDebugLogged && paneName === "kion_doF_F") {
    _digitDebugLogged = true;
    const onesDigit = absTemp % 10;
    const tensDigit = Math.floor(absTemp / 10) % 10;
    console.warn(
      `[WeWAD] Custom weather digit override — temp=${temp}:`,
      `ones(${onesDigit})→tex[${digits[onesDigit]}]="${textures[digits[onesDigit]] ?? "?"}",`,
      `tens(${tensDigit})→tex[${digits[tensDigit]}]="${textures[digits[tensDigit]] ?? "?"}",`,
      `unit→tex[${result}]="${textures[result] ?? "?"}"`,
    );
  }

  return result;
}

export function getCustomWeatherDigitVisibility(pane) {
  if (!this.customWeatherDigitMap || !this.isCustomWeatherEnabled() || !pane) {
    return null;
  }

  const paneName = String(pane?.name ?? "");
  if (!WEATHER_TEMP_DIGIT_PANE_NAMES.has(paneName)) {
    return null;
  }

  const temp = Number.parseInt(String(this.customWeather?.temperature), 10);
  if (!Number.isFinite(temp)) {
    return null;
  }

  const absTemp = Math.abs(temp);
  if (paneName === "kion_doF100") {
    return absTemp >= 100;
  }
  if (paneName === "kion_doF10") {
    return absTemp >= 10;
  }

  return true;
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
    // When we have a digit texture map, keep digit panes visible — their texture
    // indices are overridden by getCustomWeatherPaneTextureIndex instead.
    if (this.customWeatherDigitMap) {
      return true;
    }
    return false;
  }

  return true;
}

export function shouldDrawCustomTemperatureForPane(pane) {
  if (!this.isCustomWeatherEnabled() || !pane) {
    return false;
  }

  // When native digit textures are available, skip the Canvas 2D fallback.
  if (this.customWeatherDigitMap) {
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
  const x = bounds.minX + Math.max(2, absWidth * 0.03);
  const shadowOffset = Math.max(1, Math.round(fontSize * 0.06));
  // Black offset copy (shadow)
  context.fillStyle = "rgba(0, 0, 0, 0.85)";
  context.fillText(text, x + shadowOffset, baselineY + shadowOffset, absWidth);
  // White foreground
  context.fillStyle = "#ffffff";
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
