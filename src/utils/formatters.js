export function createArrayLogger(storage) {
  return {
    clear() {
      storage.length = 0;
    },
    info(message) {
      storage.push({ level: "info", message });
    },
    warn(message) {
      storage.push({ level: "warn", message });
    },
    error(message) {
      storage.push({ level: "error", message });
    },
    success(message) {
      storage.push({ level: "success", message });
    },
  };
}

export function formatLayoutInfo(layout) {
  if (!layout) {
    return "No layout data parsed yet.";
  }

  const lines = [];
  lines.push(`Layout size: ${layout.width}x${layout.height}`);
  lines.push(`Textures: ${layout.textures.join(", ") || "none"}`);
  lines.push(`Materials: ${layout.materials.map((material) => material.name).join(", ") || "none"}`);
  lines.push("");

  for (const pane of layout.panes) {
    const parts = [
      `[${pane.type}] ${pane.name}`,
      `pos(${pane.translate.x.toFixed(1)}, ${pane.translate.y.toFixed(1)})`,
      `scale(${pane.scale.x.toFixed(2)}, ${pane.scale.y.toFixed(2)})`,
      `size(${pane.size.w.toFixed(0)}x${pane.size.h.toFixed(0)})`,
    ];

    if (pane.materialIndex >= 0) {
      parts.push(`mat=${pane.materialIndex}`);
    }

    lines.push(parts.join(" "));
  }

  return lines.join("\n");
}

export function formatAnimationInfo(animation) {
  if (!animation) {
    return "No animation data parsed yet.";
  }

  const lines = [`Frame count: ${animation.frameSize}`, ""];

  for (const pane of animation.panes) {
    lines.push(`Pane: ${pane.name}`);
    for (const tag of pane.tags) {
      lines.push(`  Tag: ${tag.type}`);
      for (const entry of tag.entries) {
        const values = entry.keyframes
          .map((keyframe) => `f${keyframe.frame.toFixed(0)}->${keyframe.value.toFixed(2)}`)
          .join(", ");
        lines.push(`    ${entry.typeName}: ${values}`);
      }
    }
  }

  return lines.join("\n");
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0.00s";
  }
  return `${seconds.toFixed(2)}s`;
}

export function formatByteSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const size = bytes / 1024 ** unitIndex;
  const precision = unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatRecentTimestamp(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "Unknown time";
  }
  return new Date(timestamp).toLocaleString();
}
