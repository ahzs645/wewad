import { describe, expect, it } from "vitest";
import {
  multiply,
  translation,
  linear,
  applyPoint,
  buildChainAffine,
  buildQuadVertices,
  resolveChainAlphaVisibility,
} from "./paneGeometry.js";

describe("paneGeometry", () => {
  it("post-multiplies like a 2D canvas matrix (translate then scale)", () => {
    // ctx.translate(10,20) then ctx.scale(2,3): point (1,1) -> (12, 23)
    const m = multiply(translation(10, 20), linear(2, 0, 0, 3));
    const p = applyPoint(m, 1, 1);
    expect(p).toEqual({ x: 12, y: 23 });
  });

  it("builds the chain affine with layout centering, tx/-ty, and identity projection", () => {
    const states = [{ tx: 10, ty: 20 }];
    const m = buildChainAffine(states, () => ({ a: 1, b: 0, c: 0, d: 1 }), 608, 456, { x: 0, y: 0 });
    // T(304,228) * T(10,-20) = T(314,208)
    expect(m).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 314, f: 208 });
  });

  it("folds the origin offset in last", () => {
    const m = buildChainAffine([{ tx: 0, ty: 0 }], () => ({ a: 1, b: 0, c: 0, d: 1 }), 0, 0, { x: 5, y: -7 });
    expect(applyPoint(m, 0, 0)).toEqual({ x: 5, y: -7 });
  });

  it("converts quad corners to clip space (identity base scale)", () => {
    const affine = translation(314, 208); // pane centered at (314,208)
    const verts = buildQuadVertices(affine, 100, 50, 1, 1, 608, 456);
    // 4 corners (TL, TR, BL, BR), interleaved [x, y, u, v]
    const tl = { x: verts[0], y: verts[1], u: verts[2], v: verts[3] };
    const br = { x: verts[12], y: verts[13], u: verts[14], v: verts[15] };
    // TL local (-50,-25) -> device (264,183) -> clip
    expect(tl.x).toBeCloseTo((2 * 264) / 608 - 1, 6);
    expect(tl.y).toBeCloseTo(1 - (2 * 183) / 456, 6);
    expect(tl.u).toBe(0);
    expect(tl.v).toBe(0);
    // BR local (50,25) -> device (364,233)
    expect(br.x).toBeCloseTo((2 * 364) / 608 - 1, 6);
    expect(br.y).toBeCloseTo(1 - (2 * 233) / 456, 6);
    expect(br.u).toBe(1);
    expect(br.v).toBe(1);
  });

  it("flips UVs for negative width/height", () => {
    const verts = buildQuadVertices(translation(0, 0), -10, -10, 1, 1, 100, 100);
    // TL corner UV becomes (1,1) when both axes flip
    expect(verts[2]).toBe(1);
    expect(verts[3]).toBe(1);
  });

  it("accumulates pane alpha down the chain (influenced multiplies, else resets)", () => {
    const chain = [
      { name: "A", state: { alpha: 0.5, influencedByParentAlpha: false, propagatesVisibility: true, visible: true } },
      { name: "B", state: { alpha: 0.5, influencedByParentAlpha: true, visible: true } },
      { name: "T", state: { alpha: 0.8, influencedByParentAlpha: true, visible: true } },
    ];
    const target = chain[2];
    const { alpha, visible } = resolveChainAlphaVisibility(chain, (p) => p.state, target);
    expect(alpha).toBeCloseTo(0.2, 6); // 0.5 * 0.5 * 0.8
    expect(visible).toBe(true);
  });

  it("hides a pane when a propagating ancestor is invisible", () => {
    const chain = [
      { name: "A", state: { alpha: 1, influencedByParentAlpha: true, propagatesVisibility: true, visible: false } },
      { name: "T", state: { alpha: 1, influencedByParentAlpha: true, visible: true } },
    ];
    const { visible } = resolveChainAlphaVisibility(chain, (p) => p.state, chain[1]);
    expect(visible).toBe(false);
  });
});
