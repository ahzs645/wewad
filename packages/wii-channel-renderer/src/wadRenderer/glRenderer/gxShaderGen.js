export function getBasicGxMaterialSignature(options = {}) {
  return {
    hasTexture: options.hasTexture === true,
    usesVertexColor: options.usesVertexColor !== false,
    usesMaterialColor: options.usesMaterialColor !== false,
  };
}

export const MAX_TEV_TEXTURES = 4;

const BIAS_VALUES = [0, 0.5, -0.5, 0];
const SCALE_VALUES = [1, 2, 4, 0.5];
const KCOLOR_FRACTIONS = [1, 7 / 8, 3 / 4, 5 / 8, 1 / 2, 3 / 8, 1 / 4, 1 / 8];

export function getBasicGxMaterialKey(signature) {
  return [
    "basic-gx-v1",
    signature.hasTexture ? "tex" : "notex",
    signature.usesVertexColor ? "vtx" : "novtx",
    signature.usesMaterialColor ? "mat" : "nomat",
  ].join("|");
}

export function generateBasicGxShaderSources(signature) {
  const vertex = `
attribute vec2 aPos;
attribute vec2 aUV;
attribute vec4 aColor;
varying vec2 vUV;
varying vec4 vColor;
void main() {
  vUV = aUV;
  vColor = aColor;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  const sampleExpr = signature.hasTexture ? "texture2D(uTex, vUV)" : "vec4(1.0)";
  const vertexExpr = signature.usesVertexColor ? " * vColor" : "";
  const materialExpr = signature.usesMaterialColor ? " * uMaterialColor" : "";
  const fragment = `
precision mediump float;
varying vec2 vUV;
varying vec4 vColor;
uniform sampler2D uTex;
uniform vec4 uMaterialColor;
uniform float uAlpha;
void main() {
  vec4 c = ${sampleExpr}${vertexExpr}${materialExpr};
  gl_FragColor = vec4(c.rgb, c.a * uAlpha);
}`;

  return { vertex, fragment };
}

function compileShader(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

export function createBasicGxProgram(gl, signature) {
  const sources = generateBasicGxShaderSources(signature);
  const vs = compileShader(gl, gl.VERTEX_SHADER, sources.vertex);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, sources.fragment);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error(`Program link failed: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  return {
    key: getBasicGxMaterialKey(signature),
    signature,
    program,
    aPos: gl.getAttribLocation(program, "aPos"),
    aUV: gl.getAttribLocation(program, "aUV"),
    aColor: gl.getAttribLocation(program, "aColor"),
    uTex: gl.getUniformLocation(program, "uTex"),
    uMaterialColor: gl.getUniformLocation(program, "uMaterialColor"),
    uAlpha: gl.getUniformLocation(program, "uAlpha"),
  };
}

function sanitizeStage(stage) {
  return {
    texMap: stage.texMap ?? 0xff,
    colorChan: stage.colorChan ?? 0xff,
    rasSel: stage.rasSel ?? 0,
    texSel: stage.texSel ?? 0,
    aC: stage.aC ?? 15,
    bC: stage.bC ?? 15,
    cC: stage.cC ?? 15,
    dC: stage.dC ?? 15,
    tevOpC: stage.tevOpC ?? 0,
    tevBiasC: stage.tevBiasC ?? 0,
    tevScaleC: stage.tevScaleC ?? 0,
    clampC: stage.clampC ?? 1,
    tevRegIdC: stage.tevRegIdC ?? 0,
    kColorSelC: stage.kColorSelC ?? 0,
    aA: stage.aA ?? 7,
    bA: stage.bA ?? 7,
    cA: stage.cA ?? 7,
    dA: stage.dA ?? 7,
    tevOpA: stage.tevOpA ?? 0,
    tevBiasA: stage.tevBiasA ?? 0,
    tevScaleA: stage.tevScaleA ?? 0,
    clampA: stage.clampA ?? 1,
    tevRegIdA: stage.tevRegIdA ?? 0,
    kAlphaSelA: stage.kAlphaSelA ?? 0,
  };
}

export function getTevMaterialSignature(material) {
  const stages = (material?.tevStages ?? []).map(sanitizeStage);
  return {
    kind: "tev-v1",
    stages,
    alphaCompare: material?.alphaCompare ?? null,
  };
}

export function getTevMaterialKey(signature) {
  return JSON.stringify(signature);
}

function f(value) {
  const n = Number.isFinite(value) ? value : 0;
  return n === 0 ? "0.0" : n === 1 ? "1.0" : n.toFixed(8).replace(/0+$/, "").replace(/\.$/, ".0");
}

function regColorExpr(regId) {
  switch (regId) {
    case 1: return "reg0.rgb";
    case 2: return "reg1.rgb";
    case 3: return "reg2.rgb";
    case 0:
    default: return "prev.rgb";
  }
}

function regAlphaExpr(regId) {
  switch (regId) {
    case 1: return "reg0.a";
    case 2: return "reg1.a";
    case 3: return "reg2.a";
    case 0:
    default: return "prev.a";
  }
}

function colorInputExpr(sel, texName, rasName, konstName) {
  switch (sel) {
    case 0: return "prev.rgb";
    case 1: return "vec3(prev.a)";
    case 2: return "reg0.rgb";
    case 3: return "vec3(reg0.a)";
    case 4: return "reg1.rgb";
    case 5: return "vec3(reg1.a)";
    case 6: return "reg2.rgb";
    case 7: return "vec3(reg2.a)";
    case 8: return `${texName}.rgb`;
    case 9: return `vec3(${texName}.a)`;
    case 10: return `${rasName}.rgb`;
    case 11: return `vec3(${rasName}.a)`;
    case 12: return "vec3(1.0)";
    case 13: return "vec3(0.5)";
    case 14: return konstName;
    case 15:
    default: return "vec3(0.0)";
  }
}

function alphaInputExpr(sel, texName, rasName, konstName) {
  switch (sel) {
    case 0: return "prev.a";
    case 1: return "reg0.a";
    case 2: return "reg1.a";
    case 3: return "reg2.a";
    case 4: return `${texName}.a`;
    case 5: return `${rasName}.a`;
    case 6: return konstName;
    case 7:
    default: return "0.0";
  }
}

function kColorExpr(sel) {
  if (sel <= 7) {
    return `vec3(${f(KCOLOR_FRACTIONS[sel])})`;
  }
  if (sel >= 12 && sel <= 15) {
    return `uKColor${sel - 12}.rgb`;
  }
  if (sel >= 16 && sel <= 31) {
    const idx = (sel - 16) % 4;
    const chan = ["r", "g", "b", "a"][Math.floor((sel - 16) / 4)] ?? "r";
    return `vec3(uKColor${idx}.${chan})`;
  }
  return "vec3(0.0)";
}

function kAlphaExpr(sel) {
  if (sel <= 7) {
    return f(KCOLOR_FRACTIONS[sel]);
  }
  if (sel >= 16 && sel <= 31) {
    const idx = (sel - 16) % 4;
    const chan = ["r", "g", "b", "a"][Math.floor((sel - 16) / 4)] ?? "r";
    return `uKColor${idx}.${chan}`;
  }
  return "0.0";
}

function tevColorCombineExpr(stage, a, b, c, d) {
  if (stage.tevOpC >= 8) {
    const ia = `floor((${a}) * 255.0 + vec3(0.5))`;
    const ib = `floor((${b}) * 255.0 + vec3(0.5))`;
    const granularity = (stage.tevOpC - 8) >> 1;
    const eq = (stage.tevOpC & 1) !== 0;
    const cmp = eq ? "==" : ">";
    let expr;
    if (granularity === 0) {
      const cond = `(${ia}.r ${cmp} ${ib}.r)`;
      expr = `(${d} + (${cond} ? ${c} : vec3(0.0)))`;
    } else if (granularity === 1) {
      const va = `(${ia}.g * 256.0 + ${ia}.r)`;
      const vb = `(${ib}.g * 256.0 + ${ib}.r)`;
      expr = `(${d} + ((${va} ${cmp} ${vb}) ? ${c} : vec3(0.0)))`;
    } else if (granularity === 2) {
      const va = `(${ia}.b * 65536.0 + ${ia}.g * 256.0 + ${ia}.r)`;
      const vb = `(${ib}.b * 65536.0 + ${ib}.g * 256.0 + ${ib}.r)`;
      expr = `(${d} + ((${va} ${cmp} ${vb}) ? ${c} : vec3(0.0)))`;
    } else {
      expr = `(${d} + vec3((${ia}.r ${cmp} ${ib}.r) ? ${c}.r : 0.0, (${ia}.g ${cmp} ${ib}.g) ? ${c}.g : 0.0, (${ia}.b ${cmp} ${ib}.b) ? ${c}.b : 0.0))`;
    }
    if (stage.clampC !== 0) {
      expr = `clamp(${expr}, 0.0, 1.0)`;
    }
    return expr;
  }

  const bias = f(BIAS_VALUES[stage.tevBiasC] ?? 0);
  const scale = f(SCALE_VALUES[stage.tevScaleC] ?? 1);
  const op = stage.tevOpC === 1 ? "-" : "+";
  let expr = `((${d} ${op} mix(${a}, ${b}, ${c}) + vec3(${bias})) * ${scale})`;
  if (stage.clampC !== 0) {
    expr = `clamp(${expr}, 0.0, 1.0)`;
  }
  return expr;
}

function tevAlphaCombineExpr(stage, a, b, c, d) {
  if (stage.tevOpA >= 8) {
    const ia = `floor((${a}) * 255.0 + 0.5)`;
    const ib = `floor((${b}) * 255.0 + 0.5)`;
    const cmp = (stage.tevOpA & 1) !== 0 ? "==" : ">=";
    let expr = `(${d} + ((${ia} ${cmp} ${ib}) ? ${c} : 0.0))`;
    if (stage.clampA !== 0) {
      expr = `clamp(${expr}, 0.0, 1.0)`;
    }
    return expr;
  }

  const bias = f(BIAS_VALUES[stage.tevBiasA] ?? 0);
  const scale = f(SCALE_VALUES[stage.tevScaleA] ?? 1);
  const op = stage.tevOpA === 1 ? "-" : "+";
  let expr = `((${d} ${op} mix(${a}, ${b}, ${c}) + ${bias}) * ${scale})`;
  if (stage.clampA !== 0) {
    expr = `clamp(${expr}, 0.0, 1.0)`;
  }
  return expr;
}

function colorWriteLine(regId, valueExpr) {
  switch (regId) {
    case 1: return `reg0.rgb = ${valueExpr};`;
    case 2: return `reg1.rgb = ${valueExpr};`;
    case 3: return `reg2.rgb = ${valueExpr};`;
    case 0:
    default: return `prev.rgb = ${valueExpr};`;
  }
}

function alphaWriteLine(regId, valueExpr) {
  switch (regId) {
    case 1: return `reg0.a = ${valueExpr};`;
    case 2: return `reg1.a = ${valueExpr};`;
    case 3: return `reg2.a = ${valueExpr};`;
    case 0:
    default: return `prev.a = ${valueExpr};`;
  }
}

function alphaConditionExpr(condition, valueExpr, refExpr) {
  switch (condition) {
    case 0: return "false";
    case 1: return `(${valueExpr} < ${refExpr})`;
    case 2: return `(${valueExpr} == ${refExpr})`;
    case 3: return `(${valueExpr} <= ${refExpr})`;
    case 4: return `(${valueExpr} > ${refExpr})`;
    case 5: return `(${valueExpr} != ${refExpr})`;
    case 6: return `(${valueExpr} >= ${refExpr})`;
    case 7:
    default: return "true";
  }
}

function alphaCompareBlock(alphaCompare) {
  if (!alphaCompare) {
    return "";
  }
  const ref0 = f(alphaCompare.value0 ?? 0);
  const ref1 = f(alphaCompare.value1 ?? 0);
  const pass0 = alphaConditionExpr(alphaCompare.condition0, "alpha255", ref0);
  const pass1 = alphaConditionExpr(alphaCompare.condition1, "alpha255", ref1);
  let combined;
  switch (alphaCompare.operation) {
    case 1: combined = `(pass0 || pass1)`; break;
    case 2: combined = `(pass0 != pass1)`; break;
    case 3: combined = `(pass0 == pass1)`; break;
    case 0:
    default: combined = `(pass0 && pass1)`; break;
  }
  return `
  float alpha255 = floor(clamp(prev.a, 0.0, 1.0) * 255.0 + 0.5);
  bool pass0 = ${pass0};
  bool pass1 = ${pass1};
  if (!${combined}) {
    discard;
  }`;
}

function generateTevStage(stage, index) {
  const texIndex = stage.texMap >= 0 && stage.texMap < MAX_TEV_TEXTURES ? stage.texMap : -1;
  const texName = `tex${index}`;
  const rasName = `ras${index}`;
  const texExpr = texIndex >= 0 ? `texture2D(uTex${texIndex}, vUV${texIndex})` : "vec4(0.0)";
  const rasExpr = stage.colorChan === 6 || stage.colorChan === 0xff ? "vec4(0.0)" : "vColor";
  const konstC = `konstC${index}`;
  const konstA = `konstA${index}`;
  const aC = colorInputExpr(stage.aC, texName, rasName, konstC);
  const bC = colorInputExpr(stage.bC, texName, rasName, konstC);
  const cC = colorInputExpr(stage.cC, texName, rasName, konstC);
  const dC = colorInputExpr(stage.dC, texName, rasName, konstC);
  const aA = alphaInputExpr(stage.aA, texName, rasName, konstA);
  const bA = alphaInputExpr(stage.bA, texName, rasName, konstA);
  const cA = alphaInputExpr(stage.cA, texName, rasName, konstA);
  const dA = alphaInputExpr(stage.dA, texName, rasName, konstA);

  return `
  vec4 ${texName} = ${texExpr};
  vec4 ${rasName} = ${rasExpr};
  vec3 ${konstC} = ${kColorExpr(stage.kColorSelC)};
  float ${konstA} = ${kAlphaExpr(stage.kAlphaSelA)};
  vec3 colorOut${index} = ${tevColorCombineExpr(stage, aC, bC, cC, dC)};
  float alphaOut${index} = ${tevAlphaCombineExpr(stage, aA, bA, cA, dA)};
  ${colorWriteLine(stage.tevRegIdC, `colorOut${index}`)}
  ${alphaWriteLine(stage.tevRegIdA, `alphaOut${index}`)}`;
}

export function generateTevShaderSources(signature) {
  const uvAttrs = Array.from({ length: MAX_TEV_TEXTURES }, (_, i) => `attribute vec2 aUV${i};`).join("\n");
  const uvVars = Array.from({ length: MAX_TEV_TEXTURES }, (_, i) => `varying vec2 vUV${i};`).join("\n");
  const uvAssign = Array.from({ length: MAX_TEV_TEXTURES }, (_, i) => `  vUV${i} = aUV${i};`).join("\n");
  const samplers = Array.from({ length: MAX_TEV_TEXTURES }, (_, i) => `uniform sampler2D uTex${i};`).join("\n");
  const stages = signature.stages.map((stage, i) => generateTevStage(stage, i)).join("\n");

  const vertex = `
attribute vec2 aPos;
${uvAttrs}
attribute vec4 aColor;
${uvVars}
varying vec4 vColor;
void main() {
${uvAssign}
  vColor = aColor;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  const fragment = `
precision mediump float;
${uvVars}
varying vec4 vColor;
${samplers}
uniform vec4 uColorReg0;
uniform vec4 uColorReg1;
uniform vec4 uColorReg2;
uniform vec4 uKColor0;
uniform vec4 uKColor1;
uniform vec4 uKColor2;
uniform vec4 uKColor3;
uniform float uAlpha;
void main() {
  vec4 prev = vec4(0.0);
  vec4 reg0 = uColorReg0;
  vec4 reg1 = uColorReg1;
  vec4 reg2 = uColorReg2;
${stages}
${alphaCompareBlock(signature.alphaCompare)}
  prev = clamp(prev, 0.0, 1.0);
  gl_FragColor = vec4(prev.rgb, prev.a * uAlpha);
}`;

  return { vertex, fragment };
}

export function createTevProgram(gl, signature) {
  const sources = generateTevShaderSources(signature);
  const vs = compileShader(gl, gl.VERTEX_SHADER, sources.vertex);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, sources.fragment);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error(`Program link failed: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  return {
    key: getTevMaterialKey(signature),
    signature,
    program,
    aPos: gl.getAttribLocation(program, "aPos"),
    aUV: Array.from({ length: MAX_TEV_TEXTURES }, (_, i) => gl.getAttribLocation(program, `aUV${i}`)),
    aColor: gl.getAttribLocation(program, "aColor"),
    uTex: Array.from({ length: MAX_TEV_TEXTURES }, (_, i) => gl.getUniformLocation(program, `uTex${i}`)),
    uColorReg: [
      gl.getUniformLocation(program, "uColorReg0"),
      gl.getUniformLocation(program, "uColorReg1"),
      gl.getUniformLocation(program, "uColorReg2"),
    ],
    uKColor: [
      gl.getUniformLocation(program, "uKColor0"),
      gl.getUniformLocation(program, "uKColor1"),
      gl.getUniformLocation(program, "uKColor2"),
      gl.getUniformLocation(program, "uKColor3"),
    ],
    uAlpha: gl.getUniformLocation(program, "uAlpha"),
  };
}
