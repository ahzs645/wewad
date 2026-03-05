function wrapFrame(frame, start, end) {
  const span = end - start;
  if (!Number.isFinite(span) || span <= 1e-6) {
    return start;
  }
  return start + ((((frame - start) % span) + span) % span);
}

function findSegmentIndex(keyframes, frame) {
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const left = keyframes[i];
    const right = keyframes[i + 1];
    if (frame >= left.frame && frame <= right.frame) {
      return i;
    }
  }
  return keyframes.length - 2;
}

function interpolateStep(keyframes, frame) {
  let selected = keyframes[0];
  for (const keyframe of keyframes) {
    if (frame < keyframe.frame) {
      break;
    }
    selected = keyframe;
  }
  return selected.value;
}

function interpolateLinear(keyframes, frame) {
  const index = findSegmentIndex(keyframes, frame);
  const left = keyframes[index];
  const right = keyframes[index + 1];
  const span = right.frame - left.frame;
  if (Math.abs(span) < 1e-6) {
    return right.value;
  }
  const t = (frame - left.frame) / span;
  return left.value + (right.value - left.value) * t;
}

function interpolateHermite(keyframes, frame, options = {}) {
  const index = findSegmentIndex(keyframes, frame);
  const left = keyframes[index];
  const right = keyframes[index + 1];
  const span = right.frame - left.frame;
  if (Math.abs(span) < 1e-6) {
    return right.value;
  }

  const t = (frame - left.frame) / span;
  const t2 = t * t;
  const t3 = t2 * t;
  const tangentScale = options.scaleTangents === true ? span : 1;
  const leftTangent = left.blend * tangentScale;
  const rightTangent = right.blend * tangentScale;

  return (
    (2 * t3 - 3 * t2 + 1) * left.value +
    (t3 - 2 * t2 + t) * leftTangent +
    (-2 * t3 + 3 * t2) * right.value +
    (t3 - t2) * rightTangent
  );
}

function extrapolateLinearBefore(keyframes, frame) {
  if (keyframes.length < 2) {
    return keyframes[0].value;
  }
  const first = keyframes[0];
  const second = keyframes[1];
  const span = second.frame - first.frame;
  if (Math.abs(span) < 1e-6) {
    return first.value;
  }
  const slope = (second.value - first.value) / span;
  return first.value + (frame - first.frame) * slope;
}

function extrapolateLinearAfter(keyframes, frame) {
  if (keyframes.length < 2) {
    return keyframes[keyframes.length - 1].value;
  }
  const last = keyframes[keyframes.length - 1];
  const prev = keyframes[keyframes.length - 2];
  const span = last.frame - prev.frame;
  if (Math.abs(span) < 1e-6) {
    return last.value;
  }
  const slope = (last.value - prev.value) / span;
  return last.value + (frame - last.frame) * slope;
}

export function interpolateKeyframes(keyframes, frame, options = {}) {
  if (keyframes.length === 0) {
    return 0;
  }

  if (keyframes.length === 1) {
    return keyframes[0].value;
  }

  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  const mode = options.mode ?? "hermite";
  const preExtrapolation = options.preExtrapolation ?? "clamp";
  const postExtrapolation = options.postExtrapolation ?? "clamp";
  let sampleFrame = Number.isFinite(frame) ? frame : first.frame;

  if (sampleFrame < first.frame) {
    if (preExtrapolation === "loop") {
      sampleFrame = wrapFrame(sampleFrame, first.frame, last.frame);
    } else if (preExtrapolation === "linear") {
      return extrapolateLinearBefore(keyframes, sampleFrame);
    } else {
      return first.value;
    }
  } else if (sampleFrame > last.frame) {
    if (postExtrapolation === "loop") {
      sampleFrame = wrapFrame(sampleFrame, first.frame, last.frame);
    } else if (postExtrapolation === "linear") {
      return extrapolateLinearAfter(keyframes, sampleFrame);
    } else {
      return last.value;
    }
  }

  if (mode === "step") {
    return interpolateStep(keyframes, sampleFrame);
  }
  if (mode === "linear") {
    return interpolateLinear(keyframes, sampleFrame);
  }

  return interpolateHermite(keyframes, sampleFrame, options);
}

function copyEntry(entry) {
  return {
    targetGroup: entry.targetGroup ?? 0,
    type: entry.type,
    dataType: entry.dataType,
    typeName: entry.typeName,
    interpolation: entry.interpolation,
    preExtrapolation: entry.preExtrapolation,
    postExtrapolation: entry.postExtrapolation,
    keyframes: entry.keyframes.map((keyframe) => ({ ...keyframe })),
  };
}

function dedupeKeyframesPreservingConflicts(keyframes) {
  const sorted = [...keyframes].sort((left, right) => left.frame - right.frame);
  const deduped = [];
  const frameEpsilon = 1e-4;
  const valueEpsilon = 1e-6;

  for (const keyframe of sorted) {
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.abs(prev.frame - keyframe.frame) >= 1e-6) {
      deduped.push({ ...keyframe });
      continue;
    }

    const sameValue = Math.abs((prev.value ?? 0) - (keyframe.value ?? 0)) < valueEpsilon;
    const sameBlend = Math.abs((prev.blend ?? 0) - (keyframe.blend ?? 0)) < valueEpsilon;
    if (sameValue && sameBlend) {
      continue;
    }

    deduped.push({
      ...keyframe,
      frame: prev.frame + frameEpsilon,
    });
  }

  return deduped;
}

export function mergePaneAnimations(panes = []) {
  const byName = new Map();
  for (const pane of panes) {
    const existing = byName.get(pane.name);
    if (!existing) {
      byName.set(pane.name, {
        name: pane.name,
        tags: pane.tags.map((tag) => ({
          type: tag.type,
          entries: tag.entries.map((entry) => copyEntry(entry)),
        })),
      });
      continue;
    }

    const tagMap = new Map(existing.tags.map((tag) => [tag.type, tag]));
    for (const tag of pane.tags) {
      let targetTag = tagMap.get(tag.type);
      if (!targetTag) {
        targetTag = { type: tag.type, entries: [] };
        existing.tags.push(targetTag);
        tagMap.set(tag.type, targetTag);
      }

      const useTargetGroupKey =
        tag.type === "RLTS" ||
        tag.type === "RLMC" ||
        tag.type === "RLVC";
      const entryKey = (entry) =>
        useTargetGroupKey
          ? `${entry.targetGroup ?? 0}:${entry.type}`
          : `${entry.type}`;
      const entryMap = new Map(targetTag.entries.map((entry) => [entryKey(entry), entry]));
      for (const entry of tag.entries) {
        const key = entryKey(entry);
        const existingEntry = entryMap.get(key);
        if (!existingEntry) {
          targetTag.entries.push(copyEntry(entry));
          entryMap.set(key, targetTag.entries[targetTag.entries.length - 1]);
          continue;
        }

        existingEntry.keyframes.push(...entry.keyframes.map((keyframe) => ({ ...keyframe })));
        existingEntry.keyframes = dedupeKeyframesPreservingConflicts(existingEntry.keyframes);
      }
    }
  }

  return [...byName.values()];
}
