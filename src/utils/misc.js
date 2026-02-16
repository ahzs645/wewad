import { TITLE_LOCALE_ORDER } from "../constants";

export function sortTitleLocales(codes = []) {
  return [...codes].sort((left, right) => {
    const leftOrder = TITLE_LOCALE_ORDER.indexOf(left);
    const rightOrder = TITLE_LOCALE_ORDER.indexOf(right);
    if (leftOrder !== rightOrder) {
      const safeLeft = leftOrder >= 0 ? leftOrder : Number.MAX_SAFE_INTEGER;
      const safeRight = rightOrder >= 0 ? rightOrder : Number.MAX_SAFE_INTEGER;
      return safeLeft - safeRight;
    }
    return left.localeCompare(right);
  });
}

export function arePaneStateGroupsEqual(leftGroups = [], rightGroups = []) {
  if (leftGroups.length !== rightGroups.length) {
    return false;
  }

  for (let i = 0; i < leftGroups.length; i += 1) {
    const left = leftGroups[i];
    const right = rightGroups[i];
    if (
      left.id !== right.id ||
      left.label !== right.label ||
      left.options.length !== right.options.length
    ) {
      return false;
    }

    for (let optionIndex = 0; optionIndex < left.options.length; optionIndex += 1) {
      const leftOption = left.options[optionIndex];
      const rightOption = right.options[optionIndex];
      if (leftOption.index !== rightOption.index || leftOption.paneName !== rightOption.paneName) {
        return false;
      }
    }
  }

  return true;
}

export function shallowEqualSelections(left = {}, right = {}) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  for (const [key, value] of leftEntries) {
    if (right[key] !== value) {
      return false;
    }
  }
  return true;
}

export function normalizePaneStateSelections(currentSelections, groups) {
  const nextSelections = {};
  for (const group of groups) {
    const currentValue = Number.parseInt(String(currentSelections?.[group.id]), 10);
    const hasCurrent = Number.isFinite(currentValue) && group.options.some((option) => option.index === currentValue);
    nextSelections[group.id] = hasCurrent ? currentValue : null;
  }
  return nextSelections;
}

export function normalizeDomId(value) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}
