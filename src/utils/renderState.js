export function normalizeRenderState(value) {
  if (!value || value === "auto") {
    return null;
  }
  return String(value).trim().toUpperCase();
}

export function compareRenderStates(left, right) {
  const leftMatch = String(left).match(/^RSO(\d+)$/i);
  const rightMatch = String(right).match(/^RSO(\d+)$/i);
  if (leftMatch && rightMatch) {
    return Number.parseInt(leftMatch[1], 10) - Number.parseInt(rightMatch[1], 10);
  }
  return String(left).localeCompare(String(right), undefined, { numeric: true });
}

export function collectRenderStateOptions(targetResult) {
  const states = new Set();

  for (const group of targetResult?.renderLayout?.groups ?? []) {
    const normalized = normalizeRenderState(group?.name);
    if (normalized && /^RSO\d+$/.test(normalized)) {
      states.add(normalized);
    }
  }

  for (const animEntry of targetResult?.animEntries ?? []) {
    const normalized = normalizeRenderState(animEntry?.state);
    if (normalized && /^RSO\d+$/.test(normalized)) {
      states.add(normalized);
    }
  }

  return [...states].sort(compareRenderStates);
}

export function resolveAutoRenderState(targetResult) {
  const states = collectRenderStateOptions(targetResult);
  if (states.length === 0) {
    return null;
  }

  if (states.includes("RSO0")) {
    return "RSO0";
  }

  return states[0];
}

export function findStateAnimationEntry(targetResult, state) {
  const normalizedState = normalizeRenderState(state);
  if (!normalizedState) {
    return null;
  }

  return (
    (targetResult?.animEntries ?? []).find((entry) => normalizeRenderState(entry?.state) === normalizedState) ??
    null
  );
}

export function shouldHoldStateAnimation(targetResult, stateAnim) {
  if (!stateAnim || targetResult?.animLoop) {
    return false;
  }

  const frameSize = Math.max(0, Math.floor(stateAnim.frameSize ?? 0));
  return frameSize > 0 && frameSize <= 180;
}

/**
 * Check whether a pane entry in the primary RSO animation should be replaced
 * by an auxiliary RSO's version.  Returns true when the entry is a "degenerate"
 * initial-state placeholder (all keyframes beyond frameSize) AND its clamped
 * pane alpha is zero — meaning the pane is invisible in the primary animation
 * and needs the auxiliary RSO to make it visible.
 *
 * Entries that are degenerate but already alpha=255 (e.g. N_Rcmd_00) are kept
 * as-is to avoid introducing unwanted fade-out keyframes from auxiliary RSOs.
 */
export function shouldReplaceWithAuxiliary(paneEntry, frameSize) {
  if (!paneEntry?.tags || frameSize <= 0) {
    return false;
  }

  // Check all keyframes are beyond frameSize (degenerate initial-state pattern).
  let hasKeyframes = false;
  for (const tag of paneEntry.tags) {
    for (const entry of tag.entries ?? []) {
      for (const kf of entry.keyframes ?? []) {
        hasKeyframes = true;
        if (kf.frame < frameSize) {
          return false;
        }
      }
    }
  }
  if (!hasKeyframes) {
    return false;
  }

  // Only replace when the clamped pane alpha is 0 (invisible).
  // RLVC type 0x10 = paneAlpha.  The clamped value is the first keyframe's
  // value (since all keyframes are beyond the frame range).
  for (const tag of paneEntry.tags) {
    if (String(tag?.type ?? "") !== "RLVC") {
      continue;
    }
    for (const entry of tag.entries ?? []) {
      if (entry.type === 0x10 && entry.keyframes?.length > 0) {
        const clampedAlpha = entry.keyframes[0].value ?? 0;
        return clampedAlpha <= 0;
      }
    }
  }

  return false;
}

/**
 * On the real Wii, multiple RSO animations play simultaneously (e.g. RSO0 for
 * base elements + RSO1-3 for the first recommendation card).  Our renderer
 * only drives a single animation, so we merge pane entries from auxiliary RSO
 * animations into the primary RSO0 animation.
 *
 * When RSO0 has a "degenerate" entry for a pane (all keyframes beyond
 * frameSize — just an initial-state placeholder), we replace it with the
 * auxiliary RSO's version which has the actual fade-in / slide animation.
 */
export function mergeRelatedRsoAnimations(primaryAnim, targetResult, activeState) {
  if (!primaryAnim || !targetResult || !activeState) {
    return primaryAnim;
  }

  const stateMatch = String(activeState).match(/^RSO(\d+)$/i);
  if (!stateMatch) {
    return primaryAnim;
  }

  const baseIndex = Number.parseInt(stateMatch[1], 10);
  const entries = targetResult.animEntries ?? [];
  if (entries.length <= 1) {
    return primaryAnim;
  }

  const primaryFrameSize = primaryAnim.frameSize ?? 0;

  // Index primary panes by name so we can detect and replace degenerate entries.
  const primaryPanesByName = new Map();
  for (const pane of primaryAnim.panes ?? []) {
    primaryPanesByName.set(pane.name, pane);
  }

  // Track which primary panes get replaced by auxiliary versions.
  const replacedPaneNames = new Set();
  const additionalPanes = [];
  const additionalTimgs = [];

  // Wii Shop icon pattern: RSO0=base, RSO1-3=first recommendation set.
  const maxMerge = 3;
  for (let offset = 1; offset <= maxMerge; offset += 1) {
    const targetState = `RSO${baseIndex + offset}`;
    const entry = entries.find(
      (animEntry) => String(animEntry.state ?? "").toUpperCase() === targetState,
    );
    if (!entry?.anim) {
      continue;
    }

    for (const pane of entry.anim.panes ?? []) {
      if (replacedPaneNames.has(pane.name)) {
        continue;
      }

      const existing = primaryPanesByName.get(pane.name);
      if (!existing) {
        // Pane not in primary animation — add it.
        additionalPanes.push(pane);
        primaryPanesByName.set(pane.name, pane);
      } else if (shouldReplaceWithAuxiliary(existing, primaryFrameSize)) {
        // Primary has a degenerate placeholder — replace with real animation.
        replacedPaneNames.add(pane.name);
        additionalPanes.push(pane);
      }
    }

    for (const timgName of entry.anim.timgNames ?? []) {
      if (timgName && !additionalTimgs.includes(timgName)) {
        additionalTimgs.push(timgName);
      }
    }
  }

  if (replacedPaneNames.size === 0 && additionalPanes.length === 0 && additionalTimgs.length === 0) {
    return primaryAnim;
  }

  // Build merged pane list: keep non-replaced primary panes, then add auxiliaries.
  const mergedPanes = (primaryAnim.panes ?? []).filter(
    (pane) => !replacedPaneNames.has(pane.name),
  );
  mergedPanes.push(...additionalPanes);

  const existingTimgs = primaryAnim.timgNames ?? [];
  return {
    ...primaryAnim,
    panes: mergedPanes,
    timgNames: [
      ...existingTimgs,
      ...additionalTimgs.filter((name) => !existingTimgs.includes(name)),
    ],
  };
}
