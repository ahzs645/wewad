import { normalizeRenderState, collectRenderStateOptions } from "./renderState";
import { findAlphaRevealFrame, clampFrame } from "./animation";

export function hasWeatherScene(layout) {
  const panes = layout?.panes ?? [];
  const paneNames = new Set(panes.map((pane) => String(pane.name ?? "")));
  return paneNames.has("weather") && paneNames.has("code") && paneNames.has("city") && paneNames.has("telop");
}

export function hasNewsScene(layout) {
  const panes = layout?.panes ?? [];
  const paneNames = new Set(panes.map((pane) => String(pane.name ?? "")));
  return paneNames.has("telop0") && paneNames.has("telop1") && paneNames.has("line");
}

// Maps a decoded Forecast Channel condition name (e.g. "Showers", "Intermittent
// Clouds", real Accuweather-style strings from forecast.bin) to one of the
// banner customization's preset condition keys (WEATHER_CONDITION_OPTIONS in
// constants.js), which in turn selects real W_* icon panes via
// CONDITION_ICON_PRESETS in customWeatherMethods.js.
export function mapForecastConditionToOption(conditionName) {
  const name = String(conditionName ?? "").toLowerCase();
  if (!name) {
    return "cloudy";
  }
  if (name.includes("thunder")) return "thunderstorm";
  if (name.includes("snow")) return "snow";
  if (name.includes("sleet")) return "sleet";
  if (name.includes("hail")) return "hail";
  if (name.includes("fog") || name.includes("haze") || name.includes("mist")) return "fog";
  if (name.includes("wind")) return "windy";
  if (name.includes("shower") || name.includes("rain") || name.includes("drizzle")) return "rain";
  if (name.includes("intermittent") || name.includes("partly") || name.includes("mostly sunny")) return "partly_cloudy";
  if (name.includes("cloud")) return "cloudy";
  if (name.includes("sunny") || name.includes("clear") || name.includes("fair")) return "clear";
  if (name.includes("night")) return "night";
  return "cloudy";
}

export function hasWeatherPaneName(name) {
  return /^W_/i.test(name) || /^code$/i.test(name) || /^weather$/i.test(name);
}

// telop0/telop1 are the real News Channel icon's scrolling ticker text panes
// (see customNewsMethods.js); "line" is the divider pane in the same scene.
export function hasNewsPaneName(name) {
  return /^telop\d+$/i.test(name) || /^line$/i.test(name);
}

export function buildPaneChildrenByParent(layoutPanes = []) {
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

function hasMatchingPaneInSubtree(rootPaneName, childrenByParent, paneNamePredicate) {
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
    if (paneNamePredicate(paneName)) {
      return true;
    }
    for (const childName of childrenByParent.get(paneName) ?? []) {
      stack.push(childName);
    }
  }

  return false;
}

export function hasWeatherPaneInSubtree(rootPaneName, childrenByParent) {
  return hasMatchingPaneInSubtree(rootPaneName, childrenByParent, hasWeatherPaneName);
}

export function hasNewsPaneInSubtree(rootPaneName, childrenByParent) {
  return hasMatchingPaneInSubtree(rootPaneName, childrenByParent, hasNewsPaneName);
}

// Finds which RSO render-state group contains panes matching `paneNamePredicate`
// (in their pane subtree) — i.e. which state actually shows the customized
// scene, so the preview can auto-select it instead of defaulting to RSO0/idle.
function resolveRenderStateForPanes(targetResult, paneNamePredicate) {
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
      if (hasMatchingPaneInSubtree(paneName, childrenByParent, paneNamePredicate)) {
        return normalizedState;
      }
    }
  }

  return null;
}

export function resolveWeatherRenderState(targetResult) {
  return resolveRenderStateForPanes(targetResult, hasWeatherPaneName);
}

export function resolveNewsRenderState(targetResult) {
  return resolveRenderStateForPanes(targetResult, hasNewsPaneName);
}

export function resolveCustomWeatherBannerFrame(selection, fallbackFrame = 0) {
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
