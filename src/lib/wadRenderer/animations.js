export function interpolateKeyframes(keyframes, frame) {
  if (keyframes.length === 0) {
    return 0;
  }

  if (keyframes.length === 1) {
    return keyframes[0].value;
  }

  if (frame <= keyframes[0].frame) {
    return keyframes[0].value;
  }

  if (frame >= keyframes[keyframes.length - 1].frame) {
    return keyframes[keyframes.length - 1].value;
  }

  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const left = keyframes[i];
    const right = keyframes[i + 1];

    if (frame < left.frame || frame > right.frame) {
      continue;
    }

    const span = right.frame - left.frame;
    if (Math.abs(span) < 1e-6) {
      return right.value;
    }

    const t = (frame - left.frame) / span;
    const t2 = t * t;
    const t3 = t2 * t;
    const leftTangent = left.blend * span;
    const rightTangent = right.blend * span;

    return (
      (2 * t3 - 3 * t2 + 1) * left.value +
      (t3 - 2 * t2 + t) * leftTangent +
      (-2 * t3 + 3 * t2) * right.value +
      (t3 - t2) * rightTangent
    );
  }

  return keyframes[keyframes.length - 1].value;
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
          entries: tag.entries.map((entry) => ({
            type: entry.type,
            dataType: entry.dataType,
            typeName: entry.typeName,
            keyframes: entry.keyframes.map((keyframe) => ({ ...keyframe })),
          })),
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

      const entryMap = new Map(targetTag.entries.map((entry) => [entry.type, entry]));
      for (const entry of tag.entries) {
        const existingEntry = entryMap.get(entry.type);
        if (!existingEntry) {
          targetTag.entries.push({
            type: entry.type,
            dataType: entry.dataType,
            typeName: entry.typeName,
            keyframes: entry.keyframes.map((keyframe) => ({ ...keyframe })),
          });
          entryMap.set(entry.type, targetTag.entries[targetTag.entries.length - 1]);
          continue;
        }

        existingEntry.keyframes.push(...entry.keyframes.map((keyframe) => ({ ...keyframe })));
        existingEntry.keyframes.sort((left, right) => left.frame - right.frame);

        const deduped = [];
        for (const keyframe of existingEntry.keyframes) {
          const prev = deduped[deduped.length - 1];
          if (prev && Math.abs(prev.frame - keyframe.frame) < 1e-6) {
            deduped[deduped.length - 1] = keyframe;
          } else {
            deduped.push(keyframe);
          }
        }
        existingEntry.keyframes = deduped;
      }
    }
  }

  return [...byName.values()];
}
