// Pure geometry helpers for the WebGL banner backend.
// Replicates the exact 2D affine the Canvas-2D renderer builds in
// paneDrawMethods.js (renderFrame base transform + drawPaneWithResolvedState),
// so the WebGL backend places panes pixel-identically. Kept dependency-free so
// it can be unit-tested headlessly against a 2D canvas's getTransform().

// Affine as { a, b, c, d, e, f }: point (x,y) -> (a*x + c*y + e, b*x + d*y + f).
// Matches the CanvasRenderingContext2D / DOMMatrix 2D convention.
export const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

// Post-multiply m by op (m * op), matching ctx.transform()/translate() semantics.
export function multiply(m, op) {
  return {
    a: m.a * op.a + m.c * op.b,
    b: m.b * op.a + m.d * op.b,
    c: m.a * op.c + m.c * op.d,
    d: m.b * op.c + m.d * op.d,
    e: m.a * op.e + m.c * op.f + m.e,
    f: m.b * op.e + m.d * op.f + m.f,
  };
}

export function translation(x, y) {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function linear(a, b, c, d) {
  return { a, b, c, d, e: 0, f: 0 };
}

export function applyPoint(m, x, y) {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/**
 * Build the pre-base chain affine for a pane, identical to the sequence in
 * drawPaneWithResolvedState():
 *   T(layoutW/2, layoutH/2) · Π[ T(tx, -ty) · L(projected) ] · T(origin)
 *
 * @param {object[]} chainStates  resolved local states, root->pane order
 * @param {(state:object)=>{a,b,c,d}} getProjected  per-state 2x2 (rot/scale/perspective)
 * @param {number} layoutWidth
 * @param {number} layoutHeight
 * @param {{x:number,y:number}} originOffset
 */
export function buildChainAffine(chainStates, getProjected, layoutWidth, layoutHeight, originOffset) {
  let m = multiply(IDENTITY, translation(layoutWidth / 2, layoutHeight / 2));
  for (const state of chainStates) {
    m = multiply(m, translation(state.tx, -state.ty));
    const p = getProjected(state);
    m = multiply(m, linear(p.a, p.b, p.c, p.d));
  }
  if (originOffset && (originOffset.x !== 0 || originOffset.y !== 0)) {
    m = multiply(m, translation(originOffset.x, originOffset.y));
  }
  return m;
}

/**
 * Accumulate pane alpha and visibility down the transform chain, matching
 * drawPaneWithResolvedState(): influenced-by-parent-alpha multiplies, otherwise
 * resets; a non-visible ancestor that propagates visibility hides the pane.
 *
 * @param {object[]} chainPanes  pane objects, root->pane order
 * @param {(pane:object)=>object|null} getState  resolves a pane's local state
 * @param {object} targetPane  the pane being drawn (excluded from the visibility test)
 * @returns {{alpha:number, visible:boolean}}
 */
export function resolveChainAlphaVisibility(chainPanes, getState, targetPane) {
  let alpha = 1;
  let visible = true;
  for (const chainPane of chainPanes) {
    const state = getState(chainPane);
    if (!state) {
      continue;
    }
    if (chainPane !== targetPane && state.propagatesVisibility && state.visible === false) {
      visible = false;
    }
    if (state.influencedByParentAlpha) {
      alpha *= state.alpha;
    } else {
      alpha = state.alpha;
    }
  }
  return { alpha, visible };
}

/**
 * Convert the 4 pane-local quad corners to clip-space, applying the chain affine,
 * the renderFrame base scale (dpr * displayScaleX, dpr), and the viewport->clip
 * transform. Returns interleaved [x,y,u,v] * 4 (two triangles drawn as a strip:
 * TL, TR, BL, BR). UVs flip when width/height are negative to mirror Canvas
 * drawImage with negative extents.
 */
export function buildQuadVertices(chainAffine, width, height, baseScaleX, baseScaleY, pixelWidth, pixelHeight) {
  const halfW = Math.abs(width) / 2;
  const halfH = Math.abs(height) / 2;
  const flipU = width < 0;
  const flipV = height < 0;

  // local corners (TL, TR, BL, BR) of a quad centered at origin
  const corners = [
    { lx: -halfW, ly: -halfH, u: flipU ? 1 : 0, v: flipV ? 1 : 0 },
    { lx: halfW, ly: -halfH, u: flipU ? 0 : 1, v: flipV ? 1 : 0 },
    { lx: -halfW, ly: halfH, u: flipU ? 1 : 0, v: flipV ? 0 : 1 },
    { lx: halfW, ly: halfH, u: flipU ? 0 : 1, v: flipV ? 0 : 1 },
  ];

  const out = new Float32Array(16);
  for (let i = 0; i < 4; i += 1) {
    const c = corners[i];
    const p = applyPoint(chainAffine, c.lx, c.ly);
    const deviceX = baseScaleX * p.x;
    const deviceY = baseScaleY * p.y;
    const clipX = (2 * deviceX) / pixelWidth - 1;
    const clipY = 1 - (2 * deviceY) / pixelHeight;
    out[i * 4 + 0] = clipX;
    out[i * 4 + 1] = clipY;
    out[i * 4 + 2] = c.u;
    out[i * 4 + 3] = c.v;
  }
  return out;
}
