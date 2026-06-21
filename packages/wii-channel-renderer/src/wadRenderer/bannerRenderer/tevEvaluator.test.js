import { describe, expect, it } from "vitest";
import { evaluateTevPipeline, evaluateTevStagesForPixel, getDefaultTevStages } from "./tevEvaluator.js";

const rasColor = { r: 1, g: 1, b: 1, a: 1 };

const shopLogoMaterial = {
  color1: [0, 0, 0, 0],
  color2: [255, 255, 255, 0],
  color3: [255, 255, 255, 255],
  tevColors: [
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
  ],
  tevStages: [{
    aC: 2, bC: 4, cC: 8, dC: 15,
    tevBiasC: 0, tevScaleC: 0, tevOpC: 0, tevRegIdC: 0, clampC: 0,
    aA: 4, bA: 6, cA: 5, dA: 7,
    tevBiasA: 3, tevScaleA: 3, tevOpA: 0, tevRegIdA: 0, clampA: 0,
    texMap: 0, colorChan: 4,
    kColorSelC: 19, kAlphaSelA: 0,
    texSel: 0, rasSel: 0,
  }],
  alphaCompare: { condition0: 7, condition1: 7, operation: 0, value0: 0, value1: 0 },
};

const bgMaterial = {
  color1: [0, 0, 0, 0],
  color2: [255, 255, 255, 255],
  color3: [255, 255, 255, 255],
  tevColors: [
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 0, g: 0, b: 0, a: 255 },
  ],
  tevStages: [
    { aC: 8, bC: 14, cC: 12, dC: 15, tevBiasC: 3, tevScaleC: 2, tevOpC: 0, tevRegIdC: 2, clampC: 0, aA: 1, bA: 2, cA: 4, dA: 7, tevBiasA: 0, tevScaleA: 0, tevOpA: 0, tevRegIdA: 0, clampA: 0, texMap: 1, colorChan: 255, kColorSelC: 15, kAlphaSelA: 31, texSel: 0, rasSel: 0 },
    { aC: 14, bC: 8, cC: 4, dC: 15, tevBiasC: 0, tevScaleC: 0, tevOpC: 0, tevRegIdC: 3, clampC: 1, aA: 0, bA: 7, cA: 7, dA: 7, tevBiasA: 0, tevScaleA: 0, tevOpA: 0, tevRegIdA: 0, clampA: 1, texMap: 1, colorChan: 255, kColorSelC: 15, kAlphaSelA: 28, texSel: 0, rasSel: 0 },
    { aC: 8, bC: 14, cC: 4, dC: 15, tevBiasC: 0, tevScaleC: 0, tevOpC: 0, tevRegIdC: 2, clampC: 1, aA: 0, bA: 7, cA: 7, dA: 7, tevBiasA: 0, tevScaleA: 0, tevOpA: 0, tevRegIdA: 0, clampA: 1, texMap: 1, colorChan: 255, kColorSelC: 15, kAlphaSelA: 28, texSel: 0, rasSel: 0 },
    { aC: 12, bC: 15, cC: 6, dC: 4, tevBiasC: 0, tevScaleC: 0, tevOpC: 0, tevRegIdC: 2, clampC: 1, aA: 0, bA: 7, cA: 7, dA: 7, tevBiasA: 0, tevScaleA: 0, tevOpA: 0, tevRegIdA: 0, clampA: 1, texMap: 255, colorChan: 255, kColorSelC: 12, kAlphaSelA: 28, texSel: 0, rasSel: 0 },
    { aC: 15, bC: 4, cC: 4, dC: 15, tevBiasC: 0, tevScaleC: 0, tevOpC: 6, tevRegIdC: 2, clampC: 1, aA: 0, bA: 7, cA: 7, dA: 7, tevBiasA: 0, tevScaleA: 0, tevOpA: 0, tevRegIdA: 0, clampA: 1, texMap: 255, colorChan: 255, kColorSelC: 12, kAlphaSelA: 28, texSel: 0, rasSel: 0 },
    { aC: 14, bC: 8, cC: 4, dC: 15, tevBiasC: 0, tevScaleC: 0, tevOpC: 0, tevRegIdC: 0, clampC: 1, aA: 0, bA: 7, cA: 7, dA: 7, tevBiasA: 0, tevScaleA: 0, tevOpA: 0, tevRegIdA: 0, clampA: 1, texMap: 0, colorChan: 255, kColorSelC: 14, kAlphaSelA: 28, texSel: 0, rasSel: 0 },
  ],
  alphaCompare: { condition0: 7, condition1: 7, operation: 0, value0: 0, value1: 0 },
};

function rgbaBytes(color) {
  return {
    r: Math.round(color.r * 255),
    g: Math.round(color.g * 255),
    b: Math.round(color.b * 255),
    a: Math.round(color.a * 255),
  };
}

describe("TEV evaluator", () => {
  it("preserves shop logo texture color and evaluator alpha behavior", () => {
    expect(rgbaBytes(evaluateTevStagesForPixel(
      shopLogoMaterial.tevStages,
      [{ r: 200 / 255, g: 100 / 255, b: 50 / 255, a: 1 }],
      rasColor,
      shopLogoMaterial,
      shopLogoMaterial.tevColors,
      null,
    ))).toEqual({ r: 200, g: 100, b: 50, a: 128 });

    expect(rgbaBytes(evaluateTevStagesForPixel(
      shopLogoMaterial.tevStages,
      [{ r: 0, g: 0, b: 0, a: 0 }],
      rasColor,
      shopLogoMaterial,
      shopLogoMaterial.tevColors,
      null,
    ))).toEqual({ r: 0, g: 0, b: 0, a: 128 });
  });

  it("keeps Wii Shop background color output non-zero", () => {
    const result = evaluateTevStagesForPixel(
      bgMaterial.tevStages,
      [{ r: 0.3, g: 0.5, b: 0.8, a: 1 }, { r: 0.6, g: 0.6, b: 0.6, a: 1 }],
      rasColor,
      bgMaterial,
      bgMaterial.tevColors,
      null,
    );

    expect(rgbaBytes(result)).toEqual({ r: 77, g: 128, b: 204, a: 255 });
  });

  it("applies the NW4R 0-stage default (lerp C0->C1 by texture) including a non-zero C0", () => {
    // A 0-stage material's default combiner is lerp(C0, C1, texture) * vertexColor.
    // The old Canvas-2D heuristic only multiplied by C1, which drops the C0
    // ("black"/fore color) tint on dark texels. With a non-zero C0 the default
    // must blend dark texels toward C0 and light texels toward C1.
    const material = {
      color1: [255, 0, 0, 255],   // C0 ("black" color register) = red
      color2: [0, 0, 255, 255],   // C1 ("white" color register) = blue
      color3: [255, 255, 255, 255],
      tevColors: [],
    };
    const texture = {
      data: new Uint8ClampedArray([
        0, 0, 0, 255,            // black texel -> should resolve to C0 (red)
        255, 255, 255, 255,      // white texel -> should resolve to C1 (blue)
      ]),
      width: 2,
      height: 1,
    };
    const ras = {
      data: new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]),
      width: 2,
      height: 1,
    };

    const result = evaluateTevPipeline(getDefaultTevStages(), material, [texture], ras, 2, 1);

    expect([...result.data]).toEqual([
      255, 0, 0, 255,   // C0
      0, 0, 255, 255,   // C1
    ]);
  });

  it("evaluates full pixel buffers", () => {
    const texture = {
      data: new Uint8ClampedArray([
        200, 100, 50, 255,
        0, 0, 0, 0,
        150, 80, 30, 255,
        0, 0, 0, 0,
      ]),
      width: 2,
      height: 2,
    };
    const ras = {
      data: new Uint8ClampedArray([
        255, 255, 255, 255,
        255, 255, 255, 255,
        255, 255, 255, 255,
        255, 255, 255, 255,
      ]),
      width: 2,
      height: 2,
    };

    const result = evaluateTevPipeline(shopLogoMaterial.tevStages, shopLogoMaterial, [texture], ras, 2, 2);

    expect([...result.data]).toEqual([
      200, 100, 50, 128,
      0, 0, 0, 128,
      150, 80, 30, 128,
      0, 0, 0, 128,
    ]);
  });
});
