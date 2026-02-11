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
// 12-15 = K0-K3 full RGB, 16-19 = K0-K3 R replicated,
// 20-23 = K0-K3 G replicated, 24-27 = K0-K3 B replicated.
function resolveKColor(sel, kColors) {
  if (sel <= 7) {
    const f = KCOLOR_FRACTIONS[sel];
    return { r: f, g: f, b: f };
  }
  if (sel >= 12 && sel <= 15) {
    const kc = kColors?.[sel - 12];
    if (kc) {
      return { r: kc.r / 255, g: kc.g / 255, b: kc.b / 255 };
    }
    return { r: 0, g: 0, b: 0 };
  }
  if (sel >= 16 && sel <= 27) {
    const kIdx = (sel - 16) % 4;
    const chanGroup = Math.floor((sel - 16) / 4); // 0=R, 1=G, 2=B
    const kc = kColors?.[kIdx];
    if (kc) {
      const val = [kc.r / 255, kc.g / 255, kc.b / 255][chanGroup] ?? 0;
      return { r: val, g: val, b: val };
    }
  }
  return { r: 0, g: 0, b: 0 };
}

// Resolve KAlpha from the KAlpha selector.
// 0-7 = fixed fraction, 16-19 = K0-K3 R, 20-23 = K0-K3 G,
// 24-27 = K0-K3 B, 28-31 = K0-K3 A.
function resolveKAlpha(sel, kColors) {
  if (sel <= 7) {
    return KCOLOR_FRACTIONS[sel];
  }
  if (sel >= 16 && sel <= 31) {
    const kIdx = (sel - 16) % 4;
    const chanGroup = Math.floor((sel - 16) / 4); // 0=R, 1=G, 2=B, 3=A
    const kc = kColors?.[kIdx];
    if (kc) {
      return [kc.r / 255, kc.g / 255, kc.b / 255, kc.a / 255][chanGroup] ?? 0;
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

// TEV compare mode for color combiner (bias=3).
// Switches to: D + (compare(A,B) ? C : 0).
// tevOp: 0=GT, 1=EQ. scale selects comparison granularity:
//   0=R8 (R channel only), 1=GR16 (packed), 2=BGR24 (packed), 3=RGB8 (per-component).
function tevCompareColor(inA, inB, inC, inD, op, scale, clamp) {
  const useEq = op === TEV_SUB;
  const i = (v) => Math.round(v * 255);

  let condR, condG, condB;
  switch (scale) {
    case 0: { // COMP_R8: compare R only, scalar result
      const cond = useEq ? (i(inA.r) === i(inB.r)) : (i(inA.r) > i(inB.r));
      condR = condG = condB = cond;
      break;
    }
    case 1: { // COMP_GR16: compare packed G*256+R
      const vA = i(inA.g) * 256 + i(inA.r);
      const vB = i(inB.g) * 256 + i(inB.r);
      const cond = useEq ? (vA === vB) : (vA > vB);
      condR = condG = condB = cond;
      break;
    }
    case 2: { // COMP_BGR24: compare packed B*65536+G*256+R
      const vA = i(inA.b) * 65536 + i(inA.g) * 256 + i(inA.r);
      const vB = i(inB.b) * 65536 + i(inB.g) * 256 + i(inB.r);
      const cond = useEq ? (vA === vB) : (vA > vB);
      condR = condG = condB = cond;
      break;
    }
    case 3: { // COMP_RGB8: per-component comparison
      condR = useEq ? (i(inA.r) === i(inB.r)) : (i(inA.r) > i(inB.r));
      condG = useEq ? (i(inA.g) === i(inB.g)) : (i(inA.g) > i(inB.g));
      condB = useEq ? (i(inA.b) === i(inB.b)) : (i(inA.b) > i(inB.b));
      break;
    }
    default:
      condR = condG = condB = false;
  }

  let r = inD.r + (condR ? inC.r : 0);
  let g = inD.g + (condG ? inC.g : 0);
  let b = inD.b + (condB ? inC.b : 0);
  if (clamp) {
    return { r: Math.max(0, Math.min(1, r)), g: Math.max(0, Math.min(1, g)), b: Math.max(0, Math.min(1, b)) };
  }
  return { r, g, b };
}

// TEV compare mode for alpha combiner (bias=3).
// Always A8 comparison: D + (compare(A,B) ? C : 0).
// GT uses >= (not strict >) to match observed GX hardware behavior:
// CMPR textures with 1-bit alpha (0 or 255) need 255 >= KONST(255) = true
// so that opaque pixels pass the compare and transparent pixels don't.
function tevCompareAlpha(a, b, c, d, op, clamp) {
  const useEq = op === TEV_SUB;
  const iA = Math.round(a * 255);
  const iB = Math.round(b * 255);
  const cond = useEq ? (iA === iB) : (iA >= iB);
  let result = d + (cond ? c : 0);
  if (clamp) {
    return Math.max(0, Math.min(1, result));
  }
  return Math.max(-1024, Math.min(1023, result));
}

// Write combiner output to the appropriate register.
// regId 2-bit: 0=PREV, 1=REG0, 2=REG1, 3=REG2.
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

// Initialize TEV output registers from material color register data.
// Reference: Material::Apply sets GX_SetTevColorS10(GX_TEVREG0+i, color_regs[i])
//   color_regs[0] → TEVREG0 (C0/A0), [1] → TEVREG1 (C1/A1), [2] → TEVREG2 (C2/A2)
//   TEVPREV (cprev/aprev) is NOT initialized from material data — defaults to 0.
// In our BRLYT parser: color1 = color_regs[0], color2 = color_regs[1], color3 = color_regs[2]
//   each stored as s16[4] array [r, g, b, a].
// NOTE: material.tevColors are color_constants (kColors for KONST inputs), NOT output registers.
function initTevRegisters(material) {
  const toFloat = (v) => (v ?? 0) / 255;

  // Default: all zeros (hardware default).
  const state = {
    cprev: { r: 0, g: 0, b: 0 }, aprev: 0,
    c0: { r: 0, g: 0, b: 0 }, a0: 0,
    c1: { r: 0, g: 0, b: 0 }, a1: 0,
    c2: { r: 0, g: 0, b: 0 }, a2: 0,
  };

  // color1 = color_regs[0] → C0 (TEVREG0)
  const c1 = material?.color1;
  if (Array.isArray(c1) && c1.length >= 4) {
    state.c0 = { r: toFloat(c1[0]), g: toFloat(c1[1]), b: toFloat(c1[2]) };
    state.a0 = toFloat(c1[3]);
  }

  // color2 = color_regs[1] → C1 (TEVREG1)
  const c2 = material?.color2;
  if (Array.isArray(c2) && c2.length >= 4) {
    state.c1 = { r: toFloat(c2[0]), g: toFloat(c2[1]), b: toFloat(c2[2]) };
    state.a1 = toFloat(c2[3]);
  }

  // color3 = color_regs[2] → C2 (TEVREG2)
  const c3 = material?.color3;
  if (Array.isArray(c3) && c3.length >= 4) {
    state.c2 = { r: toFloat(c3[0]), g: toFloat(c3[1]), b: toFloat(c3[2]) };
    state.a2 = toFloat(c3[3]);
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
    // 0=COLOR0, 1=COLOR1, 2=ALPHA0, 3=ALPHA1, 4=COLOR0A0, 5=COLOR1A1,
    // 6=GX_COLORZERO (no rasterized color), 7=BUMP, 8=BUMPN, 0xFF=COLORNULL.
    const stageRasColor = stage.colorChan === 6
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
    const doClampC = stage.clampC !== 0;
    let outR, outG, outB;
    if (stage.tevBiasC === 3) {
      const cmp = tevCompareColor(inAC, inBC, inCC, inDC, stage.tevOpC, stage.tevScaleC, doClampC);
      outR = cmp.r; outG = cmp.g; outB = cmp.b;
    } else {
      const biasC = BIAS_VALUES[stage.tevBiasC];
      const scaleC = SCALE_VALUES[stage.tevScaleC];
      outR = tevCombine(inAC.r, inBC.r, inCC.r, inDC.r, stage.tevOpC, biasC, scaleC, doClampC);
      outG = tevCombine(inAC.g, inBC.g, inCC.g, inDC.g, stage.tevOpC, biasC, scaleC, doClampC);
      outB = tevCombine(inAC.b, inBC.b, inCC.b, inDC.b, stage.tevOpC, biasC, scaleC, doClampC);
    }
    writeColorReg(state, stage.tevRegIdC, outR, outG, outB);

    // Alpha combiner.
    const inAA = resolveAlphaInput(stage.aA, state);
    const inBA = resolveAlphaInput(stage.bA, state);
    const inCA = resolveAlphaInput(stage.cA, state);
    const inDA = resolveAlphaInput(stage.dA, state);
    const doClampA = stage.clampA !== 0;
    let outA;
    if (stage.tevBiasA === 3) {
      outA = tevCompareAlpha(inAA, inBA, inCA, inDA, stage.tevOpA, doClampA);
    } else {
      const biasA = BIAS_VALUES[stage.tevBiasA];
      const scaleA = SCALE_VALUES[stage.tevScaleA];
      outA = tevCombine(inAA, inBA, inCA, inDA, stage.tevOpA, biasA, scaleA, doClampA);
    }
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
  const texCount = textureImageDatas.length;

  // Pre-allocate texture sample objects and raster color — reused per pixel.
  const texSamples = new Array(texCount);
  for (let t = 0; t < texCount; t += 1) {
    texSamples[t] = { r: 0, g: 0, b: 0, a: 0 };
  }
  const rasColor = { r: 1, g: 1, b: 1, a: 1 };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIdx = (y * width + x) * 4;

      // Sample all texture inputs into pre-allocated objects.
      for (let t = 0; t < texCount; t += 1) {
        const tex = textureImageDatas[t];
        const s = texSamples[t];
        if (!tex) {
          s.r = 0; s.g = 0; s.b = 0; s.a = 0;
          continue;
        }
        const tx = Math.min(x, tex.width - 1);
        const ty = Math.min(y, tex.height - 1);
        const ti = (ty * tex.width + tx) * 4;
        s.r = tex.data[ti] / 255;
        s.g = tex.data[ti + 1] / 255;
        s.b = tex.data[ti + 2] / 255;
        s.a = tex.data[ti + 3] / 255;
      }

      // Sample rasterized color into pre-allocated object.
      if (rasColorData) {
        const rx = Math.min(x, rasColorData.width - 1);
        const ry = Math.min(y, rasColorData.height - 1);
        const ri = (ry * rasColorData.width + rx) * 4;
        rasColor.r = rasColorData.data[ri] / 255;
        rasColor.g = rasColorData.data[ri + 1] / 255;
        rasColor.b = rasColorData.data[ri + 2] / 255;
        rasColor.a = rasColorData.data[ri + 3] / 255;
      } else {
        rasColor.r = 1; rasColor.g = 1; rasColor.b = 1; rasColor.a = 1;
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
