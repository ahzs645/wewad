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

export function hasWeatherPaneName(name) {
  return /^W_/i.test(name) || /^code$/i.test(name) || /^weather$/i.test(name);
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

export function hasWeatherPaneInSubtree(rootPaneName, childrenByParent) {
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
    if (hasWeatherPaneName(paneName)) {
      return true;
    }
    for (const childName of childrenByParent.get(paneName) ?? []) {
      stack.push(childName);
    }
  }

  return false;
}

export function resolveWeatherRenderState(targetResult) {
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
      if (hasWeatherPaneInSubtree(paneName, childrenByParent)) {
        return normalizedState;
      }
    }
  }

  return null;
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
