export function clampChannel(value, fallback = 255) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function normalizeMaterialColor(color) {
  if (!Array.isArray(color) || color.length < 4) {
    return null;
  }

  return {
    r: clampChannel(color[0]),
    g: clampChannel(color[1]),
    b: clampChannel(color[2]),
    a: clampChannel(color[3]),
  };
}

export function buildCssColor(color) {
  const normalized = normalizeMaterialColor([color?.r, color?.g, color?.b, color?.a]);
  if (!normalized) {
    return "rgba(0, 0, 0, 1)";
  }

  return `rgba(${normalized.r}, ${normalized.g}, ${normalized.b}, ${normalized.a / 255})`;
}

export function normalizePaneVertexColors(pane) {
  const rawColors = pane?.vertexColors;
  if (!Array.isArray(rawColors) || rawColors.length !== 4) {
    return null;
  }

  return rawColors.map((color) => ({
    r: clampChannel(color?.r),
    g: clampChannel(color?.g),
    b: clampChannel(color?.b),
    a: clampChannel(color?.a),
  }));
}

export function writePixel(data, offset, r, g, b, a) {
  data[offset] = r;
  data[offset + 1] = g;
  data[offset + 2] = b;
  data[offset + 3] = a;
}

export function lerpChannel(left, right, t) {
  return left + (right - left) * t;
}

export function resolveWrapMode(rawValue) {
  switch (rawValue) {
    case 1:
      return "repeat";
    case 2:
      return "mirror";
    case 3:
      return "repeat";
    default:
      return "clamp";
  }
}

export function isTiledWrapMode(rawValue) {
  return resolveWrapMode(rawValue) !== "clamp";
}
