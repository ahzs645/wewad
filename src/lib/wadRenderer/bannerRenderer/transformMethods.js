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

export function getProjectedTransform2D(renderer, state) {
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
