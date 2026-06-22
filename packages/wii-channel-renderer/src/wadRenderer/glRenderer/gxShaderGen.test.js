import { describe, expect, it } from "vitest";
import {
  generateBasicGxShaderSources,
  generateTevShaderSources,
  getBasicGxMaterialKey,
  getBasicGxMaterialSignature,
  getTevMaterialKey,
  getTevMaterialSignature,
} from "./gxShaderGen.js";

describe("gxShaderGen", () => {
  it("builds stable keys for basic generated material signatures", () => {
    expect(getBasicGxMaterialKey(getBasicGxMaterialSignature({ hasTexture: true })))
      .toBe("basic-gx-v1|tex|vtx|mat");
    expect(getBasicGxMaterialKey(getBasicGxMaterialSignature({ hasTexture: false, usesMaterialColor: false })))
      .toBe("basic-gx-v1|notex|vtx|nomat");
  });

  it("generates textured and untextured fragment sources", () => {
    const textured = generateBasicGxShaderSources(getBasicGxMaterialSignature({ hasTexture: true }));
    const untextured = generateBasicGxShaderSources(getBasicGxMaterialSignature({ hasTexture: false }));

    expect(textured.fragment).toContain("texture2D(uTex, vUV)");
    expect(untextured.fragment).toContain("vec4(1.0)");
    expect(textured.fragment).toContain("uMaterialColor");
    expect(textured.vertex).toContain("attribute vec4 aColor");
  });

  it("generates TEV shader sources for explicit stages", () => {
    const signature = getTevMaterialSignature({
      color1: [0, 0, 0, 0],
      color2: [255, 255, 255, 255],
      color3: [128, 128, 128, 255],
      alphaCompare: { condition0: 7, condition1: 7, operation: 0, value0: 0, value1: 0 },
      tevStages: [
        {
          texMap: 0, colorChan: 255, aC: 15, bC: 8, cC: 12, dC: 15,
          tevOpC: 0, tevBiasC: 0, tevScaleC: 0, clampC: 1, tevRegIdC: 3,
          kColorSelC: 31, aA: 1, bA: 2, cA: 4, dA: 7, tevOpA: 0,
          tevBiasA: 0, tevScaleA: 0, clampA: 1, tevRegIdA: 0, kAlphaSelA: 31,
        },
        {
          texMap: 1, colorChan: 4, aC: 6, bC: 8, cC: 14, dC: 15,
          tevOpC: 0, tevBiasC: 0, tevScaleC: 0, clampC: 1, tevRegIdC: 0,
          kColorSelC: 28, aA: 7, bA: 0, cA: 5, dA: 7, tevOpA: 0,
          tevBiasA: 0, tevScaleA: 0, clampA: 1, tevRegIdA: 0, kAlphaSelA: 28,
        },
      ],
    });
    const sources = generateTevShaderSources(signature);

    expect(getTevMaterialKey(signature)).toContain('"kind":"tev-v1"');
    expect(sources.vertex).toContain("attribute vec2 aUV0");
    expect(sources.fragment).toContain("texture2D(uTex0, vUV0)");
    expect(sources.fragment).toContain("texture2D(uTex1, vUV1)");
    expect(sources.fragment).toContain("uniform vec4 uColorReg2");
    expect(sources.fragment).toContain("uniform vec4 uKColor3");
    expect(sources.fragment).toContain("discard");
    expect(sources.fragment).toContain("gl_FragColor");
  });

  it("generates TEV compare-mode expressions", () => {
    const signature = getTevMaterialSignature({
      tevStages: [{
        texMap: 0, colorChan: 4, aC: 8, bC: 14, cC: 12, dC: 15,
        tevOpC: 14, tevBiasC: 0, tevScaleC: 0, clampC: 1, tevRegIdC: 0,
        kColorSelC: 15, aA: 4, bA: 6, cA: 5, dA: 7, tevOpA: 15,
        tevBiasA: 0, tevScaleA: 0, clampA: 1, tevRegIdA: 0, kAlphaSelA: 0,
      }],
    });
    const sources = generateTevShaderSources(signature);

    expect(sources.fragment).toContain("floor((tex0.rgb) * 255.0 + vec3(0.5))");
    expect(sources.fragment).toContain("floor((tex0.a) * 255.0 + 0.5)");
    expect(sources.fragment).toContain("==");
  });
});
