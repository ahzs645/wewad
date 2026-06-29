import { describe, expect, it } from "vitest";
import { isTevAlphaAlwaysZero, isTevColorDirectTexture, shouldUseTevPipeline } from "./tevMethods.js";

// Color selectors: TEXC=8, RASC=10, ZERO=15. Alpha selectors: RASA=5, ZERO=7.
const IDENTITY_COLOR = { aC: 15, bC: 15, cC: 15, dC: 8 };
const MODULATE_COLOR = { aC: 15, bC: 8, cC: 10, dC: 15 };
// Wii Shop P_ShopLogo material: color = lerp(C0, C1, TEXC); alpha = compare(TEXA,KONST)?RASA:0.
const SHOPLOGO_COLOR = { aC: 2, bC: 4, cC: 8, dC: 15 };
const SHOPLOGO_ALPHA = { aA: 4, bA: 6, cA: 5, dA: 7, tevOpA: 15 };

const stage = (extra) => [{ aC: 15, bC: 15, cC: 15, dC: 8, aA: 7, bA: 7, cA: 7, dA: 7, tevOpA: 0, ...extra }];

describe("isTevColorDirectTexture", () => {
  it("recognizes identity passthrough and modulate color combiners", () => {
    expect(isTevColorDirectTexture(stage(IDENTITY_COLOR))).toBe(true);
    expect(isTevColorDirectTexture(stage(MODULATE_COLOR))).toBe(true);
  });
  it("rejects register-lerp color combiners (Wii Shop bags logo)", () => {
    expect(isTevColorDirectTexture(stage(SHOPLOGO_COLOR))).toBe(false);
  });
  it("rejects multi-stage materials", () => {
    expect(isTevColorDirectTexture([stage(IDENTITY_COLOR)[0], stage(IDENTITY_COLOR)[0]])).toBe(false);
  });
});

describe("isTevAlphaAlwaysZero", () => {
  it("matches the Wii Shop compare-mode alpha pattern (op>=8, d=ZERO, c=RASA)", () => {
    expect(isTevAlphaAlwaysZero(stage(SHOPLOGO_ALPHA))).toBe(true);
  });
  it("does not match a plain additive alpha combine", () => {
    expect(isTevAlphaAlwaysZero(stage({ tevOpA: 0, dA: 7, cA: 5 }))).toBe(false);
  });
});

describe("shouldUseTevPipeline (fast mode shortcut)", () => {
  const fakeRenderer = (material) => ({
    tevQuality: "fast",
    strictTevEvaluation: false,
    layout: { materials: [material] },
  });
  const alwaysPassAlphaCompare = { condition0: 7, condition1: 7, operation: 0, value0: 0, value1: 0 };

  it("routes the Wii Shop bags material (register-lerp color + trivial alpha) through the TEV pipeline", () => {
    const material = {
      textureMaps: [{ textureIndex: 0 }],
      alphaCompare: alwaysPassAlphaCompare,
      tevStages: stage({ ...SHOPLOGO_COLOR, ...SHOPLOGO_ALPHA }),
    };
    // Before the fix this returned false (heuristic path → white silhouette).
    expect(shouldUseTevPipeline.call(fakeRenderer(material), { materialIndex: 0 })).toBe(true);
  });

  it("still skips the TEV pipeline for a true direct-texture material with trivial alpha", () => {
    const material = {
      textureMaps: [{ textureIndex: 0 }],
      alphaCompare: alwaysPassAlphaCompare,
      tevStages: stage({ ...IDENTITY_COLOR, ...SHOPLOGO_ALPHA }),
    };
    expect(shouldUseTevPipeline.call(fakeRenderer(material), { materialIndex: 0 })).toBe(false);
  });
});
