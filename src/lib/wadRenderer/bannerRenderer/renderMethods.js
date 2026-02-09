import { interpolateKeyframes } from "../animations";

function clampChannel(value, fallback = 255) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizeMaterialColor(color) {
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

function buildCssColor(color) {
  const normalized = normalizeMaterialColor([color?.r, color?.g, color?.b, color?.a]);
  if (!normalized) {
    return "rgba(0, 0, 0, 1)";
  }

  return `rgba(${normalized.r}, ${normalized.g}, ${normalized.b}, ${normalized.a / 255})`;
}

function normalizePaneVertexColors(pane) {
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

function writePixel(data, offset, r, g, b, a) {
  data[offset] = r;
  data[offset + 1] = g;
  data[offset + 2] = b;
  data[offset + 3] = a;
}

function lerpChannel(left, right, t) {
  return left + (right - left) * t;
}

function buildVertexColorCanvas(colors, mode, widthHint = 48, heightHint = 48) {
  const gradientWidth = Math.max(8, Math.min(256, Math.ceil(Math.abs(widthHint))));
  const gradientHeight = Math.max(8, Math.min(256, Math.ceil(Math.abs(heightHint))));
  const canvas = document.createElement("canvas");
  canvas.width = gradientWidth;
  canvas.height = gradientHeight;

  const context = canvas.getContext("2d");
  const imageData = context.createImageData(gradientWidth, gradientHeight);
  const pixels = imageData.data;
  const [tl, tr, bl, br] = colors;

  for (let y = 0; y < gradientHeight; y += 1) {
    const v = gradientHeight <= 1 ? 0 : y / (gradientHeight - 1);
    for (let x = 0; x < gradientWidth; x += 1) {
      const u = gradientWidth <= 1 ? 0 : x / (gradientWidth - 1);
      const top = {
        r: lerpChannel(tl.r, tr.r, u),
        g: lerpChannel(tl.g, tr.g, u),
        b: lerpChannel(tl.b, tr.b, u),
        a: lerpChannel(tl.a, tr.a, u),
      };
      const bottom = {
        r: lerpChannel(bl.r, br.r, u),
        g: lerpChannel(bl.g, br.g, u),
        b: lerpChannel(bl.b, br.b, u),
        a: lerpChannel(bl.a, br.a, u),
      };
      const sampled = {
        r: Math.round(lerpChannel(top.r, bottom.r, v)),
        g: Math.round(lerpChannel(top.g, bottom.g, v)),
        b: Math.round(lerpChannel(top.b, bottom.b, v)),
        a: Math.round(lerpChannel(top.a, bottom.a, v)),
      };

      const offset = (y * gradientWidth + x) * 4;
      if (mode === "color") {
        writePixel(pixels, offset, sampled.r, sampled.g, sampled.b, 255);
      } else {
        writePixel(pixels, offset, 255, 255, 255, sampled.a);
      }
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function resolveWrapMode(rawValue) {
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

function isTiledWrapMode(rawValue) {
  return resolveWrapMode(rawValue) !== "clamp";
}

function getModulationScratch(renderer, width, height) {
  if (!renderer.modulationScratchSurface) {
    renderer.modulationScratchSurface = document.createElement("canvas");
    renderer.modulationScratchContext = renderer.modulationScratchSurface.getContext("2d");
  }

  if (
    renderer.modulationScratchSurface.width !== width ||
    renderer.modulationScratchSurface.height !== height
  ) {
    renderer.modulationScratchSurface.width = width;
    renderer.modulationScratchSurface.height = height;
  }

  return {
    surface: renderer.modulationScratchSurface,
    context: renderer.modulationScratchContext,
  };
}

function applyColorBlendPreservingAlpha(renderer, context, width, height, drawBlend) {
  const scratch = getModulationScratch(renderer, width, height);
  scratch.context.setTransform(1, 0, 0, 1, 0, 0);
  scratch.context.clearRect(0, 0, width, height);
  scratch.context.drawImage(context.canvas, 0, 0, width, height, 0, 0, width, height);

  drawBlend();

  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = "destination-in";
  context.drawImage(scratch.surface, -width / 2, -height / 2, width, height);
  context.restore();
}

function sampleAnimationEntry(entry, frame, frameSize, options = {}) {
  const keyframes = entry?.keyframes ?? [];
  if (keyframes.length === 0) {
    return null;
  }

  const wrapBeforeFirst = options.wrapBeforeFirst !== false;
  let sampleFrame = frame;
  const returnNullBeforeFirst = options.returnNullBeforeFirst ?? !wrapBeforeFirst;
  if (!wrapBeforeFirst && returnNullBeforeFirst && sampleFrame < keyframes[0].frame) {
    return null;
  }
  if (wrapBeforeFirst && frameSize > 0 && keyframes[0].frame >= 0 && frame < keyframes[0].frame) {
    sampleFrame += frameSize;
  }

  return interpolateKeyframes(keyframes, sampleFrame, {
    mode: options.mode ?? entry?.interpolation ?? "hermite",
    preExtrapolation: options.preExtrapolation ?? entry?.preExtrapolation ?? "clamp",
    postExtrapolation: options.postExtrapolation ?? entry?.postExtrapolation ?? "clamp",
    scaleTangents: options.scaleTangents ?? true,
  });
}

function sampleDiscreteAnimationEntry(entry, frame, frameSize, options = {}) {
  const keyframes = entry?.keyframes ?? [];
  if (keyframes.length === 0) {
    return null;
  }

  const wrapBeforeFirst = options.wrapBeforeFirst !== false;
  let sampleFrame = frame;
  const returnNullBeforeFirst = options.returnNullBeforeFirst ?? !wrapBeforeFirst;
  if (!wrapBeforeFirst && returnNullBeforeFirst && sampleFrame < keyframes[0].frame) {
    return null;
  }
  if (wrapBeforeFirst && frameSize > 0 && keyframes[0].frame >= 0 && frame < keyframes[0].frame) {
    sampleFrame += frameSize;
  }

  let selected = keyframes[0];
  for (const keyframe of keyframes) {
    if (sampleFrame < keyframe.frame) {
      break;
    }
    selected = keyframe;
  }
  return selected?.value ?? null;
}

function sampleAnimationEntryWithDataType(entry, frame, frameSize, options = {}) {
  if (!entry) {
    return null;
  }

  // Integer/discrete BRLAN entries (e.g. RLVI, some RLMC channels) should
  // step at keyframes instead of Hermite interpolation.
  if (entry.dataType === 1 || entry.interpolation === "step") {
    return sampleDiscreteAnimationEntry(entry, frame, frameSize, options);
  }

  return sampleAnimationEntry(entry, frame, frameSize, {
    ...options,
    mode: options.mode ?? entry.interpolation ?? "hermite",
  });
}

function resolvePaneOrigin(originValue) {
  if (!Number.isFinite(originValue)) {
    return { x: 0.5, y: 0.5 };
  }

  const origin = Math.trunc(originValue);
  if (origin < 0 || origin > 8) {
    return { x: 0.5, y: 0.5 };
  }

  const col = origin % 3;
  const row = Math.floor(origin / 3);
  return {
    x: col / 2,
    y: row / 2,
  };
}

function multiply3x3(left, right) {
  return [
    left[0] * right[0] + left[1] * right[3] + left[2] * right[6],
    left[0] * right[1] + left[1] * right[4] + left[2] * right[7],
    left[0] * right[2] + left[1] * right[5] + left[2] * right[8],
    left[3] * right[0] + left[4] * right[3] + left[5] * right[6],
    left[3] * right[1] + left[4] * right[4] + left[5] * right[7],
    left[3] * right[2] + left[4] * right[5] + left[5] * right[8],
    left[6] * right[0] + left[7] * right[3] + left[8] * right[6],
    left[6] * right[1] + left[7] * right[4] + left[8] * right[7],
    left[6] * right[2] + left[7] * right[5] + left[8] * right[8],
  ];
}

function rotateVector(matrix, x, y, z) {
  return {
    x: matrix[0] * x + matrix[1] * y + matrix[2] * z,
    y: matrix[3] * x + matrix[4] * y + matrix[5] * z,
    z: matrix[6] * x + matrix[7] * y + matrix[8] * z,
  };
}

function buildRotationMatrix(rotXRad, rotYRad, rotZRad, order = "RZ_RY_RX") {
  const cx = Math.cos(rotXRad);
  const sx = Math.sin(rotXRad);
  const cy = Math.cos(rotYRad);
  const sy = Math.sin(rotYRad);
  const cz = Math.cos(rotZRad);
  const sz = Math.sin(rotZRad);

  const rotationByAxis = {
    RX: [1, 0, 0, 0, cx, -sx, 0, sx, cx],
    RY: [cy, 0, sy, 0, 1, 0, -sy, 0, cy],
    RZ: [cz, -sz, 0, sz, cz, 0, 0, 0, 1],
  };

  const tokens = String(order ?? "RZ_RY_RX")
    .toUpperCase()
    .split(/[^A-Z]+/g)
    .filter((token) => token === "RX" || token === "RY" || token === "RZ");
  const effectiveOrder = tokens.length > 0 ? tokens : ["RZ", "RY", "RX"];

  let matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (const token of effectiveOrder) {
    matrix = multiply3x3(matrix, rotationByAxis[token]);
  }
  return matrix;
}

function projectPointPerspective(point, zOffset, distance) {
  const safeDistance = Math.max(64, distance);
  const denom = Math.max(1e-3, safeDistance - (point.z + zOffset));
  const scale = safeDistance / denom;
  return {
    x: point.x * scale,
    y: point.y * scale,
  };
}

function getProjectedTransform2D(renderer, state) {
  const rotXRad = (state.rotX * Math.PI) / 180;
  const rotYRad = (state.rotY * Math.PI) / 180;
  // Canvas y-axis points down; keep legacy BRLYT yaw convention by
  // mirroring Z rotation sign to match previous rotate(-z) behavior.
  const rotZRad = (-state.rotation * Math.PI) / 180;
  const matrix = buildRotationMatrix(rotXRad, rotYRad, rotZRad, renderer.rotationOrder);
  const axisX = rotateVector(matrix, state.sx, 0, 0);
  const axisY = rotateVector(matrix, 0, state.sy, 0);

  if (!renderer.perspectiveEnabled) {
    return {
      a: axisX.x,
      b: axisX.y,
      c: axisY.x,
      d: axisY.y,
    };
  }

  const origin = projectPointPerspective({ x: 0, y: 0, z: 0 }, state.tz, renderer.perspectiveDistance);
  const projectedX = projectPointPerspective(axisX, state.tz, renderer.perspectiveDistance);
  const projectedY = projectPointPerspective(axisY, state.tz, renderer.perspectiveDistance);
  return {
    a: projectedX.x - origin.x,
    b: projectedX.y - origin.y,
    c: projectedY.x - origin.x,
    d: projectedY.y - origin.y,
  };
}

export function getPaneOriginOffset(pane, width, height) {
  const anchor = resolvePaneOrigin(pane?.origin);
  return {
    x: (0.5 - anchor.x) * width,
    y: (0.5 - anchor.y) * height,
  };
}

function mapRlvcChannel(type) {
  const numericType = Number.isFinite(type) ? Math.floor(type) : -1;
  if (numericType < 0 || numericType > 0x0f) {
    return null;
  }

  const corner = Math.floor(numericType / 4);
  const channelByIndex = ["r", "g", "b", "a"];
  return {
    corner,
    channel: channelByIndex[numericType % 4],
  };
}

function createPartialVertexColorArray() {
  return [
    { r: null, g: null, b: null, a: null },
    { r: null, g: null, b: null, a: null },
    { r: null, g: null, b: null, a: null },
    { r: null, g: null, b: null, a: null },
  ];
}

export function getAnimValues(paneName, frame) {
  const result = {
    transX: null,
    transY: null,
    transZ: null,
    rotX: null,
    rotY: null,
    rotZ: null,
    scaleX: null,
    scaleY: null,
    alpha: null,
    materialAlpha: null,
    visible: null,
    width: null,
    height: null,
    vertexColors: null,
    textureIndex: null,
  };

  if (!this.anim) {
    return result;
  }

  const paneAnimation = this.animByPaneName.get(paneName);
  if (!paneAnimation) {
    return result;
  }

  for (const tag of paneAnimation.tags ?? []) {
    const tagType = String(tag?.type ?? "");
    for (const entry of tag.entries ?? []) {
      if (tagType === "RLPA" || !tagType) {
        const value = sampleAnimationEntryWithDataType(entry, frame, this.anim.frameSize);
        if (value == null) {
          continue;
        }

        switch (entry.type) {
          case 0x00:
            result.transX = value;
            break;
          case 0x01:
            result.transY = value;
            break;
          case 0x02:
            result.transZ = value;
            break;
          case 0x03:
            result.rotX = value;
            break;
          case 0x04:
            result.rotY = value;
            break;
          case 0x05:
            result.rotZ = value;
            break;
          case 0x06:
            result.scaleX = value;
            break;
          case 0x07:
            result.scaleY = value;
            break;
          case 0x08:
            result.width = value;
            break;
          case 0x09:
            result.height = value;
            break;
          case 0x0a:
            result.alpha = value;
            break;
          case 0x0b:
            result.materialAlpha = value;
            break;
          default:
            break;
        }
      } else if (tagType === "RLVC") {
        const value = sampleAnimationEntryWithDataType(entry, frame, this.anim.frameSize, {
          wrapBeforeFirst: false,
          returnNullBeforeFirst: false,
        });
        if (value == null) {
          continue;
        }

        const mappedChannel = mapRlvcChannel(entry.type);
        if (mappedChannel) {
          if (!result.vertexColors) {
            result.vertexColors = createPartialVertexColorArray();
          }
          result.vertexColors[mappedChannel.corner][mappedChannel.channel] = clampChannel(value);
          continue;
        }

        // RLVC alpha channels are commonly used for pane fade/visibility control.
        if (entry.type === 0x10) {
          result.alpha = value;
        }
      } else if (tagType === "RLVI") {
        // Some channels use RLVI to hard-toggle pane visibility (0 = hidden, 1 = visible).
        if (entry.type === 0x00) {
          const visibilityValue = sampleDiscreteAnimationEntry(entry, frame, this.anim.frameSize, {
            wrapBeforeFirst: true,
            returnNullBeforeFirst: false,
          });
          if (visibilityValue != null) {
            result.visible = visibilityValue >= 0.5;
          }
        }
      } else if (tagType === "RLTP") {
        // Texture pattern animation: swap which texture map index is active.
        if (entry.type === 0x00) {
          const texIdx = sampleDiscreteAnimationEntry(entry, frame, this.anim.frameSize, {
            wrapBeforeFirst: true,
            returnNullBeforeFirst: false,
          });
          if (texIdx != null) {
            result.textureIndex = Math.max(0, Math.floor(texIdx));
          }
        }
      }
    }
  }

  return result;
}

export function getPaneTextureSRTAnimations(paneName, frame) {
  if (!this.anim) {
    return null;
  }

  const cacheKey = `${paneName}|${frame.toFixed(4)}`;
  const cached = this.textureSrtAnimationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const paneAnimation = this.animByPaneName.get(paneName);
  if (!paneAnimation) {
    this.textureSrtAnimationCache.set(cacheKey, null);
    return null;
  }

  const byMapIndex = new Map();
  for (const tag of paneAnimation.tags ?? []) {
    if (tag?.type !== "RLTS") {
      continue;
    }

    for (const entry of tag.entries ?? []) {
      const value = sampleAnimationEntryWithDataType(entry, frame, this.anim.frameSize);
      if (value == null) {
        continue;
      }

      const mapIndex = Number.isFinite(entry?.targetGroup) ? Math.max(0, Math.floor(entry.targetGroup)) : 0;
      let target = byMapIndex.get(mapIndex);
      if (!target) {
        target = {};
        byMapIndex.set(mapIndex, target);
      }

      switch (entry.type) {
        case 0x00:
        case 0x0c:
          target.xTrans = value;
          break;
        case 0x01:
        case 0x0d:
          target.yTrans = value;
          break;
        case 0x02:
        case 0x0e:
          target.rotation = value;
          break;
        case 0x03:
        case 0x0f:
          target.xScale = value;
          break;
        case 0x04:
        case 0x10:
          target.yScale = value;
          break;
        default:
          break;
      }
    }
  }

  const result = byMapIndex.size > 0 ? byMapIndex : null;
  this.textureSrtAnimationCache.set(cacheKey, result);
  return result;
}

export function getPaneMaterialAnimColor(paneName, frame) {
  // RLMC channel layout:
  // 0x00-0x03: color1 (foreColor) RGBA
  // 0x04-0x07: color2 (backColor) RGBA
  // 0x08-0x0B: color3 RGBA
  // 0x0C-0x0F: TEV color 1 RGBA
  // 0x10-0x13: TEV color 2 RGBA
  const result = {
    color1: { r: null, g: null, b: null, a: null },
    color2: { r: null, g: null, b: null, a: null },
    color3: { r: null, g: null, b: null, a: null },
    // Merged view for backward compat: first non-null wins across color1/2/3.
    r: null, g: null, b: null, a: null,
  };
  if (!this.anim) {
    return result;
  }

  const paneAnimation = this.animByPaneName.get(paneName);
  if (!paneAnimation) {
    return result;
  }

  const channelNames = ["r", "g", "b", "a"];
  for (const tag of paneAnimation.tags ?? []) {
    if (tag?.type !== "RLMC") {
      continue;
    }

    for (const entry of tag.entries ?? []) {
      const value = sampleAnimationEntryWithDataType(entry, frame, this.anim.frameSize, {
        wrapBeforeFirst: false,
      });
      if (value == null) {
        continue;
      }

      const type = entry.type;
      if (type >= 0x00 && type <= 0x03) {
        result.color1[channelNames[type]] = clampChannel(value);
      } else if (type >= 0x04 && type <= 0x07) {
        result.color2[channelNames[type - 0x04]] = clampChannel(value);
      } else if (type >= 0x08 && type <= 0x0b) {
        result.color3[channelNames[type - 0x08]] = clampChannel(value);
      } else if (type >= 0x10 && type <= 0x13) {
        // TEV color channels mapped to color3 as a fallback.
        const ch = channelNames[type - 0x10];
        if (result.color3[ch] == null) {
          result.color3[ch] = clampChannel(value);
        }
      }
    }
  }

  // Build merged view: prefer color2 (backColor/tint), then color3, then color1.
  for (const ch of channelNames) {
    result[ch] = result.color2[ch] ?? result.color3[ch] ?? result.color1[ch];
  }

  return result;
}


export function getPaneTransformChain(pane) {
  const cached = this.paneTransformChains.get(pane);
  if (cached) {
    return cached;
  }

  const chain = [];
  const seen = new Set();
  let current = pane;

  while (current && !seen.has(current.name)) {
    chain.push(current);
    seen.add(current.name);

    if (!current.parent) {
      break;
    }
    current = this.panesByName.get(current.parent) ?? null;
  }

  chain.reverse();
  this.paneTransformChains.set(pane, chain);
  return chain;
}

function mergeAnimatedVertexColors(pane, animatedVertexColors) {
  if (!animatedVertexColors) {
    return pane?.vertexColors ?? null;
  }

  const base = normalizePaneVertexColors(pane) ?? [
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
  ];

  return base.map((color, index) => ({
    r: clampChannel(animatedVertexColors[index]?.r ?? color.r),
    g: clampChannel(animatedVertexColors[index]?.g ?? color.g),
    b: clampChannel(animatedVertexColors[index]?.b ?? color.b),
    a: clampChannel(animatedVertexColors[index]?.a ?? color.a),
  }));
}

export function getLocalPaneState(pane, frame) {
  const animValues = this.getAnimValues(pane.name, frame);
  const tx = animValues.transX ?? pane.translate?.x ?? 0;
  const ty = animValues.transY ?? pane.translate?.y ?? 0;
  const tz = animValues.transZ ?? pane.translate?.z ?? 0;
  const rotX = animValues.rotX ?? pane.rotate?.x ?? 0;
  const rotY = animValues.rotY ?? pane.rotate?.y ?? 0;
  const sx = animValues.scaleX ?? pane.scale?.x ?? 1;
  const sy = animValues.scaleY ?? pane.scale?.y ?? 1;
  const rotation = animValues.rotZ ?? pane.rotate?.z ?? 0;
  const width = animValues.width ?? pane.size?.w ?? 0;
  const height = animValues.height ?? pane.size?.h ?? 0;

  const visibilityOverride = this.getCustomWeatherVisibilityOverride?.(pane);
  const hasAnimatedAlpha = animValues.alpha != null;
  const isVisible = visibilityOverride != null
    ? visibilityOverride
    : animValues.visible != null
      ? animValues.visible
      : hasAnimatedAlpha
        ? true
        : pane.visible !== false;
  const defaultAlpha = isVisible ? (pane.alpha ?? 255) / 255 : 0;
  const animatedAlpha = hasAnimatedAlpha ? animValues.alpha / 255 : defaultAlpha;
  const materialAlphaFactor = animValues.materialAlpha != null ? Math.max(0, Math.min(1, animValues.materialAlpha / 255)) : 1;
  const alpha = isVisible ? animatedAlpha * materialAlphaFactor : 0;
  const propagatesAlpha = (pane.flags & 0x02) !== 0 || pane.type === "pic1" || pane.type === "txt1" || pane.type === "bnd1" || pane.type === "wnd1";
  const propagatesVisibility = true;

  return {
    tx,
    ty,
    tz,
    rotX,
    rotY,
    sx,
    sy,
    rotation,
    width,
    height,
    visible: isVisible,
    propagatesAlpha,
    propagatesVisibility,
    vertexColors: mergeAnimatedVertexColors(pane, animValues.vertexColors),
    alpha: Math.max(0, Math.min(1, alpha)),
    textureIndex: animValues.textureIndex,
  };
}

export function getPaneVertexColorModulation(pane, paneState = null, frame = this.frame, widthHint = 48, heightHint = 48) {
  const colors = paneState?.vertexColors ? normalizePaneVertexColors({ vertexColors: paneState.vertexColors }) : normalizePaneVertexColors(pane);
  if (!colors) {
    this.vertexColorModulationCache.set(pane, { cacheKey: "", signature: "", modulation: null });
    return null;
  }

  const hasColorTint = colors.some((color) => color.r !== 255 || color.g !== 255 || color.b !== 255);
  const hasAlphaTint = colors.some((color) => color.a !== 255);
  if (!hasColorTint && !hasAlphaTint) {
    this.vertexColorModulationCache.set(pane, { cacheKey: "", signature: "", modulation: null });
    return null;
  }

  const sizeKey = `${Math.max(1, Math.round(Math.abs(widthHint)))}x${Math.max(1, Math.round(Math.abs(heightHint)))}`;
  const colorSignature = colors.map((color) => `${color.r},${color.g},${color.b},${color.a}`).join("|");
  const cacheKey = `${frame.toFixed(4)}|${sizeKey}`;
  const cached = this.vertexColorModulationCache.get(pane);
  if (cached && cached.cacheKey === cacheKey && cached.signature === colorSignature) {
    return cached.modulation;
  }

  const modulation = {
    hasColorTint,
    hasAlphaTint,
    colorCanvas: hasColorTint ? buildVertexColorCanvas(colors, "color", widthHint, heightHint) : null,
    alphaCanvas: hasAlphaTint ? buildVertexColorCanvas(colors, "alpha", widthHint, heightHint) : null,
  };
  this.vertexColorModulationCache.set(pane, {
    cacheKey,
    signature: colorSignature,
    modulation,
  });
  return modulation;
}

export function getPaneMaterialColorModulation(pane, frame = this.frame) {
  const cached = this.materialColorModulationCache.get(pane);
  if (cached && cached.frame === frame) {
    return cached.modulation;
  }

  if (!Number.isInteger(pane?.materialIndex) || pane.materialIndex < 0 || pane.materialIndex >= this.layout.materials.length) {
    this.materialColorModulationCache.set(pane, { frame, modulation: null });
    return null;
  }

  const material = this.layout.materials[pane.materialIndex];
  const staticColor = normalizeMaterialColor(material?.color2) ?? { r: 255, g: 255, b: 255, a: 255 };
  const animatedColor = this.getPaneMaterialAnimColor(pane.name, frame);
  const color = {
    r: animatedColor.r ?? staticColor.r,
    g: animatedColor.g ?? staticColor.g,
    b: animatedColor.b ?? staticColor.b,
    a: animatedColor.a ?? staticColor.a,
  };

  const hasColorTint = color.r !== 255 || color.g !== 255 || color.b !== 255;
  const hasAlphaTint = color.a !== 255;
  if (!hasColorTint && !hasAlphaTint) {
    this.materialColorModulationCache.set(pane, { frame, modulation: null });
    return null;
  }

  const modulation = { ...color, hasColorTint, hasAlphaTint };
  this.materialColorModulationCache.set(pane, { frame, modulation });
  return modulation;
}

export function applyPaneMaterialColorModulation(context, pane, width, height) {
  const modulation = this.getPaneMaterialColorModulation(pane);
  if (!modulation) {
    return;
  }

  const x = -width / 2;
  const y = -height / 2;

  if (modulation.hasColorTint) {
    applyColorBlendPreservingAlpha(this, context, width, height, () => {
      context.save();
      context.globalAlpha = 1;
      context.globalCompositeOperation = "multiply";
      context.fillStyle = `rgba(${modulation.r}, ${modulation.g}, ${modulation.b}, 1)`;
      context.fillRect(x, y, width, height);
      context.restore();
    });
  }

  if (modulation.hasAlphaTint) {
    context.save();
    context.globalAlpha = 1;
    context.globalCompositeOperation = "destination-in";
    context.fillStyle = `rgba(255, 255, 255, ${modulation.a / 255})`;
    context.fillRect(x, y, width, height);
    context.restore();
  }
}


export function applyPaneVertexColorModulation(context, pane, paneState, width, height) {
  const modulation = this.getPaneVertexColorModulation(pane, paneState, this.frame, width, height);
  if (!modulation) {
    return;
  }

  const x = -width / 2;
  const y = -height / 2;

  if (modulation.hasColorTint && modulation.colorCanvas) {
    applyColorBlendPreservingAlpha(this, context, width, height, () => {
      context.save();
      context.globalAlpha = 1;
      context.globalCompositeOperation = "multiply";
      context.drawImage(modulation.colorCanvas, x, y, width, height);
      context.restore();
    });
  }

  if (modulation.hasAlphaTint && modulation.alphaCanvas) {
    context.save();
    context.globalAlpha = 1;
    context.globalCompositeOperation = "destination-in";
    context.drawImage(modulation.alphaCanvas, x, y, width, height);
    context.restore();
  }
}

export function shouldTreatPaneAsLumaMask(pane, binding) {
  if (!pane || !binding) {
    return false;
  }

  const paneName = String(pane.name ?? "").toLowerCase();
  if (paneName !== "ch2") {
    return false;
  }

  const baseTextureName = String(binding.textureName ?? "").split("|", 1)[0];
  if (!baseTextureName) {
    return false;
  }

  const format = this.getTextureFormat(baseTextureName);
  if (format !== 1) {
    return false;
  }

  const material =
    binding.material ??
    (Number.isInteger(pane.materialIndex) && pane.materialIndex >= 0 && pane.materialIndex < this.layout.materials.length
      ? this.layout.materials[pane.materialIndex]
      : null);
  const color1 = normalizeMaterialColor(material?.color1);
  if (!color1) {
    return true;
  }

  return color1.a === 0 && color1.r >= 200 && color1.g >= 200 && color1.b >= 200;
}

export function shouldTreatPaneAsLumaOverlay(pane, binding) {
  if (!pane || !binding) {
    return false;
  }

  const paneName = String(pane.name ?? "").toLowerCase();
  if (paneName !== "tvline_00" && paneName !== "logobg") {
    return false;
  }

  const baseTextureName = String(binding.textureName ?? "").split("|", 1)[0];
  if (!baseTextureName) {
    return false;
  }

  const format = this.getTextureFormat(baseTextureName);
  return format === 0;
}

export function drawPaneAsLumaMask(context, binding, pane, width, height) {
  const baseTextureName = String(binding.textureName ?? "").split("|", 1)[0];
  const maskTexture = this.getLumaAlphaTexture(baseTextureName, { mode: "binary" });
  if (!maskTexture) {
    return false;
  }

  const maskBinding = {
    ...binding,
    texture: maskTexture,
    textureName: `${baseTextureName}|luma-alpha`,
  };

  // First, clip the accumulated icon layers to the rounded luma mask.
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = "destination-in";
  this.drawPaneTexture(context, maskBinding, pane, width, height);
  context.restore();

  // Then add a subtle white wash so the icon reads like Wii menu artwork.
  context.save();
  context.globalAlpha = 0.45;
  context.globalCompositeOperation = "source-atop";
  this.drawPaneTexture(context, maskBinding, pane, width, height);
  context.restore();

  return true;
}

export function drawPaneAsLumaOverlay(context, binding, pane, width, height) {
  const baseTextureName = String(binding.textureName ?? "").split("|", 1)[0];
  const overlayTexture = this.getLumaAlphaTexture(baseTextureName, { mode: "linear" });
  if (!overlayTexture) {
    return false;
  }

  const overlayBinding = {
    ...binding,
    texture: overlayTexture,
    textureName: `${baseTextureName}|luma-overlay`,
  };
  this.drawPaneTexture(context, overlayBinding, pane, width, height);
  return true;
}

export function getWrappedSurface(
  texture,
  textureName,
  sourceRect,
  wrapModeX,
  wrapModeY,
  tileWidth,
  tileHeight,
  targetWidth,
  targetHeight,
) {
  const repeatX = wrapModeX !== "clamp";
  const repeatY = wrapModeY !== "clamp";
  const src = sourceRect ?? { x: 0, y: 0, width: texture.width, height: texture.height };
  const safeTileWidth = Math.max(1, Math.round(tileWidth));
  const safeTileHeight = Math.max(1, Math.round(tileHeight));
  const safeTargetWidth = Math.max(1, Math.round(targetWidth));
  const safeTargetHeight = Math.max(1, Math.round(targetHeight));
  const mirrorX = wrapModeX === "mirror";
  const mirrorY = wrapModeY === "mirror";
  const tileWidthWithMirror = safeTileWidth * (mirrorX ? 2 : 1);
  const tileHeightWithMirror = safeTileHeight * (mirrorY ? 2 : 1);
  const key = [
    textureName,
    src.x,
    src.y,
    src.width,
    src.height,
    wrapModeX,
    wrapModeY,
    safeTileWidth,
    safeTileHeight,
    safeTargetWidth,
    safeTargetHeight,
  ].join(":");

  const cached = this.patternTextureCache.get(key);
  if (cached) {
    // Refresh insertion order for LRU eviction.
    this.patternTextureCache.delete(key);
    this.patternTextureCache.set(key, cached);
    return cached;
  }

  const surface = document.createElement("canvas");

  if (repeatX && repeatY) {
    surface.width = tileWidthWithMirror;
    surface.height = tileHeightWithMirror;
  } else if (repeatX) {
    surface.width = tileWidthWithMirror;
    surface.height = safeTargetHeight;
  } else {
    surface.width = safeTargetWidth;
    surface.height = tileHeightWithMirror;
  }

  const drawContext = surface.getContext("2d");
  const cellWidth = repeatX ? safeTileWidth : surface.width;
  const cellHeight = repeatY ? safeTileHeight : surface.height;
  const drawCell = (x, y, flipX, flipY) => {
    drawContext.save();
    drawContext.translate(x + (flipX ? cellWidth : 0), y + (flipY ? cellHeight : 0));
    drawContext.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    drawContext.drawImage(texture, src.x, src.y, src.width, src.height, 0, 0, cellWidth, cellHeight);
    drawContext.restore();
  };

  drawCell(0, 0, false, false);
  if (mirrorX) {
    drawCell(cellWidth, 0, true, false);
  }
  if (mirrorY) {
    drawCell(0, cellHeight, false, true);
  }
  if (mirrorX && mirrorY) {
    drawCell(cellWidth, cellHeight, true, true);
  }

  this.patternTextureCache.set(key, surface);
  while (this.patternTextureCache.size > this.patternTextureCacheLimit) {
    const oldestKey = this.patternTextureCache.keys().next().value;
    if (oldestKey == null) {
      break;
    }
    this.patternTextureCache.delete(oldestKey);
  }
  return surface;
}

export function drawPaneTextureWithVerticalClamp(context, binding, pane, width, height) {
  const texture = binding.texture;
  const textureSRT = binding.textureSRT ?? null;
  const texCoordIndex = binding.texCoordIndex ?? 0;
  const transformed = this.getTransformedTexCoords(pane, textureSRT, texCoordIndex);
  if (!transformed) {
    return false;
  }

  const eps = 1e-6;
  const topDeltaT = Math.abs(transformed.tl.t - transformed.tr.t);
  const bottomDeltaT = Math.abs(transformed.bl.t - transformed.br.t);
  if (topDeltaT > eps || bottomDeltaT > eps) {
    return false;
  }

  const tTop = (transformed.tl.t + transformed.tr.t) * 0.5;
  const tBottom = (transformed.bl.t + transformed.br.t) * 0.5;
  if (!Number.isFinite(tTop) || !Number.isFinite(tBottom) || Math.abs(tBottom - tTop) <= eps) {
    return false;
  }

  const wrapModeS = resolveWrapMode(binding.wrapS);
  const wrapModeT = resolveWrapMode(binding.wrapT);
  const repeatX = wrapModeS !== "clamp";
  const repeatY = wrapModeT !== "clamp";
  if (!repeatX || repeatY) {
    return false;
  }

  // Only use segmented clamp mapping when vertical coordinates are actually outside [0, 1].
  if (Math.min(tTop, tBottom) >= 0 && Math.max(tTop, tBottom) <= 1) {
    return false;
  }

  const baseSourceRect =
    this.getSourceRectForPane(pane, texture, {
      forceNormalized: true,
      repeatX: true,
      repeatY: true,
      textureSRT,
      texCoordIndex,
    }) ?? { x: 0, y: 0, width: texture.width, height: texture.height };

  const spans = this.getTexCoordSpans(pane, textureSRT, texCoordIndex);
  const sSpan = spans?.spanS ?? 1;
  const tileWidth = Math.abs(width) / Math.max(1e-6, sSpan);
  const paneTop = -height / 2;
  const textureHeight = texture.height;

  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const tAtV = (v) => tTop + (tBottom - tTop) * v;

  const drawSegment = (vStart, vEnd, sourceY, sourceHeight) => {
    const segVStart = Math.max(0, Math.min(1, vStart));
    const segVEnd = Math.max(0, Math.min(1, vEnd));
    if (segVEnd - segVStart <= 1e-6) {
      return;
    }

    const destY = paneTop + segVStart * height;
    const destHeight = (segVEnd - segVStart) * height;
    if (destHeight <= 0.25) {
      return;
    }

    const safeSourceHeight = Math.max(1, sourceHeight);
    const segmentSourceRect = {
      x: baseSourceRect.x,
      y: Math.max(0, Math.min(textureHeight - 1, sourceY)),
      width: baseSourceRect.width,
      height: Math.min(textureHeight, safeSourceHeight),
    };

    const surface = this.getWrappedSurface(
      texture,
      binding.textureName,
      segmentSourceRect,
      wrapModeS,
      "clamp",
      tileWidth,
      destHeight,
      width,
      destHeight,
    );

    const pattern = context.createPattern(surface, "repeat-x");
    if (!pattern) {
      return;
    }
    context.save();
    context.translate(-width / 2, destY);
    context.fillStyle = pattern;
    context.fillRect(0, 0, width, destHeight);
    context.restore();
  };

  const drawEdgeSegment = (vStart, vEnd, edge) => {
    const sourceY = edge <= 0 ? 0 : textureHeight - 1;
    drawSegment(vStart, vEnd, sourceY, 1);
  };

  const drawMappedSegment = (vStart, vEnd) => {
    if (vEnd - vStart <= 1e-6) {
      return;
    }
    const tStart = clamp01(tAtV(vStart));
    const tEnd = clamp01(tAtV(vEnd));
    const yStart = tStart * textureHeight;
    const yEnd = tEnd * textureHeight;
    const sourceTop = Math.max(0, Math.min(textureHeight - 1, Math.floor(Math.min(yStart, yEnd))));
    const sourceBottom = Math.max(sourceTop + 1, Math.min(textureHeight, Math.ceil(Math.max(yStart, yEnd))));
    drawSegment(vStart, vEnd, sourceTop, sourceBottom - sourceTop);
  };

  const deltaT = tBottom - tTop;
  const vAt0 = clamp01((0 - tTop) / deltaT);
  const vAt1 = clamp01((1 - tTop) / deltaT);

  if (deltaT > 0) {
    let mappedStart = 0;
    if (tTop < 0) {
      drawEdgeSegment(0, vAt0, 0);
      mappedStart = vAt0;
    }

    let mappedEnd = 1;
    if (tBottom > 1) {
      mappedEnd = vAt1;
    }

    drawMappedSegment(mappedStart, mappedEnd);

    if (mappedEnd < 1) {
      drawEdgeSegment(mappedEnd, 1, 1);
    }
    return true;
  }

  let mappedStart = 0;
  if (tTop > 1) {
    drawEdgeSegment(0, vAt1, 1);
    mappedStart = vAt1;
  }

  let mappedEnd = 1;
  if (tBottom < 0) {
    mappedEnd = vAt0;
  }

  drawMappedSegment(mappedStart, mappedEnd);

  if (mappedEnd < 1) {
    drawEdgeSegment(mappedEnd, 1, 0);
  }

  return true;
}

export function drawPaneTexture(context, binding, pane, width, height) {
  const texture = binding.texture;
  const wrapModeS = resolveWrapMode(binding.wrapS);
  const wrapModeT = resolveWrapMode(binding.wrapT);
  const repeatX = isTiledWrapMode(binding.wrapS);
  const repeatY = isTiledWrapMode(binding.wrapT);
  const textureSRT = binding.textureSRT ?? null;
  const texCoordIndex = binding.texCoordIndex ?? 0;

  if (this.drawPaneTextureWithVerticalClamp(context, binding, pane, width, height)) {
    return;
  }

  const sourceRect = this.getSourceRectForPane(pane, texture, {
    forceNormalized: repeatX || repeatY,
    repeatX,
    repeatY,
    textureSRT,
    texCoordIndex,
  });
  if (repeatX || repeatY) {
    const spans = this.getTexCoordSpans(pane, textureSRT, texCoordIndex);
    const sSpan = repeatX ? spans?.spanS ?? 1 : 1;
    const tSpan = repeatY ? spans?.spanT ?? 1 : 1;
    const tileWidth = repeatX ? Math.abs(width) / sSpan : Math.abs(width);
    const tileHeight = repeatY ? Math.abs(height) / tSpan : Math.abs(height);
    const surface = this.getWrappedSurface(
      texture,
      binding.textureName,
      sourceRect,
      wrapModeS,
      wrapModeT,
      tileWidth,
      tileHeight,
      width,
      height,
    );
    const repeatMode = repeatX && repeatY ? "repeat" : repeatX ? "repeat-x" : "repeat-y";
    const pattern = context.createPattern(surface, repeatMode);
    if (pattern) {
      context.save();
      context.translate(-width / 2, -height / 2);
      context.fillStyle = pattern;
      context.fillRect(0, 0, width, height);
      context.restore();
      return;
    }
  }

  if (sourceRect) {
    context.drawImage(
      texture,
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      -width / 2,
      -height / 2,
      width,
      height,
    );
    return;
  }

  context.drawImage(texture, -width / 2, -height / 2, width, height);
}

export function drawPane(context, binding, pane, paneState, width, height) {
  if (this.shouldDrawCustomTemperatureForPane(pane)) {
    if (this.drawCustomTemperaturePane(context, pane, width, height)) {
      return;
    }
  }

  if (this.shouldTreatPaneAsLumaMask(pane, binding)) {
    if (this.drawPaneAsLumaMask(context, binding, pane, width, height)) {
      return;
    }
  }

  if (this.shouldTreatPaneAsLumaOverlay(pane, binding)) {
    if (this.drawPaneAsLumaOverlay(context, binding, pane, width, height)) {
      return;
    }
  }

  const vertexModulation = this.getPaneVertexColorModulation(pane, paneState, this.frame, width, height);
  const materialModulation = binding?.skipMaterialColorModulation ? null : this.getPaneMaterialColorModulation(pane);
  if (!vertexModulation && !materialModulation) {
    this.drawPaneTexture(context, binding, pane, width, height);
    return;
  }

  const absWidth = Math.abs(width);
  const absHeight = Math.abs(height);
  if (absWidth < 1e-6 || absHeight < 1e-6) {
    return;
  }

  const surfaceWidth = Math.max(1, Math.ceil(absWidth));
  const surfaceHeight = Math.max(1, Math.ceil(absHeight));
  if (!this.paneCompositeSurface) {
    this.paneCompositeSurface = document.createElement("canvas");
    this.paneCompositeContext = this.paneCompositeSurface.getContext("2d");
  }

  if (this.paneCompositeSurface.width !== surfaceWidth || this.paneCompositeSurface.height !== surfaceHeight) {
    this.paneCompositeSurface.width = surfaceWidth;
    this.paneCompositeSurface.height = surfaceHeight;
  }

  const paneContext = this.paneCompositeContext;
  paneContext.setTransform(1, 0, 0, 1, 0, 0);
  paneContext.clearRect(0, 0, surfaceWidth, surfaceHeight);
  paneContext.imageSmoothingEnabled = true;
  paneContext.imageSmoothingQuality = "high";
  paneContext.save();
  paneContext.translate(surfaceWidth / 2, surfaceHeight / 2);
  this.drawPaneTexture(paneContext, binding, pane, surfaceWidth, surfaceHeight);
  this.applyPaneMaterialColorModulation(paneContext, pane, surfaceWidth, surfaceHeight);
  this.applyPaneVertexColorModulation(paneContext, pane, paneState, surfaceWidth, surfaceHeight);
  paneContext.restore();

  context.drawImage(this.paneCompositeSurface, -width / 2, -height / 2, width, height);
}

export function drawTextPane(context, pane, width, height) {
  const customText = this.getCustomWeatherTextForPane(pane);
  const rawText = typeof customText === "string" ? customText : typeof pane?.text === "string" ? pane.text : "";
  if (rawText.length === 0) {
    return;
  }

  const absWidth = Math.abs(width);
  const absHeight = Math.abs(height);
  if (absWidth < 1e-6 || absHeight < 1e-6) {
    return;
  }

  const paragraphs = rawText.replace(/\r/g, "").split("\n");
  if (paragraphs.length === 0) {
    return;
  }

  const fontSize = Math.max(1, Number.isFinite(pane?.textSize?.y) ? pane.textSize.y : absHeight * 0.45);
  const lineSpacing = Number.isFinite(pane?.lineSpacing) ? pane.lineSpacing : 0;

  let textAlign = "left";
  if (pane?.textAlignment === 1) {
    textAlign = "center";
  } else if (pane?.textAlignment === 2) {
    textAlign = "right";
  }

  const boxLeft = -width / 2;
  const boxTop = -height / 2;
  const textX = textAlign === "center" ? 0 : textAlign === "right" ? width / 2 : boxLeft;

  const topColor = pane?.textTopColor ?? { r: 32, g: 32, b: 32, a: 255 };
  const bottomColor = pane?.textBottomColor ?? topColor;

  context.save();
  context.textBaseline = "top";
  context.textAlign = textAlign;
  context.font = `${fontSize}px sans-serif`;
  const lineHeight = Math.max(1, fontSize + lineSpacing);

  const wrapParagraph = (paragraph) => {
    const trimmed = String(paragraph ?? "");
    if (trimmed.length === 0) {
      return [""];
    }
    const words = trimmed.split(/\s+/);
    const wrapped = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (context.measureText(candidate).width <= absWidth || !current) {
        current = candidate;
        continue;
      }
      wrapped.push(current);
      current = word;
    }
    if (current) {
      wrapped.push(current);
    }
    return wrapped.length > 0 ? wrapped : [""];
  };

  const lines = [];
  for (const paragraph of paragraphs) {
    lines.push(...wrapParagraph(paragraph));
  }
  if (lines.length === 0) {
    context.restore();
    return;
  }
  const contentHeight = lineHeight * lines.length;
  const textY = boxTop + Math.max(0, (height - contentHeight) / 2);

  const sameColor =
    topColor.r === bottomColor.r &&
    topColor.g === bottomColor.g &&
    topColor.b === bottomColor.b &&
    topColor.a === bottomColor.a;

  if (sameColor) {
    context.fillStyle = buildCssColor(topColor);
  } else {
    const gradient = context.createLinearGradient(0, boxTop, 0, boxTop + height);
    gradient.addColorStop(0, buildCssColor(topColor));
    gradient.addColorStop(1, buildCssColor(bottomColor));
    context.fillStyle = gradient;
  }

  for (let i = 0; i < lines.length; i += 1) {
    context.fillText(lines[i], textX, textY + i * lineHeight, absWidth);
  }
  context.restore();
}

function resolveBlendCompositeOp(pane, materials) {
  if (!Number.isInteger(pane?.materialIndex) || pane.materialIndex < 0 || pane.materialIndex >= materials.length) {
    return null;
  }

  const blendMode = materials[pane.materialIndex]?.blendMode;
  if (!blendMode || blendMode.func === 0) {
    return null;
  }

  // Blend func 1 = blend calculation: (Pixel × srcFactor) + (eFB × dstFactor)
  // Blend factor values: 0=zero, 1=one, 4=srcAlpha, 5=1-srcAlpha
  if (blendMode.func === 1) {
    const src = blendMode.srcFactor;
    const dst = blendMode.dstFactor;

    // Additive: src×1 + dst×1, or src×srcAlpha + dst×1
    if ((src === 1 && dst === 1) || (src === 4 && dst === 1)) {
      return "lighter";
    }

    // Standard alpha blend: src×srcAlpha + dst×(1-srcAlpha) → default
    if (src === 4 && dst === 5) {
      return null;
    }

    // src×one + dst×zero = replace (no blend, just overwrite)
    if (src === 1 && dst === 0) {
      return "copy";
    }
  }

  // Blend func 3 = subtract from eFB
  if (blendMode.func === 3) {
    return "difference";
  }

  return null;
}

function drawPaneWithResolvedState(renderer, context, pane, paneState, localPaneStates, layoutWidth, layoutHeight) {
  let alpha = 1;
  let visible = true;
  const transformChain = renderer.getPaneTransformChain(pane);

  context.save();
  context.translate(layoutWidth / 2, layoutHeight / 2);

  for (const chainPane of transformChain) {
    const chainState = localPaneStates.get(chainPane);
    if (!chainState) {
      continue;
    }

    if (chainPane !== pane && chainState.propagatesVisibility && chainState.visible === false) {
      visible = false;
    }
    if (chainPane === pane || chainState.propagatesAlpha) {
      alpha *= chainState.alpha;
    }

    context.translate(chainState.tx, -chainState.ty);
    const chainOriginOffset = renderer.getPaneOriginOffset(chainPane, chainState.width, chainState.height);
    if (chainOriginOffset.x !== 0 || chainOriginOffset.y !== 0) {
      context.translate(chainOriginOffset.x, chainOriginOffset.y);
    }

    const projected = getProjectedTransform2D(renderer, chainState);
    context.transform(projected.a, projected.b, projected.c, projected.d, 0, 0);
  }

  if (!visible || alpha <= 0) {
    context.restore();
    return;
  }

  context.globalAlpha = Math.max(0, Math.min(1, alpha));

  const blendOp = resolveBlendCompositeOp(pane, renderer.layout?.materials ?? []);
  if (blendOp) {
    context.globalCompositeOperation = blendOp;
  }

  if (pane.type === "pic1" || pane.type === "bnd1" || pane.type === "wnd1") {
    const binding = renderer.getTextureBindingForPane(pane, paneState);
    if (!binding) {
      context.restore();
      return;
    }
    renderer.drawPane(context, binding, pane, paneState, paneState.width, paneState.height);
  } else if (pane.type === "txt1") {
    renderer.drawTextPane(context, pane, paneState.width, paneState.height);
  }

  context.restore();
}

export function renderFrame(frame) {
  const context = this.ctx;
  this.textureSrtAnimationCache.clear();
  const layoutWidth = this.layout.width || this.canvas.clientWidth || this.canvas.width;
  const layoutHeight = this.layout.height || this.canvas.clientHeight || this.canvas.height;
  const referenceAspect = Number.isFinite(this.referenceAspectRatio) && this.referenceAspectRatio > 0
    ? this.referenceAspectRatio
    : 4 / 3;
  const displayAspect = Number.isFinite(this.displayAspectRatio) && this.displayAspectRatio > 0
    ? this.displayAspectRatio
    : null;
  const displayScaleX = displayAspect ? displayAspect / referenceAspect : 1;
  const outputWidth = layoutWidth * displayScaleX;
  const outputHeight = layoutHeight;
  const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.round(outputWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(outputHeight * dpr));

  if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
  }
  if (this.canvas.style) {
    this.canvas.style.width = `${outputWidth}px`;
    this.canvas.style.height = `${outputHeight}px`;
  }

  context.setTransform(dpr * displayScaleX, 0, 0, dpr, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  context.clearRect(0, 0, layoutWidth, layoutHeight);

  const localPaneStates = new Map();
  for (const pane of this.layout.panes) {
    localPaneStates.set(pane, this.getLocalPaneState(pane, frame));
  }

  const renderablePanes = this.layout.panes.filter((pane) =>
    pane.type === "pic1" || pane.type === "txt1" || pane.type === "bnd1" || pane.type === "wnd1"
  );
  const orderedRenderablePanes = this.getCustomWeatherOrderedPanes?.(renderablePanes) ?? renderablePanes;
  const shouldUseWiiShopBackdropMask =
    this.panesByName?.has("backCLs") &&
    this.panesByName?.has("mask_01") &&
    this.panesByName?.has("logo_base") &&
    this.layout?.textures?.includes("logo_pic01.tpl") &&
    this.layout?.textures?.includes("logo_pic02.tpl");

  let backdropContext = null;
  let hasBackdropContent = false;

  const ensureBackdropSurface = () => {
    if (!this.wiiShopBackdropSurface) {
      this.wiiShopBackdropSurface = document.createElement("canvas");
      this.wiiShopBackdropContext = this.wiiShopBackdropSurface.getContext("2d");
    }

    if (this.wiiShopBackdropSurface.width !== pixelWidth || this.wiiShopBackdropSurface.height !== pixelHeight) {
      this.wiiShopBackdropSurface.width = pixelWidth;
      this.wiiShopBackdropSurface.height = pixelHeight;
    }

    if (!backdropContext) {
      backdropContext = this.wiiShopBackdropContext;
      backdropContext.setTransform(dpr * displayScaleX, 0, 0, dpr, 0, 0);
      backdropContext.imageSmoothingEnabled = true;
      backdropContext.imageSmoothingQuality = "high";
      backdropContext.clearRect(0, 0, layoutWidth, layoutHeight);
    }

    return backdropContext;
  };

  const flushBackdropLayer = () => {
    if (!hasBackdropContent || !backdropContext || !this.wiiShopBackdropSurface) {
      return;
    }

    const maskPane = this.panesByName.get("mask_01");
    const maskPaneState = maskPane ? localPaneStates.get(maskPane) : null;
    if (maskPane && maskPaneState) {
      backdropContext.save();
      backdropContext.globalCompositeOperation = "destination-in";
      drawPaneWithResolvedState(this, backdropContext, maskPane, maskPaneState, localPaneStates, layoutWidth, layoutHeight);
      backdropContext.restore();
    }

    context.drawImage(this.wiiShopBackdropSurface, 0, 0, layoutWidth, layoutHeight);
    hasBackdropContent = false;
    backdropContext.clearRect(0, 0, layoutWidth, layoutHeight);
  };

  for (const pane of orderedRenderablePanes) {
    if (!this.shouldRenderPaneForLocale(pane)) {
      continue;
    }
    if (!this.shouldRenderPaneForState(pane)) {
      continue;
    }
    if (!this.shouldRenderPaneForPaneState(pane)) {
      continue;
    }
    if (!this.shouldRenderPaneForCustomWeather(pane)) {
      continue;
    }

    const paneState = localPaneStates.get(pane);
    if (!paneState) {
      continue;
    }

    if (shouldUseWiiShopBackdropMask) {
      const paneName = String(pane?.name ?? "");
      if (/^CL[A-Z_-]/i.test(paneName)) {
        const targetContext = ensureBackdropSurface();
        drawPaneWithResolvedState(this, targetContext, pane, paneState, localPaneStates, layoutWidth, layoutHeight);
        hasBackdropContent = true;
        continue;
      }

      if (paneName === "mask_01" || paneName === "mask_02") {
        continue;
      }

      if (paneName === "effects" && hasBackdropContent) {
        flushBackdropLayer();
      }
    }

    drawPaneWithResolvedState(this, context, pane, paneState, localPaneStates, layoutWidth, layoutHeight);
  }

  if (shouldUseWiiShopBackdropMask && hasBackdropContent) {
    flushBackdropLayer();
  }
}

export function render() {
  this.applyFrame(this.frame);
}

export function play() {
  if (this.playing) {
    return;
  }

  this.playing = true;

  if (this.useGsap && !this.sequenceEnabled) {
    this.ensureGsapTimeline();
    if (this.gsapTimeline) {
      this.gsapTimeline.play();
      return;
    }
  }

  this.lastTime = performance.now();

  const tick = (now) => {
    if (!this.playing) {
      return;
    }

    const delta = Math.max(0, now - this.lastTime);
    if (this.subframePlayback) {
      this.lastTime = now;
      this.advanceFrame(delta);
    } else {
      const frameDuration = 1000 / this.fps;
      if (delta >= frameDuration) {
        const steps = Math.min(8, Math.floor(delta / frameDuration));
        this.lastTime += steps * frameDuration;
        for (let i = 0; i < steps; i += 1) {
          this.advanceFrame(frameDuration);
        }
      }
    }

    this.animationId = requestAnimationFrame(tick);
  };

  this.animationId = requestAnimationFrame(tick);
}

export function stop() {
  this.playing = false;
  if (this.gsapTimeline) {
    this.gsapTimeline.pause();
  }
  if (this.animationId) {
    cancelAnimationFrame(this.animationId);
    this.animationId = null;
  }
}

export function reset() {
  if (this.sequenceEnabled && this.startAnim) {
    this.setActiveAnim(this.startAnim, "start");
  }
  this.frame = this.normalizeFrameForPlayback(this.startFrame);
  this.gsapDriver.frame = this.frame;
  if (this.gsapTimeline) {
    this.gsapTimeline.pause(0);
  }
  this.applyFrame(this.frame);
}

export function dispose() {
  this.stop();
  if (this.gsapTimeline) {
    this.gsapTimeline.kill();
    this.gsapTimeline = null;
  }
  this.patternTextureCache.clear();
  this.textureMaskCache.clear();
  this.lumaAlphaTextureCache.clear();
  this.textureSrtAnimationCache.clear();
  this.materialColorModulationCache = new WeakMap();
  this.vertexColorModulationCache = new WeakMap();
  this.paneCompositeSurface = null;
  this.paneCompositeContext = null;
  this.modulationScratchSurface = null;
  this.modulationScratchContext = null;
}
