import { clampChannel } from "./renderColorUtils";
import { sampleAnimationEntryWithDataType, sampleDiscreteAnimationEntry } from "./animationSampling";

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

function mergeFrozenAnimValues(renderer, paneName, result) {
  if (renderer.phase !== "loop" || !renderer.frozenStartState?.size) {
    return result;
  }
  const frozen = renderer.frozenStartState.get(paneName)?.animValues;
  if (!frozen) {
    return result;
  }
  for (const key of Object.keys(result)) {
    if (key === "vertexColors") continue;
    if (result[key] == null && frozen[key] != null) {
      result[key] = frozen[key];
    }
  }
  if (frozen.vertexColors && !result.vertexColors) {
    result.vertexColors = frozen.vertexColors;
  }
  return result;
}

function mergeFrozenMatColor(renderer, paneName, result) {
  if (renderer.phase !== "loop" || !renderer.frozenStartState?.size) {
    return result;
  }
  const frozen = renderer.frozenStartState.get(paneName)?.matColor;
  if (!frozen) {
    return result;
  }
  const channels = ["r", "g", "b", "a"];
  for (const slot of ["color1", "color2", "color3", "colorReg2"]) {
    for (const ch of channels) {
      if (result[slot][ch] == null && frozen[slot]?.[ch] != null) {
        result[slot][ch] = frozen[slot][ch];
      }
    }
  }
  if (frozen.kColors) {
    for (let ki = 0; ki < 4; ki += 1) {
      for (const ch of channels) {
        if (result.kColors[ki][ch] == null && frozen.kColors[ki]?.[ch] != null) {
          result.kColors[ki][ch] = frozen.kColors[ki][ch];
        }
      }
    }
  }
  for (const ch of channels) {
    result[ch] = result.color2[ch] ?? result.color3[ch] ?? result.color1[ch];
  }
  return result;
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
    return mergeFrozenAnimValues(this, paneName, result);
  }

  const paneAnimation = this.animByPaneName.get(paneName);
  if (!paneAnimation) {
    return mergeFrozenAnimValues(this, paneName, result);
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
        const value = sampleAnimationEntryWithDataType(entry, frame, this.anim.frameSize);
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
          const visibilityValue = sampleDiscreteAnimationEntry(entry, frame, this.anim.frameSize);
          if (visibilityValue != null) {
            result.visible = visibilityValue >= 0.5;
          }
        }
      } else if (tagType === "RLTP") {
        // Texture pattern animation: swap which texture map index is active.
        // The step value is an index into the BRLAN's timg name array, NOT a direct
        // layout texture index. We resolve it by looking up the timg name in the
        // layout's texture list (NW4R AnimTransformBasic::Animate behavior).
        if (entry.type === 0x00) {
          const texIdx = sampleDiscreteAnimationEntry(entry, frame, this.anim.frameSize);
          if (texIdx != null) {
            const rawTimgIdx = Math.max(0, Math.floor(texIdx));
            const timgNames = this.anim?.timgNames;
            if (timgNames && rawTimgIdx < timgNames.length) {
              const timgName = timgNames[rawTimgIdx];
              const layoutIdx = this.layout?.textures?.indexOf(timgName);
              result.textureIndex = (layoutIdx != null && layoutIdx >= 0) ? layoutIdx : rawTimgIdx;
            } else {
              result.textureIndex = rawTimgIdx;
            }
          }
        }
      }
    }
  }

  return mergeFrozenAnimValues(this, paneName, result);
}

export function getPaneTextureSRTAnimations(paneName, frame) {
  if (!this.anim) {
    if (this.phase === "loop" && this.frozenStartState?.size > 0) {
      return this.frozenStartState.get(paneName)?.texSrt ?? null;
    }
    return null;
  }

  const cacheKey = `${paneName}|${frame.toFixed(4)}`;
  const cached = this.textureSrtAnimationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const paneAnimation = this.animByPaneName.get(paneName);
  if (!paneAnimation) {
    const frozenResult = (this.phase === "loop" && this.frozenStartState?.size > 0)
      ? (this.frozenStartState.get(paneName)?.texSrt ?? null)
      : null;
    this.textureSrtAnimationCache.set(cacheKey, frozenResult);
    return frozenResult;
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

  let result = byMapIndex.size > 0 ? byMapIndex : null;
  if (!result && this.phase === "loop" && this.frozenStartState?.size > 0) {
    result = this.frozenStartState.get(paneName)?.texSrt ?? null;
  }
  this.textureSrtAnimationCache.set(cacheKey, result);
  return result;
}

export function getPaneMaterialAnimColor(paneName, frame) {
  // RLMC channel layout (matches reference Material::ProcessHermiteKey):
  // 0x00-0x03: material color RGBA (ref: separate `color` field, our: color1)
  // 0x04-0x07: color_regs[0] RGBA → TEVREG0 (C0) (ref→our: color2→material.color1)
  // 0x08-0x0B: color_regs[1] RGBA → TEVREG1 (C1) (ref→our: color3→material.color2)
  // 0x0C-0x0F: color_regs[2] RGBA → TEVREG2 (C2) (ref→our: colorReg2→material.color3)
  // 0x10-0x1F: color_constants[0..3] RGBA → kColors for KONST inputs
  const channelNames = ["r", "g", "b", "a"];
  const result = {
    color1: { r: null, g: null, b: null, a: null },
    color2: { r: null, g: null, b: null, a: null },
    color3: { r: null, g: null, b: null, a: null },
    colorReg2: { r: null, g: null, b: null, a: null },
    kColors: [
      { r: null, g: null, b: null, a: null },
      { r: null, g: null, b: null, a: null },
      { r: null, g: null, b: null, a: null },
      { r: null, g: null, b: null, a: null },
    ],
    // Merged view for backward compat: first non-null wins across color1/2/3.
    r: null, g: null, b: null, a: null,
  };
  if (!this.anim) {
    return mergeFrozenMatColor(this, paneName, result);
  }

  const paneAnimation = this.animByPaneName.get(paneName);
  if (!paneAnimation) {
    return mergeFrozenMatColor(this, paneName, result);
  }

  for (const tag of paneAnimation.tags ?? []) {
    if (tag?.type !== "RLMC") {
      continue;
    }

    for (const entry of tag.entries ?? []) {
      const value = sampleAnimationEntryWithDataType(entry, frame, this.anim.frameSize);
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
      } else if (type >= 0x0c && type <= 0x0f) {
        result.colorReg2[channelNames[type - 0x0c]] = clampChannel(value);
      } else if (type >= 0x10 && type <= 0x1f) {
        const kIdx = Math.floor((type - 0x10) / 4);
        result.kColors[kIdx][channelNames[(type - 0x10) % 4]] = clampChannel(value);
      }
    }
  }

  // During loop phase, fill in missing material color values from frozen start state.
  if (this.phase === "loop" && this.frozenStartState?.size > 0) {
    const frozen = this.frozenStartState.get(paneName)?.matColor;
    if (frozen) {
      for (const slot of ["color1", "color2", "color3", "colorReg2"]) {
        for (const ch of channelNames) {
          if (result[slot][ch] == null && frozen[slot]?.[ch] != null) {
            result[slot][ch] = frozen[slot][ch];
          }
        }
      }
      if (frozen.kColors) {
        for (let ki = 0; ki < 4; ki += 1) {
          for (const ch of channelNames) {
            if (result.kColors[ki][ch] == null && frozen.kColors[ki]?.[ch] != null) {
              result.kColors[ki][ch] = frozen.kColors[ki][ch];
            }
          }
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
