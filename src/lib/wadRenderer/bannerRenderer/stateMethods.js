function normalizeStateName(value) {
  if (!value) {
    return null;
  }
  return String(value).trim().toUpperCase();
}

function isRenderStateName(name) {
  return /^RSO\d+$/.test(String(name ?? ""));
}

function parseNumericSuffix(name) {
  const match = String(name ?? "").match(/^(.*?)(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    base: match[1],
    index: Number.parseInt(match[2], 10),
  };
}

function buildChildrenByParent(layout) {
  const childrenByParent = new Map();
  for (const pane of layout?.panes ?? []) {
    if (!pane?.parent) {
      continue;
    }
    let children = childrenByParent.get(pane.parent);
    if (!children) {
      children = [];
      childrenByParent.set(pane.parent, children);
    }
    children.push(pane);
  }
  return childrenByParent;
}

function hasRenderableDescendant(paneName, childrenByParent, cache) {
  if (cache.has(paneName)) {
    return cache.get(paneName);
  }

  const children = childrenByParent.get(paneName) ?? [];
  let value = false;
  for (const child of children) {
    if (child.type === "pic1" || child.type === "txt1" || child.type === "wnd1") {
      value = true;
      break;
    }
    if (hasRenderableDescendant(child.name, childrenByParent, cache)) {
      value = true;
      break;
    }
  }

  cache.set(paneName, value);
  return value;
}

function buildPaneStateLabel(parentName, baseName) {
  const safeBase = String(baseName ?? "").trim() || "state";
  if (!parentName) {
    return safeBase;
  }
  return `${parentName}/${safeBase}`;
}

function hasAnimatedPaneInTransformChain(renderer, pane) {
  for (const chainPane of renderer.getPaneTransformChain(pane)) {
    if (renderer.animByPaneName?.has(chainPane.name)) {
      return true;
    }
  }
  return false;
}

export function getPaneGroupNames(paneName) {
  return this.paneGroupNames.get(paneName) ?? null;
}

export function collectRenderStates() {
  const states = new Set();

  for (const group of this.layout?.groups ?? []) {
    const normalized = normalizeStateName(group?.name);
    if (!normalized || !isRenderStateName(normalized)) {
      continue;
    }
    states.add(normalized);
  }

  return states;
}

export function resolveActiveRenderState(preferredState) {
  if (this.availableRenderStates.size === 0) {
    return null;
  }

  const normalizedPreferred = normalizeStateName(preferredState);
  if (normalizedPreferred && this.availableRenderStates.has(normalizedPreferred)) {
    return normalizedPreferred;
  }

  if (this.availableRenderStates.has("RSO0")) {
    return "RSO0";
  }

  return (
    [...this.availableRenderStates].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))[0] ??
    null
  );
}

export function getPaneRenderStates(pane) {
  const states = new Set();
  if (!pane) {
    return states;
  }

  const addPaneStates = (paneName) => {
    const groups = this.getPaneGroupNames(paneName);
    if (!groups) {
      return;
    }
    for (const groupName of groups) {
      const normalized = normalizeStateName(groupName);
      if (!normalized || !isRenderStateName(normalized)) {
        continue;
      }
      states.add(normalized);
    }
  };

  for (const chainPane of this.getPaneTransformChain(pane)) {
    addPaneStates(chainPane.name);
  }

  return states;
}

export function shouldRenderPaneForState(pane) {
  if (!this.activeRenderState || this.availableRenderStates.size <= 1) {
    return true;
  }

  const paneStates = this.getPaneRenderStates(pane);
  if (paneStates.size === 0) {
    return true;
  }

  if (paneStates.has(this.activeRenderState)) {
    return true;
  }

  // BRLAN state animations often drive panes across multiple RSO groups; keep
  // panes visible when the active animation explicitly targets their chain.
  return hasAnimatedPaneInTransformChain(this, pane);
}

export function collectPaneStateGroups() {
  const groupsByKey = new Map();
  const panes = this.layout?.panes ?? [];
  const childrenByParent = buildChildrenByParent(this.layout);
  const descendantCache = new Map();

  for (const pane of panes) {
    if (pane?.type !== "pan1" && pane?.type !== "bnd1") {
      continue;
    }
    if (Number.isInteger(pane?.materialIndex) && pane.materialIndex >= 0) {
      continue;
    }

    const suffix = parseNumericSuffix(pane?.name);
    if (!suffix || !Number.isFinite(suffix.index)) {
      continue;
    }

    const key = `${pane.parent ?? "__root__"}|${suffix.base}`;
    let entry = groupsByKey.get(key);
    if (!entry) {
      entry = {
        parentName: pane.parent ?? null,
        baseName: suffix.base,
        options: new Map(),
      };
      groupsByKey.set(key, entry);
    }
    if (!entry.options.has(suffix.index)) {
      entry.options.set(suffix.index, pane.name);
    }
  }

  const groups = [];
  for (const entry of groupsByKey.values()) {
    if (entry.options.size < 2) {
      continue;
    }

    const options = [...entry.options.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([index, paneName]) => ({ index, paneName }));

    const renderableOptionCount = options.filter((option) =>
      hasRenderableDescendant(option.paneName, childrenByParent, descendantCache),
    ).length;
    if (renderableOptionCount < 2) {
      continue;
    }

    const parentPart = entry.parentName ?? "__root__";
    const basePart = entry.baseName || "state";
    groups.push({
      id: `${parentPart}::${basePart}`,
      parentName: entry.parentName,
      baseName: entry.baseName,
      label: buildPaneStateLabel(entry.parentName, entry.baseName),
      options,
    });
  }

  groups.sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
  return groups;
}

export function resolvePaneStateSelections(preferredSelections = null) {
  const selections = {};
  for (const group of this.availablePaneStateGroups) {
    const preferredValue = preferredSelections && Object.prototype.hasOwnProperty.call(preferredSelections, group.id)
      ? Number.parseInt(String(preferredSelections[group.id]), 10)
      : null;
    const hasPreferred = Number.isFinite(preferredValue) && group.options.some((option) => option.index === preferredValue);
    selections[group.id] = hasPreferred ? preferredValue : null;
  }
  return selections;
}

export function getAvailablePaneStateGroups() {
  return this.availablePaneStateGroups.map((group) => ({
    id: group.id,
    parentName: group.parentName,
    baseName: group.baseName,
    label: group.label,
    options: group.options.map((option) => ({ ...option })),
  }));
}

export function shouldRenderPaneForPaneState(pane) {
  if (!this.activePaneStateSelections || Object.keys(this.activePaneStateSelections).length === 0) {
    return true;
  }

  const chain = this.getPaneTransformChain(pane);
  for (const chainPane of chain) {
    const memberships = this.paneStateMembershipByPaneName.get(chainPane.name);
    if (!memberships || memberships.length === 0) {
      continue;
    }

    for (const membership of memberships) {
      const selectedIndex = this.activePaneStateSelections[membership.groupId];
      if (!Number.isFinite(selectedIndex)) {
        continue;
      }
      if (membership.index !== selectedIndex) {
        return false;
      }
    }
  }

  return true;
}
