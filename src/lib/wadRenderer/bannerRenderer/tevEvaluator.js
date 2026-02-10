// GX TEV (Texture Environment) combiner evaluator.
// Pure functions — no DOM, no `this`. Operates on pixel buffers.

// TEV color input sources (4-bit, 0-15).
const CC_CPREV = 0;
const CC_APREV = 1;
const CC_C0 = 2;
const CC_A0 = 3;
const CC_C1 = 4;
const CC_A1 = 5;
const CC_C2 = 6;
const CC_A2 = 7;
const CC_TEXC = 8;
const CC_TEXA = 9;
const CC_RASC = 10;
const CC_RASA = 11;
const CC_ONE = 12;
const CC_HALF = 13;
const CC_KONST = 14;
const CC_ZERO = 15;

// TEV alpha input sources (4-bit, 0-7).
const CA_APREV = 0;
const CA_A0 = 1;
const CA_A1 = 2;
const CA_A2 = 3;
const CA_TEXA = 4;
const CA_RASA = 5;
const CA_KONST = 6;
const CA_ZERO = 7;

// TEV operation: 0=add, 1=sub (higher values are compare modes).
const TEV_ADD = 0;
const TEV_SUB = 1;

// Bias: 0=zero, 1=+0.5, 2=-0.5, 3=compare.
const BIAS_VALUES = [0, 0.5, -0.5, 0];

// Scale: 0=1, 1=2, 2=4, 3=0.5.
const SCALE_VALUES = [1, 2, 4, 0.5];

// KColor constant fractions for selectors 0-7.
const KCOLOR_FRACTIONS = [1, 7 / 8, 3 / 4, 5 / 8, 1 / 2, 3 / 8, 1 / 4, 1 / 8];

// Channel index mapping for swap tables: 0=R, 1=G, 2=B, 3=A.
function applySwapTable(color, swapEntry) {
  if (!swapEntry) {
    return color;
  }
  const channels = [color.r, color.g, color.b, color.a];
  return {
    r: channels[swapEntry.r] ?? color.r,
    g: channels[swapEntry.g] ?? color.g,
    b: channels[swapEntry.b] ?? color.b,
    a: channels[swapEntry.a] ?? color.a,
  };
}

// Resolve KColor color (RGB) from the KColor selector.
// Selectors 0-7 = fixed fraction applied to all channels.
// 12-15 = kColor0 R/G/B/A, 16-19 = kColor1 R/G/B/A, etc.
function resolveKColor(sel, kColors) {
  if (sel <= 7) {
    const f = KCOLOR_FRACTIONS[sel];
    return { r: f, g: f, b: f };
  }
  if (sel >= 12 && sel <= 27) {
    const kIdx = Math.floor((sel - 12) / 4);
    const chan = (sel - 12) % 4;
    const kc = kColors?.[kIdx];
    if (kc) {
      const val = [kc.r / 255, kc.g / 255, kc.b / 255, kc.a / 255][chan];
      return { r: val, g: val, b: val };
    }
  }
  return { r: 0, g: 0, b: 0 };
}

// Resolve KAlpha from the KAlpha selector.
// 0-7 = fixed fraction, 16-19 = kColor0..3 alpha, 20-23 = kColor0..3 R, etc.
function resolveKAlpha(sel, kColors) {
  if (sel <= 7) {
    return KCOLOR_FRACTIONS[sel];
  }
  if (sel >= 16 && sel <= 31) {
    const kIdx = Math.floor((sel - 16) / 4);
    const chan = (sel - 16) % 4;
    const kc = kColors?.[kIdx];
    if (kc) {
      return [kc.r / 255, kc.g / 255, kc.b / 255, kc.a / 255][chan];
    }
  }
  return 0;
}

// Resolve a TEV color input (4-bit selector) to {r, g, b} in [0,1].
function resolveColorInput(sel, state) {
  switch (sel) {
    case CC_CPREV: return { r: state.cprev.r, g: state.cprev.g, b: state.cprev.b };
    case CC_APREV: { const a = state.aprev; return { r: a, g: a, b: a }; }
    case CC_C0: return { r: state.c0.r, g: state.c0.g, b: state.c0.b };
    case CC_A0: { const a = state.a0; return { r: a, g: a, b: a }; }
    case CC_C1: return { r: state.c1.r, g: state.c1.g, b: state.c1.b };
    case CC_A1: { const a = state.a1; return { r: a, g: a, b: a }; }
    case CC_C2: return { r: state.c2.r, g: state.c2.g, b: state.c2.b };
    case CC_A2: { const a = state.a2; return { r: a, g: a, b: a }; }
    case CC_TEXC: return { r: state.texC.r, g: state.texC.g, b: state.texC.b };
    case CC_TEXA: { const a = state.texC.a; return { r: a, g: a, b: a }; }
    case CC_RASC: return { r: state.rasC.r, g: state.rasC.g, b: state.rasC.b };
    case CC_RASA: { const a = state.rasC.a; return { r: a, g: a, b: a }; }
    case CC_ONE: return { r: 1, g: 1, b: 1 };
    case CC_HALF: return { r: 0.5, g: 0.5, b: 0.5 };
    case CC_KONST: return state.konstC;
    case CC_ZERO:
    default: return { r: 0, g: 0, b: 0 };
  }
}

// Resolve a TEV alpha input (4-bit selector) to a float in [0,1].
function resolveAlphaInput(sel, state) {
  switch (sel) {
    case CA_APREV: return state.aprev;
    case CA_A0: return state.a0;
    case CA_A1: return state.a1;
    case CA_A2: return state.a2;
    case CA_TEXA: return state.texC.a;
    case CA_RASA: return state.rasC.a;
    case CA_KONST: return state.konstA;
    case CA_ZERO:
    default: return 0;
  }
}

// Core TEV combiner: output = (d OP ((1-c)*a + c*b) + bias) * scale.
function tevCombine(a, b, c, d, op, bias, scale, clamp) {
  const blend = (1 - c) * a + c * b;
  let result = op === TEV_SUB ? d - blend : d + blend;
  result = (result + bias) * scale;
  if (clamp) {
    return Math.max(0, Math.min(1, result));
  }
  return Math.max(-1024, Math.min(1023, result));
}

// Write combiner output to the appropriate register.
// regId: 0 = cprev/aprev, 1 = c0/a0 (but GX only uses 0-3 for output, mapped via tevRegId).
// In BRLYT, tevRegIdC/A is 1-bit: 0=PREV, 1=REG0. Some sources say 2-bit for 0-3.
function writeColorReg(state, regId, r, g, b) {
  switch (regId) {
    case 0: state.cprev.r = r; state.cprev.g = g; state.cprev.b = b; break;
    case 1: state.c0.r = r; state.c0.g = g; state.c0.b = b; break;
    case 2: state.c1.r = r; state.c1.g = g; state.c1.b = b; break;
    case 3: state.c2.r = r; state.c2.g = g; state.c2.b = b; break;
    default: state.cprev.r = r; state.cprev.g = g; state.cprev.b = b; break;
  }
}

function writeAlphaReg(state, regId, a) {
  switch (regId) {
    case 0: state.aprev = a; break;
    case 1: state.a0 = a; break;
    case 2: state.a1 = a; break;
    case 3: state.a2 = a; break;
    default: state.aprev = a; break;
  }
}

// Initialize TEV registers from material color data.
// color1 = forecolor → c0, color2 = backcolor → c1, color3 → c2.
// tevColors[0..3] correspond to CPREV/C0/C1/C2.
function initTevRegisters(material) {
  const toFloat = (c) => (c ?? 0) / 255;

  // Default: all zeros.
  const state = {
    cprev: { r: 0, g: 0, b: 0 }, aprev: 0,
    c0: { r: 0, g: 0, b: 0 }, a0: 0,
    c1: { r: 0, g: 0, b: 0 }, a1: 0,
    c2: { r: 0, g: 0, b: 0 }, a2: 0,
  };

  // tevColors array from BRLYT: indices 0=cprev, 1=c0, 2=c1, 3=c2.
  // These are s16 color registers stored as {r,g,b,a} with values 0-255 in parsed data.
  const tc = material?.tevColors;
  if (tc) {
    if (tc[0]) { state.cprev = { r: toFloat(tc[0].r), g: toFloat(tc[0].g), b: toFloat(tc[0].b) }; state.aprev = toFloat(tc[0].a); }
    if (tc[1]) { state.c0 = { r: toFloat(tc[1].r), g: toFloat(tc[1].g), b: toFloat(tc[1].b) }; state.a0 = toFloat(tc[1].a); }
    if (tc[2]) { state.c1 = { r: toFloat(tc[2].r), g: toFloat(tc[2].g), b: toFloat(tc[2].b) }; state.a1 = toFloat(tc[2].a); }
    if (tc[3]) { state.c2 = { r: toFloat(tc[3].r), g: toFloat(tc[3].g), b: toFloat(tc[3].b) }; state.a2 = toFloat(tc[3].a); }
  }

  // Also initialize from named material colors if tevColors is sparse.
  if (!tc?.[1] && material?.color1) {
    state.c0 = { r: toFloat(material.color1.r), g: toFloat(material.color1.g), b: toFloat(material.color1.b) };
    state.a0 = toFloat(material.color1.a);
  }
  if (!tc?.[2] && material?.color2) {
    state.c1 = { r: toFloat(material.color2.r), g: toFloat(material.color2.g), b: toFloat(material.color2.b) };
    state.a1 = toFloat(material.color2.a);
  }
  if (!tc?.[3] && material?.color3) {
    state.c2 = { r: toFloat(material.color3.r), g: toFloat(material.color3.g), b: toFloat(material.color3.b) };
    state.a2 = toFloat(material.color3.a);
  }

  return state;
}

// Evaluate all TEV stages for a single pixel.
export function evaluateTevStagesForPixel(stages, texSamples, rasColor, material, kColors, swapTable) {
  const state = initTevRegisters(material);

  for (let i = 0; i < stages.length; i += 1) {
    const stage = stages[i];

    // Resolve texture input with swap table.
    const texMapIdx = stage.texMap;
    const rawTex = (texMapIdx !== 0xff && texMapIdx < texSamples.length)
      ? texSamples[texMapIdx]
      : { r: 0, g: 0, b: 0, a: 0 };
    const texSwapEntry = swapTable?.[stage.texSel] ?? null;
    state.texC = texSwapEntry ? applySwapTable(rawTex, texSwapEntry) : rawTex;

    // Resolve rasterized color: respect colorChan (GX channel control per stage).
    // colorChan=4 → GX_COLOR_ZERO (no rasterized color input).
    // colorChan=0 → GX_COLOR0A0 (vertex/material color), 1 → GX_COLOR1A1.
    // colorChan=0xFF → GX_COLOR_NULL (defaults to vertex/material color in hardware).
    const stageRasColor = stage.colorChan === 4
      ? { r: 0, g: 0, b: 0, a: 0 }
      : rasColor;
    const rasSwapEntry = swapTable?.[stage.rasSel] ?? null;
    state.rasC = rasSwapEntry ? applySwapTable(stageRasColor, rasSwapEntry) : stageRasColor;

    // Resolve KColor/KAlpha for this stage.
    state.konstC = resolveKColor(stage.kColorSelC, kColors);
    state.konstA = resolveKAlpha(stage.kAlphaSelA, kColors);

    // Color combiner.
    const inAC = resolveColorInput(stage.aC, state);
    const inBC = resolveColorInput(stage.bC, state);
    const inCC = resolveColorInput(stage.cC, state);
    const inDC = resolveColorInput(stage.dC, state);
    const biasC = BIAS_VALUES[stage.tevBiasC];
    const scaleC = SCALE_VALUES[stage.tevScaleC];
    const doClampC = stage.clampC !== 0;
    const outR = tevCombine(inAC.r, inBC.r, inCC.r, inDC.r, stage.tevOpC, biasC, scaleC, doClampC);
    const outG = tevCombine(inAC.g, inBC.g, inCC.g, inDC.g, stage.tevOpC, biasC, scaleC, doClampC);
    const outB = tevCombine(inAC.b, inBC.b, inCC.b, inDC.b, stage.tevOpC, biasC, scaleC, doClampC);
    writeColorReg(state, stage.tevRegIdC, outR, outG, outB);

    // Alpha combiner.
    const inAA = resolveAlphaInput(stage.aA, state);
    const inBA = resolveAlphaInput(stage.bA, state);
    const inCA = resolveAlphaInput(stage.cA, state);
    const inDA = resolveAlphaInput(stage.dA, state);
    const biasA = BIAS_VALUES[stage.tevBiasA];
    const scaleA = SCALE_VALUES[stage.tevScaleA];
    const doClampA = stage.clampA !== 0;
    const outA = tevCombine(inAA, inBA, inCA, inDA, stage.tevOpA, biasA, scaleA, doClampA);
    writeAlphaReg(state, stage.tevRegIdA, outA);
  }

  // Final output is PREV register (cprev + aprev).
  return {
    r: Math.max(0, Math.min(1, state.cprev.r)),
    g: Math.max(0, Math.min(1, state.cprev.g)),
    b: Math.max(0, Math.min(1, state.cprev.b)),
    a: Math.max(0, Math.min(1, state.aprev)),
  };
}

// Generate the default 2-stage TEV configuration for materials with no explicit stages.
// Reference: wii-banner-player Material.cpp:204-239
// Stage 0: modulate texture × raster (tex * ras color, texA * rasA)
// Stage 1: previous × raster color (prev * ras, prevA * rasA)
export function getDefaultTevStages() {
  return [
    {
      // Stage 0: output = tex × ras
      texCoord: 0, colorChan: 0xff, texMap: 0, rasSel: 0, texSel: 0,
      aC: CC_C0,    bC: CC_C1,    cC: CC_TEXC,  dC: CC_ZERO,
      tevOpC: TEV_ADD, tevBiasC: 0, tevScaleC: 0, tevRegIdC: 0, clampC: 1,
      kColorSelC: 0,
      aA: CA_A0,    bA: CA_A1,    cA: CA_TEXA,  dA: CA_ZERO,
      tevOpA: TEV_ADD, tevBiasA: 0, tevScaleA: 0, tevRegIdA: 0, clampA: 1,
      kAlphaSelA: 0,
      indTexId: 0, indBias: 0, indMtxId: 0, indWrapS: 0, indWrapT: 0,
      indFormat: 0, indAddPrev: 0, indUtcLod: 0, indAlpha: 0,
    },
    {
      // Stage 1: output = prev × ras
      texCoord: 0, colorChan: 0xff, texMap: 0, rasSel: 0, texSel: 0,
      aC: CC_ZERO,  bC: CC_CPREV, cC: CC_RASC,  dC: CC_ZERO,
      tevOpC: TEV_ADD, tevBiasC: 0, tevScaleC: 0, tevRegIdC: 0, clampC: 1,
      kColorSelC: 0,
      aA: CA_ZERO,  bA: CA_APREV, cA: CA_RASA,  dA: CA_ZERO,
      tevOpA: TEV_ADD, tevBiasA: 0, tevScaleA: 0, tevRegIdA: 0, clampA: 1,
      kAlphaSelA: 0,
      indTexId: 0, indBias: 0, indMtxId: 0, indWrapS: 0, indWrapT: 0,
      indFormat: 0, indAddPrev: 0, indUtcLod: 0, indAlpha: 0,
    },
  ];
}

// Single modulate stage: output = texture × raster color.
// Used as fallback when material needs TEV processing (e.g. alpha compare)
// but has no explicit TEV stages defined.
export function getModulateTevStages() {
  return [{
    texCoord: 0, colorChan: 0xff, texMap: 0, rasSel: 0, texSel: 0,
    aC: CC_ZERO, bC: CC_TEXC, cC: CC_RASC, dC: CC_ZERO,
    tevOpC: TEV_ADD, tevBiasC: 0, tevScaleC: 0, tevRegIdC: 0, clampC: 1,
    kColorSelC: 0,
    aA: CA_ZERO, bA: CA_TEXA, cA: CA_RASA, dA: CA_ZERO,
    tevOpA: TEV_ADD, tevBiasA: 0, tevScaleA: 0, tevRegIdA: 0, clampA: 1,
    kAlphaSelA: 0,
    indTexId: 0, indBias: 0, indMtxId: 0, indWrapS: 0, indWrapT: 0,
    indFormat: 0, indAddPrev: 0, indUtcLod: 0, indAlpha: 0,
  }];
}

// Detect trivial identity passthrough: single stage that passes texture through unchanged.
// Pattern: aC=ZERO, bC=ZERO, cC=ZERO, dC=TEXC, opC=ADD, biasC=0, scaleC=1
//          aA=ZERO, bA=ZERO, cA=ZERO, dA=TEXA, opA=ADD, biasA=0, scaleA=1
export function isTevIdentityPassthrough(stages) {
  if (!stages || stages.length === 0) {
    return true;
  }
  if (stages.length !== 1) {
    return false;
  }
  const s = stages[0];
  return (
    s.aC === CC_ZERO && s.bC === CC_ZERO && s.cC === CC_ZERO && s.dC === CC_TEXC &&
    s.tevOpC === TEV_ADD && s.tevBiasC === 0 && s.tevScaleC === 0 &&
    s.aA === CA_ZERO && s.bA === CA_ZERO && s.cA === CA_ZERO && s.dA === CA_TEXA &&
    s.tevOpA === TEV_ADD && s.tevBiasA === 0 && s.tevScaleA === 0
  );
}

// Detect common "modulate" pattern: output = texColor * rasColor.
// Pattern: aC=ZERO, bC=TEXC, cC=RASC, dC=ZERO (or equivalent).
export function isTevModulatePattern(stages) {
  if (!stages || stages.length !== 1) {
    return false;
  }
  const s = stages[0];
  // Color: d + (1-c)*a + c*b = 0 + (1-ras)*0 + ras*tex = tex*ras
  const colorMod = (
    s.aC === CC_ZERO && s.bC === CC_TEXC && s.cC === CC_RASC && s.dC === CC_ZERO &&
    s.tevOpC === TEV_ADD && s.tevBiasC === 0 && s.tevScaleC === 0
  );
  // Alpha: tex * ras
  const alphaMod = (
    s.aA === CA_ZERO && s.bA === CA_TEXA && s.cA === CA_RASA && s.dA === CA_ZERO &&
    s.tevOpA === TEV_ADD && s.tevBiasA === 0 && s.tevScaleA === 0
  );
  return colorMod && alphaMod;
}

// Alpha compare conditions (GX AlphaOp).
// 0=NEVER, 1=LESS, 2=EQUAL, 3=LEQUAL, 4=GREATER, 5=NOTEQUAL, 6=GEQUAL, 7=ALWAYS
function alphaTestCondition(condition, value, ref) {
  switch (condition) {
    case 0: return false;                // NEVER
    case 1: return value < ref;          // LESS
    case 2: return value === ref;        // EQUAL
    case 3: return value <= ref;         // LEQUAL
    case 4: return value > ref;          // GREATER
    case 5: return value !== ref;        // NOTEQUAL
    case 6: return value >= ref;         // GEQUAL
    case 7: return true;                 // ALWAYS
    default: return true;
  }
}

// Evaluate alpha compare: returns true if pixel passes, false if it should be discarded.
// alphaCompare: { condition0, condition1, operation, value0, value1 }
// operation: 0=AND, 1=OR, 2=XOR, 3=XNOR
export function evaluateAlphaCompare(alphaCompare, alpha255) {
  if (!alphaCompare) {
    return true;
  }
  const pass0 = alphaTestCondition(alphaCompare.condition0, alpha255, alphaCompare.value0);
  const pass1 = alphaTestCondition(alphaCompare.condition1, alpha255, alphaCompare.value1);
  switch (alphaCompare.operation) {
    case 0: return pass0 && pass1;       // AND
    case 1: return pass0 || pass1;       // OR
    case 2: return pass0 !== pass1;      // XOR
    case 3: return pass0 === pass1;      // XNOR
    default: return pass0 && pass1;
  }
}

// Evaluate TEV pipeline for an entire pixel buffer.
// textureImageDatas: array indexed by texMap slot, each is { data, width, height } (ImageData-like).
// rasColorData: { data, width, height } (ImageData-like) with rasterized vertex colors.
// Returns an ImageData with the final composited pixels.
export function evaluateTevPipeline(stages, material, textureImageDatas, rasColorData, width, height) {
  const kColors = material?.tevColors ?? [];
  const swapTable = material?.tevSwapTable ?? null;
  const alphaCompare = material?.alphaCompare ?? null;
  const output = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIdx = (y * width + x) * 4;

      // Sample all texture inputs.
      const texSamples = [];
      for (let t = 0; t < textureImageDatas.length; t += 1) {
        const tex = textureImageDatas[t];
        if (!tex) {
          texSamples.push({ r: 0, g: 0, b: 0, a: 0 });
          continue;
        }
        // Nearest-neighbor sample (tex coordinates map 1:1 to output).
        const tx = Math.min(x, tex.width - 1);
        const ty = Math.min(y, tex.height - 1);
        const ti = (ty * tex.width + tx) * 4;
        texSamples.push({
          r: tex.data[ti] / 255,
          g: tex.data[ti + 1] / 255,
          b: tex.data[ti + 2] / 255,
          a: tex.data[ti + 3] / 255,
        });
      }

      // Sample rasterized color.
      let rasColor = { r: 1, g: 1, b: 1, a: 1 };
      if (rasColorData) {
        const rx = Math.min(x, rasColorData.width - 1);
        const ry = Math.min(y, rasColorData.height - 1);
        const ri = (ry * rasColorData.width + rx) * 4;
        rasColor = {
          r: rasColorData.data[ri] / 255,
          g: rasColorData.data[ri + 1] / 255,
          b: rasColorData.data[ri + 2] / 255,
          a: rasColorData.data[ri + 3] / 255,
        };
      }

      const result = evaluateTevStagesForPixel(stages, texSamples, rasColor, material, kColors, swapTable);
      const alpha255 = Math.round(result.a * 255);

      // Apply alpha compare (alpha test): discard pixel if it fails.
      if (alphaCompare && !evaluateAlphaCompare(alphaCompare, alpha255)) {
        // Pixel discarded — leave as transparent.
        continue;
      }

      output[pixelIdx] = Math.round(result.r * 255);
      output[pixelIdx + 1] = Math.round(result.g * 255);
      output[pixelIdx + 2] = Math.round(result.b * 255);
      output[pixelIdx + 3] = alpha255;
    }
  }

  return { data: output, width, height };
}
