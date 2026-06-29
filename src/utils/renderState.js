// --- RSO carousel tuning ----------------------------------------------------
// The Wii Shop icon is a 4-slot "recommended titles" carousel: 16 group-bound
// animations (Rso0..Rso15) = 4 slots x 4 layered sub-anims. The real System Menu
// composes them with an external (WiiConnect24) sequencer whose exact cadence is
// undocumented, so the timing below is a best-effort reconstruction grounded in
// the authored keyframes. Tune these if the visible pacing looks off.
//
// CAROUSEL_REVEAL_CAP: keyframes at/after this frame are treated as RSO "state
//   markers" (Rso0 keys slot positions at ~K*20000 and a long card dwell at
//   ~11800) rather than real motion, and are dropped from the reconstructed loop.
// CAROUSEL_DWELL_FRAMES: extra frames each slot holds on screen after its reveal.
export const CAROUSEL_REVEAL_CAP = 4000;
export const CAROUSEL_DWELL_FRAMES = 150;
export const CAROUSEL_MIN_SLOT_FRAMES = 120;

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

// --- RSO carousel reconstruction --------------------------------------------

function paneBelongsToSlot(paneName, slotIndex, paneSet) {
  if (paneSet.has(paneName)) {
    return true;
  }
  // Slot panes are suffixed _00.._03 (slot index). N_LogoTitles etc. have no
  // suffix and are caught by the group membership set above.
  return new RegExp(`_0${slotIndex}$`).test(String(paneName ?? ""));
}

function maxRealFrameInPane(pane, cap) {
  let maxFrame = 0;
  for (const tag of pane?.tags ?? []) {
    for (const entry of tag.entries ?? []) {
      for (const kf of entry.keyframes ?? []) {
        if (Number.isFinite(kf.frame) && kf.frame >= 0 && kf.frame < cap && kf.frame > maxFrame) {
          maxFrame = kf.frame;
        }
      }
    }
  }
  return maxFrame;
}

// Copy a pane's animation, shifting real keyframes onto the slot's timeline
// window and dropping the degenerate state markers (frame >= cap).
function shiftPaneOntoTimeline(pane, offset, cap) {
  const tags = [];
  for (const tag of pane.tags ?? []) {
    const entries = [];
    for (const entry of tag.entries ?? []) {
      const keyframes = (entry.keyframes ?? [])
        .filter((kf) => Number.isFinite(kf.frame) && kf.frame < cap)
        .map((kf) => ({ ...kf, frame: kf.frame + offset }));
      if (keyframes.length > 0) {
        entries.push({ ...entry, keyframes });
      }
    }
    if (entries.length > 0) {
      tags.push({ type: tag.type, entries });
    }
  }
  return { name: pane.name, tags };
}

// Step-visibility (RLVI) keyframes that show a pane only during its slot window.
function makeVisibilityGateTag(offset, stride) {
  const keyframes = [];
  if (offset > 0) {
    keyframes.push({ frame: 0, value: 0, blend: 0 });
  }
  keyframes.push({ frame: offset, value: 1, blend: 0 });
  keyframes.push({ frame: offset + stride, value: 0, blend: 0 });
  return {
    type: "RLVI",
    entries: [
      {
        targetGroup: 0,
        type: 0x00,
        dataType: 1,
        typeName: "RLVI",
        interpolation: "step",
        preExtrapolation: "clamp",
        postExtrapolation: "clamp",
        keyframes,
      },
    ],
  };
}

function applyVisibilityGate(pane, offset, stride) {
  const gate = makeVisibilityGateTag(offset, stride);
  const tags = (pane.tags ?? []).filter((tag) => String(tag.type) !== "RLVI");
  tags.push(gate);
  return { ...pane, tags };
}

// Leaf picture/text panes that persist at full alpha after their reveal and must
// be hard-hidden outside their slot window. These are all per-slot (suffixed),
// never cross-nested ancestors, so a visibility gate on them is safe. (The nested
// N_title_0N containers are deliberately NOT gated — gating an ancestor would
// also hide other slots' titles; they stay hidden out-of-window via alpha clamp.)
const CAROUSEL_GATED_LEAF = /^(bg_wiiplane|P_ShopLogo|P_RcmdImg|P_txtBg|T_Rcmd)_0\d$/;

/**
 * Reconstruct the Wii Shop-style 4-slot RSO carousel as a single looping
 * animation. The real Wii plays 16 group-bound animations (Rso0..Rso15 = 4 slots
 * x 4 layered sub-anims) sequenced by the System Menu; our renderer drives one
 * animation, so we build a combined timeline that plays each slot's reveal in
 * sequence and gates each slot's panes to its window.
 *
 * Returns null when the layout is not a multi-slot RSO carousel (so every other
 * channel is unaffected). Otherwise returns { anim, frameSize, slotCount, stride,
 * playbackMode }.
 */
export function buildRsoCarousel(targetResult, options = {}) {
  if (!targetResult) {
    return null;
  }

  const states = new Set(collectRenderStateOptions(targetResult));
  if (states.size === 0) {
    return null;
  }

  // Slot base states live at indices 0, 4, 8, ... Require the 4-per-slot pattern
  // and at least two slots so this only fires on real carousels (Wii Shop).
  const slotBases = [];
  for (let base = 0; states.has(`RSO${base}`); base += 4) {
    const hasAux =
      states.has(`RSO${base + 1}`) || states.has(`RSO${base + 2}`) || states.has(`RSO${base + 3}`);
    if (!hasAux) {
      break;
    }
    slotBases.push(base);
  }
  if (slotBases.length < 2) {
    return null;
  }

  const revealCap = Number.isFinite(options.revealCap) ? options.revealCap : CAROUSEL_REVEAL_CAP;
  const dwell = Number.isFinite(options.dwellFrames) ? Math.max(0, options.dwellFrames) : CAROUSEL_DWELL_FRAMES;

  // Group membership gives each slot its pane set (Rso(4N..4N+3)).
  const groupPanesByState = new Map();
  for (const group of targetResult.renderLayout?.groups ?? []) {
    const normalized = normalizeRenderState(group?.name);
    if (normalized) {
      groupPanesByState.set(normalized, group.paneNames ?? []);
    }
  }

  // Build each slot's composite (base + its 3 aux RSO sub-anims) and its panes.
  const slots = [];
  slotBases.forEach((base, slotIndex) => {
    const baseEntry = findStateAnimationEntry(targetResult, `RSO${base}`);
    if (!baseEntry?.anim) {
      return;
    }
    const composite = mergeRelatedRsoAnimations(baseEntry.anim, targetResult, `RSO${base}`);
    const paneSet = new Set();
    for (let k = 0; k < 4; k += 1) {
      for (const name of groupPanesByState.get(`RSO${base + k}`) ?? []) {
        paneSet.add(name);
      }
    }
    const slotPanes = (composite.panes ?? []).filter((pane) =>
      paneBelongsToSlot(pane.name, slotIndex, paneSet),
    );
    slots.push({ slotIndex, composite, slotPanes, paneSet });
  });
  if (slots.length < 2) {
    return null;
  }

  // Uniform stride keeps the cadence even: longest slot reveal + dwell.
  let maxReveal = 0;
  for (const slot of slots) {
    for (const pane of slot.slotPanes) {
      maxReveal = Math.max(maxReveal, maxRealFrameInPane(pane, revealCap));
    }
  }
  const stride = Math.max(
    Number.isFinite(options.minSlotFrames) ? options.minSlotFrames : CAROUSEL_MIN_SLOT_FRAMES,
    Math.ceil(maxReveal) + dwell,
  );

  const combinedPanes = [];
  const combinedTimgs = [];
  slots.forEach((slot) => {
    const offset = slot.slotIndex * stride;
    const gatedNames = new Set();

    for (const pane of slot.slotPanes) {
      let shifted = shiftPaneOntoTimeline(pane, offset, revealCap);
      if (CAROUSEL_GATED_LEAF.test(pane.name)) {
        shifted = applyVisibilityGate(shifted, offset, stride);
        gatedNames.add(pane.name);
      }
      // Drop panes that ended up with nothing to animate (all keyframes were
      // state markers beyond the cap) and aren't a gate carrier.
      if (shifted.tags.length > 0) {
        combinedPanes.push(shifted);
      }
    }

    // Static leaves (e.g. P_RcmdImg_0N, P_txtBg_0N) aren't in the anim but must be
    // hidden outside their window — add gate-only entries for the slot's panes.
    for (const name of slot.paneSet) {
      if (!gatedNames.has(name) && CAROUSEL_GATED_LEAF.test(name)) {
        combinedPanes.push({ name, tags: [makeVisibilityGateTag(offset, stride)] });
        gatedNames.add(name);
      }
    }

    for (const timg of slot.composite.timgNames ?? []) {
      if (timg && !combinedTimgs.includes(timg)) {
        combinedTimgs.push(timg);
      }
    }
  });

  const frameSize = stride * slots.length;
  return {
    anim: { frameSize, flags: 1, panes: combinedPanes, timgNames: combinedTimgs },
    frameSize,
    slotCount: slots.length,
    stride,
    playbackMode: "loop",
  };
}
