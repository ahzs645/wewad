// WebGL banner backend (swappable with the Canvas-2D BannerRenderer).
//
// Design: parse/sample pane state through the shared BannerRenderer core, draw
// simple GX/TEV material signatures directly as GPU quads using once-uploaded
// TPL textures, and keep the tested Canvas pane rasterizer as the fallback for
// text, custom panes, luma/chroma heuristics, and unsupported TEV features.
//
// Returns a BannerRenderer instance whose draw step is replaced with the GL path,
// so it is API-compatible (play/stop/seekToFrame/applyFrame/dispose/…).

import { BannerRenderer } from "../BannerRenderer.js";
import { getProjectedTransform2D } from "../bannerRenderer/transformMethods.js";
import { normalizePaneVertexColors, resolveWrapMode } from "../bannerRenderer/renderColorUtils.js";
import { buildAnimatedMaterial } from "../bannerRenderer/tevMethods.js";
import { applyPoint, buildChainAffine, buildQuadVertices } from "./paneGeometry.js";
import { resolveGlBlendState, applyGlBlendState } from "./gxBlend.js";
import {
  MAX_TEV_TEXTURES,
  createBasicGxProgram,
  createTevProgram,
  getBasicGxMaterialKey,
  getBasicGxMaterialSignature,
  getTevMaterialKey,
  getTevMaterialSignature,
} from "./gxShaderGen.js";

const BASIC_VERTEX_STRIDE_BYTES = 32;
const TEV_VERTEX_STRIDE_BYTES = (2 + MAX_TEV_TEXTURES * 2 + 4) * 4;
const ROTATED_PANE_SEAM_PAD = 4;

const VERT_SRC = `
attribute vec2 aPos;
attribute vec2 aUV;
varying vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG_SRC = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uTex;
uniform float uAlpha;
void main() {
  vec4 c = texture2D(uTex, vUV);
  gl_FragColor = vec4(c.rgb, c.a * uAlpha);
}`;

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

function createProgram(gl) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    throw new Error(`Program link failed: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

export function isWebGlSupported() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function createGlContext(canvas) {
  const attrs = { alpha: true, premultipliedAlpha: false, antialias: true, preserveDrawingBuffer: true };
  const gl = canvas.getContext("webgl2", attrs) || canvas.getContext("webgl", attrs);
  if (!gl) {
    throw new Error("WebGL is not available");
  }
  return gl;
}

function buildGlState(glCanvas) {
  // Cache GL resources on the canvas element. The renderer effect re-creates the
  // renderer on many setting changes (without remounting the canvas), so we must
  // reuse the live context/program rather than recreate — and must never
  // loseContext() on dispose, which would poison the canvas for the next renderer
  // ("Shader compile failed: null"). A fresh canvas (backend switch remounts it)
  // has no cache and gets a new context. The cached context is released by GC when
  // its canvas is unmounted.
  const existing = glCanvas.__wewadGlState;
  if (existing && existing.gl && !existing.gl.isContextLost()) {
    return existing;
  }

  const gl = createGlContext(glCanvas);
  const program = createProgram(gl);
  const quadBuffer = gl.createBuffer();

  const state = {
    gl,
    isWebGl2: typeof gl.texStorage2D === "function",
    program,
    quadBuffer,
    materialPrograms: new Map(),
    tevPrograms: new Map(),
    lastMaterialProgram: null,
    aPos: gl.getAttribLocation(program, "aPos"),
    aUV: gl.getAttribLocation(program, "aUV"),
    uTex: gl.getUniformLocation(program, "uTex"),
    uAlpha: gl.getUniformLocation(program, "uAlpha"),
    // Offscreen 2D surface used to rasterize each pane via the Canvas pipeline.
    rasterCanvas: document.createElement("canvas"),
    rasterCtx: null,
  };
  glCanvas.__wewadGlState = state;
  return state;
}

function disableProgramAttribs(gl, programInfo) {
  if (!programInfo) {
    return;
  }
  if (programInfo.aPos >= 0) {
    gl.disableVertexAttribArray(programInfo.aPos);
  }
  if (Array.isArray(programInfo.aUV)) {
    for (const location of programInfo.aUV) {
      if (location >= 0) {
        gl.disableVertexAttribArray(location);
      }
    }
  } else if (programInfo.aUV >= 0) {
    gl.disableVertexAttribArray(programInfo.aUV);
  }
  if (programInfo.aColor >= 0) {
    gl.disableVertexAttribArray(programInfo.aColor);
  }
}

function bindBitmapProgram(gl, glState) {
  disableProgramAttribs(gl, glState.lastMaterialProgram);
  glState.lastMaterialProgram = null;
  gl.useProgram(glState.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(glState.uTex, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, glState.quadBuffer);
  gl.enableVertexAttribArray(glState.aPos);
  gl.enableVertexAttribArray(glState.aUV);
  gl.vertexAttribPointer(glState.aPos, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(glState.aUV, 2, gl.FLOAT, false, 16, 8);
}

function serializeColorList(colors) {
  if (!Array.isArray(colors)) {
    return "";
  }
  return colors
    .map((c) => `${c?.r ?? ""},${c?.g ?? ""},${c?.b ?? ""},${c?.a ?? ""}`)
    .join(";");
}

function serializeSrtMap(srtMap) {
  if (!srtMap || typeof srtMap.entries !== "function") {
    return "";
  }
  const parts = [];
  for (const [index, srt] of srtMap.entries()) {
    parts.push(`${index}:${srt?.xTrans ?? 0},${srt?.yTrans ?? 0},${srt?.rotation ?? 0},${srt?.xScale ?? 1},${srt?.yScale ?? 1}`);
  }
  return parts.join(";");
}

function serializeBinding(binding) {
  if (!binding) {
    return "null";
  }
  const srt = binding.textureSRT;
  return [
    binding.textureName ?? "",
    binding.wrapS ?? 0,
    binding.wrapT ?? 0,
    binding.texCoordIndex ?? 0,
    srt?.xTrans ?? 0,
    srt?.yTrans ?? 0,
    srt?.rotation ?? 0,
    srt?.xScale ?? 1,
    srt?.yScale ?? 1,
  ].join(",");
}

function buildMaterialContentKey(material) {
  if (!material) {
    return "no-material";
  }
  return JSON.stringify({
    color1: material.color1,
    color2: material.color2,
    color3: material.color3,
    materialColor: material.materialColor,
    channelControl: material.channelControl,
    alphaCompare: material.alphaCompare,
    textureMaps: material.textureMaps,
    textureIndices: material.textureIndices,
    textureSRTs: material.textureSRTs,
    tevColors: material.tevColors,
    tevStages: material.tevStages,
  });
}

function getTextContentForKey(core, pane) {
  return core.getCustomWeatherTextForPane(pane) ??
    core.getCustomNewsTextForPane?.(pane) ??
    core.textOverrides?.[pane.name] ??
    pane?.text ??
    "";
}

function buildPaneRasterCacheKey(core, pane, paneState, w, h) {
  const material = Number.isInteger(pane?.materialIndex) && pane.materialIndex >= 0
    ? core.layout?.materials?.[pane.materialIndex]
    : null;
  const usesTev = pane.type === "pic1" || pane.type === "wnd1"
    ? core.shouldUseTevPipeline(pane)
    : false;
  const animatedSrt = core.getPaneTextureSRTAnimations?.(pane?.name, core.frame) ?? null;
  const animatedMaterial = core.getPaneMaterialAnimColor?.(pane?.name, core.frame) ?? null;
  const bindings = pane.type === "pic1" || pane.type === "wnd1"
    ? (usesTev
        ? core.getAllTextureBindingsForPane(pane, paneState)
        : [core.getTextureBindingForPane(pane, paneState)])
    : [];

  return JSON.stringify({
    phase: core.phase,
    pane: pane.name,
    type: pane.type,
    materialIndex: pane.materialIndex,
    size: [w, h],
    textureIndex: paneState?.textureIndex ?? null,
    vertexColors: serializeColorList(paneState?.vertexColors ?? pane?.vertexColors),
    text: pane.type === "txt1" ? getTextContentForKey(core, pane) : "",
    usesTev,
    material: buildMaterialContentKey(material),
    animatedMaterial,
    animatedSrt: serializeSrtMap(animatedSrt),
    bindings: bindings.map(serializeBinding),
    strictMaterialMode: core.strictMaterialMode === true,
    strictTevEvaluation: core.strictTevEvaluation === true,
    tevQuality: core.tevQuality,
  });
}

function getCachedPaneTexture(core, key) {
  const cached = core._glPaneTextureCache.get(key);
  if (!cached) {
    return null;
  }
  core._glPaneTextureCache.delete(key);
  core._glPaneTextureCache.set(key, cached);
  return cached;
}

function createPaneTexture(gl, surface) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, surface);
  return texture;
}

function setCachedPaneTexture(core, gl, key, surface) {
  const texture = createPaneTexture(gl, surface);
  const entry = { texture, width: surface.width, height: surface.height };
  core._glPaneTextureCache.set(key, entry);
  while (core._glPaneTextureCache.size > core._glPaneTextureCacheLimit) {
    const oldestKey = core._glPaneTextureCache.keys().next().value;
    if (oldestKey == null) {
      break;
    }
    const oldest = core._glPaneTextureCache.get(oldestKey);
    core._glPaneTextureCache.delete(oldestKey);
    if (oldest?.texture) {
      gl.deleteTexture(oldest.texture);
    }
  }
  return entry;
}

function toTexturePixels(imageData) {
  if (imageData instanceof Uint8Array) {
    return imageData;
  }
  if (ArrayBuffer.isView(imageData)) {
    return new Uint8Array(imageData.buffer, imageData.byteOffset, imageData.byteLength);
  }
  return imageData;
}

function uploadTplTextures(gl, tplImages) {
  const textures = new Map();
  for (const [name, images] of Object.entries(tplImages ?? {})) {
    const image = images?.[0];
    if (!image?.imageData || !Number.isFinite(image.width) || !Number.isFinite(image.height)) {
      continue;
    }

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      image.width,
      image.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      toTexturePixels(image.imageData),
    );
    textures.set(name, {
      texture,
      width: image.width,
      height: image.height,
      format: image.format,
    });
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
  return textures;
}

function deleteTextureMap(gl, textures) {
  for (const entry of textures?.values?.() ?? []) {
    if (entry?.texture) {
      gl.deleteTexture(entry.texture);
    }
  }
  textures?.clear?.();
}

function isPowerOfTwo(value) {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function resolveGlWrap(gl, rawWrap) {
  const wrap = resolveWrapMode(rawWrap);
  if (wrap === "repeat") {
    return gl.REPEAT;
  }
  if (wrap === "mirror") {
    return gl.MIRRORED_REPEAT;
  }
  return gl.CLAMP_TO_EDGE;
}

function canUseGpuWrap(glState, textureRecord, wrapS, wrapT) {
  const needsRepeat = resolveWrapMode(wrapS) !== "clamp" || resolveWrapMode(wrapT) !== "clamp";
  if (!needsRepeat || glState.isWebGl2) {
    return true;
  }
  return isPowerOfTwo(textureRecord.width) && isPowerOfTwo(textureRecord.height);
}

function getGeneratedMaterialProgram(gl, glState, signature) {
  const key = getBasicGxMaterialKey(signature);
  const cached = glState.materialPrograms.get(key);
  if (cached) {
    return cached;
  }
  const program = createBasicGxProgram(gl, signature);
  glState.materialPrograms.set(key, program);
  return program;
}

function getGeneratedTevProgram(gl, glState, signature) {
  const key = getTevMaterialKey(signature);
  const cached = glState.tevPrograms.get(key);
  if (cached) {
    return cached;
  }
  const program = createTevProgram(gl, signature);
  glState.tevPrograms.set(key, program);
  return program;
}

function bindGeneratedMaterialProgram(gl, glState, programInfo) {
  disableProgramAttribs(gl, glState.lastMaterialProgram);
  gl.useProgram(programInfo.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, glState.quadBuffer);
  if (programInfo.aPos >= 0) {
    gl.enableVertexAttribArray(programInfo.aPos);
    gl.vertexAttribPointer(programInfo.aPos, 2, gl.FLOAT, false, BASIC_VERTEX_STRIDE_BYTES, 0);
  }
  if (programInfo.aUV >= 0) {
    gl.enableVertexAttribArray(programInfo.aUV);
    gl.vertexAttribPointer(programInfo.aUV, 2, gl.FLOAT, false, BASIC_VERTEX_STRIDE_BYTES, 8);
  }
  if (programInfo.aColor >= 0) {
    gl.enableVertexAttribArray(programInfo.aColor);
    gl.vertexAttribPointer(programInfo.aColor, 4, gl.FLOAT, false, BASIC_VERTEX_STRIDE_BYTES, 16);
  }
  glState.lastMaterialProgram = programInfo;
}

function bindTevProgram(gl, glState, programInfo) {
  disableProgramAttribs(gl, glState.lastMaterialProgram);
  gl.useProgram(programInfo.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, glState.quadBuffer);
  if (programInfo.aPos >= 0) {
    gl.enableVertexAttribArray(programInfo.aPos);
    gl.vertexAttribPointer(programInfo.aPos, 2, gl.FLOAT, false, TEV_VERTEX_STRIDE_BYTES, 0);
  }
  for (let i = 0; i < MAX_TEV_TEXTURES; i += 1) {
    const location = programInfo.aUV[i];
    if (location >= 0) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, TEV_VERTEX_STRIDE_BYTES, 8 + i * 8);
    }
  }
  if (programInfo.aColor >= 0) {
    gl.enableVertexAttribArray(programInfo.aColor);
    gl.vertexAttribPointer(programInfo.aColor, 4, gl.FLOAT, false, TEV_VERTEX_STRIDE_BYTES, 8 + MAX_TEV_TEXTURES * 8);
  }
  glState.lastMaterialProgram = programInfo;
}

function getPaneMaterialColor(core, pane, binding) {
  if (binding?.skipMaterialColorModulation) {
    return [1, 1, 1, 1];
  }
  const modulation = core.getPaneMaterialColorModulation(pane);
  if (!modulation) {
    return [1, 1, 1, 1];
  }
  return [
    (modulation.r ?? 255) / 255,
    (modulation.g ?? 255) / 255,
    (modulation.b ?? 255) / 255,
    (modulation.a ?? 255) / 255,
  ];
}

function getPaneVertexColors(pane, paneState) {
  const colors = paneState?.vertexColors
    ? normalizePaneVertexColors({ vertexColors: paneState.vertexColors })
    : normalizePaneVertexColors(pane);
  return colors ?? [
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
  ];
}

function lerpUv(a, b, t) {
  return {
    s: a.s + (b.s - a.s) * t,
    t: a.t + (b.t - a.t) * t,
  };
}

function bilerpUv(tl, tr, bl, br, x, y) {
  const top = lerpUv(tl, tr, x);
  const bottom = lerpUv(bl, br, x);
  return lerpUv(top, bottom, y);
}

function getGpuUvs(core, pane, binding, width, height, seamPad = 0) {
  if (!binding) {
    return [
      { s: 0, t: 0 },
      { s: 0, t: 0 },
      { s: 0, t: 0 },
      { s: 0, t: 0 },
    ];
  }

  const transformed = core.getTransformedTexCoords(pane, binding.textureSRT ?? null, binding.texCoordIndex ?? 0);
  if (!transformed) {
    return null;
  }

  let tl = transformed.tl;
  let tr = transformed.tr;
  let bl = transformed.bl;
  let br = transformed.br;
  if (width < 0) {
    [tl, tr] = [tr, tl];
    [bl, br] = [br, bl];
  }
  if (height < 0) {
    [tl, bl] = [bl, tl];
    [tr, br] = [br, tr];
  }
  if (seamPad > 0) {
    const absW = Math.max(1, Math.abs(width));
    const absH = Math.max(1, Math.abs(height));
    const left = -seamPad / absW;
    const right = 1 + seamPad / absW;
    const top = -seamPad / absH;
    const bottom = 1 + seamPad / absH;
    return [
      bilerpUv(tl, tr, bl, br, left, top),
      bilerpUv(tl, tr, bl, br, right, top),
      bilerpUv(tl, tr, bl, br, left, bottom),
      bilerpUv(tl, tr, bl, br, right, bottom),
    ];
  }
  return [tl, tr, bl, br];
}

function buildGpuQuadVertices(core, preparedPane, chainAffine, baseScaleX, baseScaleY, pixelWidth, pixelHeight, binding) {
  const { pane, paneState } = preparedPane;
  const seamPad = preparedPane.has3DRotation ? ROTATED_PANE_SEAM_PAD : 0;
  const halfW = Math.abs(paneState.width) / 2 + seamPad;
  const halfH = Math.abs(paneState.height) / 2 + seamPad;
  const uvs = getGpuUvs(core, pane, binding, paneState.width, paneState.height, seamPad);
  if (!uvs) {
    return null;
  }

  const colors = getPaneVertexColors(pane, paneState);
  const corners = [
    { lx: -halfW, ly: -halfH },
    { lx: halfW, ly: -halfH },
    { lx: -halfW, ly: halfH },
    { lx: halfW, ly: halfH },
  ];

  const out = new Float32Array(32);
  for (let i = 0; i < 4; i += 1) {
    const point = applyPoint(chainAffine, corners[i].lx, corners[i].ly);
    const deviceX = baseScaleX * point.x;
    const deviceY = baseScaleY * point.y;
    const color = colors[i];
    const uv = uvs[i];
    const offset = i * 8;
    out[offset + 0] = (2 * deviceX) / pixelWidth - 1;
    out[offset + 1] = 1 - (2 * deviceY) / pixelHeight;
    out[offset + 2] = uv.s;
    out[offset + 3] = uv.t;
    out[offset + 4] = (color.r ?? 255) / 255;
    out[offset + 5] = (color.g ?? 255) / 255;
    out[offset + 6] = (color.b ?? 255) / 255;
    out[offset + 7] = (color.a ?? 255) / 255;
  }
  return out;
}

function isIdentitySwapTable(table) {
  if (!Array.isArray(table) || table.length === 0) {
    return true;
  }
  return table.every((entry) =>
    (entry?.r ?? 0) === 0 &&
    (entry?.g ?? 1) === 1 &&
    (entry?.b ?? 2) === 2 &&
    (entry?.a ?? 3) === 3
  );
}

function isSupportedTevOp(op) {
  return op === 0 || op === 1 || (op >= 8 && op <= 15);
}

function hasUnsupportedIndirectStage(stage) {
  return Boolean(
    stage?.indTexId ||
    stage?.indBias ||
    stage?.indMtxId ||
    stage?.indWrapS ||
    stage?.indWrapT ||
    stage?.indFormat ||
    stage?.indAddPrev ||
    stage?.indUtcLod ||
    stage?.indAlpha
  );
}

function isSupportedTevStage(stage) {
  if (!stage || !isSupportedTevOp(stage.tevOpC ?? 0) || !isSupportedTevOp(stage.tevOpA ?? 0)) {
    return false;
  }
  if (hasUnsupportedIndirectStage(stage)) {
    return false;
  }
  const texMap = stage.texMap ?? 0xff;
  return texMap === 0xff || (texMap >= 0 && texMap < MAX_TEV_TEXTURES);
}

function isSupportedTevMaterial(material) {
  const stages = material?.tevStages;
  if (!Array.isArray(stages) || stages.length === 0) {
    return false;
  }
  if (hasNonDefaultChannelControl(material)) {
    return false;
  }
  if (!isIdentitySwapTable(material.tevSwapTable)) {
    return false;
  }
  if ((material.indTexMatrices?.length ?? 0) > 0 || (material.indTexStages?.length ?? 0) > 0) {
    return false;
  }
  const alphaCompare = material.alphaCompare;
  if (
    alphaCompare &&
    (
      alphaCompare.condition0 < 0 || alphaCompare.condition0 > 7 ||
      alphaCompare.condition1 < 0 || alphaCompare.condition1 > 7 ||
      alphaCompare.operation < 0 || alphaCompare.operation > 3
    )
  ) {
    return false;
  }
  return stages.every(isSupportedTevStage);
}

function toColorRegisterVec4(color) {
  return [
    (Array.isArray(color) ? (color[0] ?? 0) : 0) / 255,
    (Array.isArray(color) ? (color[1] ?? 0) : 0) / 255,
    (Array.isArray(color) ? (color[2] ?? 0) : 0) / 255,
    (Array.isArray(color) ? (color[3] ?? 0) : 0) / 255,
  ];
}

function toKColorVec4(color) {
  return [
    (color?.r ?? 0) / 255,
    (color?.g ?? 0) / 255,
    (color?.b ?? 0) / 255,
    (color?.a ?? 0) / 255,
  ];
}

function hasNonDefaultChannelControl(material) {
  const channelControl = material?.channelControl;
  if (!channelControl) {
    return false;
  }
  return channelControl.colorSource === 0 || channelControl.alphaSource === 0;
}

function shouldFallbackToCanvasForBinding(core, pane, binding) {
  if (!binding) {
    return false;
  }
  if (String(binding.textureName ?? "").includes("|") || binding.skipMaterialColorModulation) {
    return true;
  }
  return Boolean(
    core.shouldTreatPaneAsLumaMask?.(pane, binding) ||
    core.shouldTreatPaneAsLumaOverlay?.(pane, binding)
  );
}

function getDirectGpuBinding(core, glState, pane, paneState) {
  if (pane.type !== "pic1" && pane.type !== "wnd1") {
    return { eligible: false, binding: null, textureRecord: null };
  }
  if (core.shouldDrawCustomTemperatureForPane?.(pane) || core.shouldUseTevPipeline(pane)) {
    return { eligible: false, binding: null, textureRecord: null };
  }

  const material = Number.isInteger(pane?.materialIndex) && pane.materialIndex >= 0
    ? core.layout?.materials?.[pane.materialIndex]
    : null;
  if (hasNonDefaultChannelControl(material)) {
    return { eligible: false, binding: null, textureRecord: null };
  }

  const binding = core.getTextureBindingForPane(pane, paneState);
  if (!binding) {
    const colors = paneState?.vertexColors ?? pane?.vertexColors;
    return {
      eligible: Array.isArray(colors) && colors.length === 4,
      binding: null,
      textureRecord: null,
    };
  }
  if (shouldFallbackToCanvasForBinding(core, pane, binding)) {
    return { eligible: false, binding, textureRecord: null };
  }

  const textureRecord = core._glTextureCache.get(binding.textureName);
  if (!textureRecord || !canUseGpuWrap(glState, textureRecord, binding.wrapS, binding.wrapT)) {
    return { eligible: false, binding, textureRecord: null };
  }
  return { eligible: true, binding, textureRecord };
}

function getTevGpuBindings(core, glState, pane, paneState) {
  if (pane.type !== "pic1" && pane.type !== "wnd1") {
    return { eligible: false, material: null, bindings: [], textureRecords: [] };
  }
  if (core.shouldDrawCustomTemperatureForPane?.(pane) || !core.shouldUseTevPipeline(pane)) {
    return { eligible: false, material: null, bindings: [], textureRecords: [] };
  }
  if (core.paneAlphaMaskFromFirstTexture?.has(pane.name)) {
    return { eligible: false, material: null, bindings: [], textureRecords: [] };
  }

  const material = Number.isInteger(pane?.materialIndex) && pane.materialIndex >= 0
    ? core.layout?.materials?.[pane.materialIndex]
    : null;
  if (!isSupportedTevMaterial(material)) {
    return { eligible: false, material, bindings: [], textureRecords: [] };
  }

  const bindings = core.getAllTextureBindingsForPane(pane, paneState);
  const textureRecords = Array.from({ length: MAX_TEV_TEXTURES }, () => null);
  for (const stage of material.tevStages) {
    const texMap = stage.texMap ?? 0xff;
    if (texMap === 0xff) {
      continue;
    }
    const binding = bindings[texMap];
    if (!binding || shouldFallbackToCanvasForBinding(core, pane, binding)) {
      return { eligible: false, material, bindings, textureRecords: [] };
    }
    const textureRecord = core._glTextureCache.get(binding.textureName);
    if (!textureRecord || !canUseGpuWrap(glState, textureRecord, binding.wrapS, binding.wrapT)) {
      return { eligible: false, material, bindings, textureRecords: [] };
    }
    textureRecords[texMap] = textureRecord;
  }

  return { eligible: true, material, bindings, textureRecords };
}

function buildTevQuadVertices(core, preparedPane, chainAffine, metrics, bindings) {
  const { pane, paneState } = preparedPane;
  const seamPad = preparedPane.has3DRotation ? ROTATED_PANE_SEAM_PAD : 0;
  const halfW = Math.abs(paneState.width) / 2 + seamPad;
  const halfH = Math.abs(paneState.height) / 2 + seamPad;
  const uvSets = [];
  for (let i = 0; i < MAX_TEV_TEXTURES; i += 1) {
    const uvs = getGpuUvs(core, pane, bindings[i], paneState.width, paneState.height, seamPad);
    if (!uvs) {
      return null;
    }
    uvSets.push(uvs);
  }

  const colors = getPaneVertexColors(pane, paneState);
  const corners = [
    { lx: -halfW, ly: -halfH },
    { lx: halfW, ly: -halfH },
    { lx: -halfW, ly: halfH },
    { lx: halfW, ly: halfH },
  ];

  const floatsPerVertex = 2 + MAX_TEV_TEXTURES * 2 + 4;
  const colorOffset = 2 + MAX_TEV_TEXTURES * 2;
  const out = new Float32Array(4 * floatsPerVertex);
  for (let i = 0; i < 4; i += 1) {
    const point = applyPoint(chainAffine, corners[i].lx, corners[i].ly);
    const deviceX = metrics.baseScaleX * point.x;
    const deviceY = metrics.baseScaleY * point.y;
    const color = colors[i];
    const offset = i * floatsPerVertex;
    out[offset + 0] = (2 * deviceX) / metrics.pixelWidth - 1;
    out[offset + 1] = 1 - (2 * deviceY) / metrics.pixelHeight;
    for (let uvIndex = 0; uvIndex < MAX_TEV_TEXTURES; uvIndex += 1) {
      const uv = uvSets[uvIndex][i];
      out[offset + 2 + uvIndex * 2] = uv.s;
      out[offset + 3 + uvIndex * 2] = uv.t;
    }
    out[offset + colorOffset + 0] = (color.r ?? 255) / 255;
    out[offset + colorOffset + 1] = (color.g ?? 255) / 255;
    out[offset + colorOffset + 2] = (color.b ?? 255) / 255;
    out[offset + colorOffset + 3] = (color.a ?? 255) / 255;
  }
  return out;
}

function setTevUniforms(gl, programInfo, core, pane, baseMaterial, bindings, textureRecords, alpha) {
  const material = buildAnimatedMaterial(core, pane, baseMaterial);
  const colorRegs = [material.color1, material.color2, material.color3];
  for (let i = 0; i < programInfo.uColorReg.length; i += 1) {
    if (programInfo.uColorReg[i]) {
      gl.uniform4fv(programInfo.uColorReg[i], toColorRegisterVec4(colorRegs[i]));
    }
  }
  for (let i = 0; i < programInfo.uKColor.length; i += 1) {
    if (programInfo.uKColor[i]) {
      gl.uniform4fv(programInfo.uKColor[i], toKColorVec4(material.tevColors?.[i]));
    }
  }
  for (let i = 0; i < MAX_TEV_TEXTURES; i += 1) {
    if (programInfo.uTex[i]) {
      gl.uniform1i(programInfo.uTex[i], i);
    }
    const textureRecord = textureRecords[i];
    if (!textureRecord) {
      continue;
    }
    const binding = bindings[i];
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, textureRecord.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, resolveGlWrap(gl, binding.wrapS));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, resolveGlWrap(gl, binding.wrapT));
  }
  if (programInfo.uAlpha) {
    gl.uniform1f(programInfo.uAlpha, Math.max(0, Math.min(1, alpha)));
  }
}

function drawPreparedPaneTevGpu(core, glState, preparedPane, chainAffine, metrics) {
  const { gl } = glState;
  const { pane, paneState, alpha } = preparedPane;
  const { eligible, material, bindings, textureRecords } = getTevGpuBindings(core, glState, pane, paneState);
  if (!eligible) {
    return false;
  }

  const signature = getTevMaterialSignature(material);
  const programInfo = getGeneratedTevProgram(gl, glState, signature);
  const verts = buildTevQuadVertices(core, preparedPane, chainAffine, metrics, bindings);
  if (!verts) {
    return false;
  }

  bindTevProgram(gl, glState, programInfo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
  setTevUniforms(gl, programInfo, core, pane, material, bindings, textureRecords, alpha);
  applyGlBlendState(gl, resolveGlBlendState(gl, material));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return true;
}

function warmSupportedTevPrograms(gl, glState, materials) {
  for (const material of materials ?? []) {
    if (isSupportedTevMaterial(material)) {
      getGeneratedTevProgram(gl, glState, getTevMaterialSignature(material));
    }
  }
}

function drawPreparedPaneGpu(core, glState, preparedPane, chainAffine, metrics) {
  const { gl } = glState;
  const { pane, paneState, alpha } = preparedPane;
  const { eligible, binding, textureRecord } = getDirectGpuBinding(core, glState, pane, paneState);
  if (!eligible) {
    return false;
  }

  const hasTexture = Boolean(binding && textureRecord);
  const signature = getBasicGxMaterialSignature({ hasTexture });
  const programInfo = getGeneratedMaterialProgram(gl, glState, signature);
  const verts = buildGpuQuadVertices(
    core,
    preparedPane,
    chainAffine,
    metrics.baseScaleX,
    metrics.baseScaleY,
    metrics.pixelWidth,
    metrics.pixelHeight,
    binding,
  );
  if (!verts) {
    return false;
  }

  bindGeneratedMaterialProgram(gl, glState, programInfo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
  if (hasTexture) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textureRecord.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, resolveGlWrap(gl, binding.wrapS));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, resolveGlWrap(gl, binding.wrapT));
    if (programInfo.uTex) {
      gl.uniform1i(programInfo.uTex, 0);
    }
  }
  if (programInfo.uMaterialColor) {
    gl.uniform4fv(programInfo.uMaterialColor, getPaneMaterialColor(core, pane, binding));
  }
  if (programInfo.uAlpha) {
    gl.uniform1f(programInfo.uAlpha, Math.max(0, Math.min(1, alpha)));
  }
  applyGlBlendState(gl, resolveGlBlendState(gl, core.layout?.materials?.[pane.materialIndex]));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return true;
}

// Rasterize a single pane's content (texture/TEV/vertex+material modulation, no
// pane alpha, no blend) into an offscreen canvas, reusing the tested Canvas draw
// methods. Returns the canvas, or null if nothing was drawn.
function rasterizePane(core, glState, pane, paneState) {
  const w = Math.max(1, Math.ceil(Math.abs(paneState.width)));
  const h = Math.max(1, Math.ceil(Math.abs(paneState.height)));
  const surface = glState.rasterCanvas;
  if (surface.width !== w || surface.height !== h) {
    surface.width = w;
    surface.height = h;
  }
  if (!glState.rasterCtx) {
    glState.rasterCtx = surface.getContext("2d", { willReadFrequently: false });
  }
  const ctx = glState.rasterCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.save();
  ctx.translate(w / 2, h / 2);

  // No 3D-seam padding: GL composites each pane as its own quad.
  core._seamPad = 0;

  if (pane.type === "pic1" || pane.type === "wnd1") {
    if (core.shouldUseTevPipeline(pane)) {
      const tev = core.runTevPipeline(pane, paneState, w, h);
      if (tev) {
        core.drawTevResult(ctx, tev, w, h);
        ctx.restore();
        return surface;
      }
    }
    const binding = core.getTextureBindingForPane(pane, paneState);
    if (binding) {
      core.drawPane(ctx, binding, pane, paneState, w, h);
    } else {
      core.drawVertexColoredPane(ctx, pane, paneState, w, h);
    }
  } else if (pane.type === "txt1") {
    core.drawTextPane(ctx, pane, w, h);
  }

  ctx.restore();
  return surface;
}

function glRenderFrame(core, glState, frame) {
  const { gl } = glState;
  const glCanvas = core._glCanvas;
  const prepared = core.prepareFrame(frame, glCanvas);
  const {
    layoutWidth,
    layoutHeight,
    outputWidth,
    outputHeight,
    pixelWidth,
    pixelHeight,
    baseScaleX,
    baseScaleY,
  } = prepared.metrics;

  if (glCanvas.width !== pixelWidth || glCanvas.height !== pixelHeight) {
    glCanvas.width = pixelWidth;
    glCanvas.height = pixelHeight;
  }
  if (glCanvas.style && !glCanvas.dataset?.noStyleResize) {
    glCanvas.style.width = `${outputWidth}px`;
    glCanvas.style.height = `${outputHeight}px`;
  }

  gl.viewport(0, 0, pixelWidth, pixelHeight);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const stats = {
    frame,
    preparedPanes: prepared.preparedPanes.length,
    drawablePanes: 0,
    tevGpuPanes: 0,
    directGpuPanes: 0,
    rasterCachedPanes: 0,
    rasterUploadedPanes: 0,
    textureCacheSize: core._glTextureCache?.size ?? 0,
    paneTextureCacheSize: core._glPaneTextureCache?.size ?? 0,
  };

  for (const preparedPane of prepared.preparedPanes) {
    const { pane, paneState, chainStates, originOffset, alpha, drawable } = preparedPane;
    if (!drawable) {
      continue;
    }
    stats.drawablePanes += 1;

    const chainAffine = buildChainAffine(
      chainStates,
      (state) => getProjectedTransform2D(core, state),
      layoutWidth,
      layoutHeight,
      originOffset,
    );

    const verts = buildQuadVertices(
      chainAffine,
      paneState.width,
      paneState.height,
      baseScaleX,
      baseScaleY,
      pixelWidth,
      pixelHeight,
    );

    if (drawPreparedPaneTevGpu(core, glState, preparedPane, chainAffine, prepared.metrics)) {
      stats.tevGpuPanes += 1;
      continue;
    }

    if (drawPreparedPaneGpu(core, glState, preparedPane, chainAffine, prepared.metrics)) {
      stats.directGpuPanes += 1;
      continue;
    }

    const w = Math.max(1, Math.ceil(Math.abs(paneState.width)));
    const h = Math.max(1, Math.ceil(Math.abs(paneState.height)));
    const rasterKey = buildPaneRasterCacheKey(core, pane, paneState, w, h);
    let cached = getCachedPaneTexture(core, rasterKey);
    if (!cached) {
      const surface = rasterizePane(core, glState, pane, paneState);
      if (!surface) {
        continue;
      }
      cached = setCachedPaneTexture(core, gl, rasterKey, surface);
      stats.rasterUploadedPanes += 1;
    } else {
      stats.rasterCachedPanes += 1;
    }

    bindBitmapProgram(gl, glState);
    gl.bindTexture(gl.TEXTURE_2D, cached.texture);
    gl.uniform1f(glState.uAlpha, Math.max(0, Math.min(1, alpha)));
    applyGlBlendState(gl, resolveGlBlendState(gl, core.layout?.materials?.[pane.materialIndex]));
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  stats.paneTextureCacheSize = core._glPaneTextureCache?.size ?? 0;
  core._glLastFrameStats = stats;

  // Reflect the rendered frame in onFrame-driven UI exactly like the Canvas path
  // (handled by core.applyFrame, which calls onFrame after renderFrame).
}

/**
 * Create a WebGL-backed banner renderer. Same signature & API as BannerRenderer.
 * Throws if WebGL is unavailable (caller should fall back to BannerRenderer).
 */
export function createGlBannerRenderer(glCanvas, layout, anim, tplImages, options = {}) {
  // Core drives everything on an offscreen 2D canvas; the visible canvas is GL.
  const offscreen = document.createElement("canvas");
  offscreen.width = 1;
  offscreen.height = 1;
  if (offscreen.dataset) {
    offscreen.dataset.noStyleResize = "1";
  }

  const core = new BannerRenderer(offscreen, layout, anim, tplImages, options);
  const glState = buildGlState(glCanvas);

  core._glCanvas = glCanvas;
  core._glState = glState;
  core._glTextureCache = uploadTplTextures(glState.gl, tplImages);
  core._glPaneTextureCache = new Map();
  core._glPaneTextureCacheLimit = Number.isFinite(options.glPaneTextureCacheLimit)
    ? Math.max(16, Math.floor(options.glPaneTextureCacheLimit))
    : 96;
  core.backend = "webgl";
  warmSupportedTevPrograms(glState.gl, glState, core.layout?.materials);

  // Replace the Canvas draw step with the GL path. core.applyFrame() calls
  // this.renderFrame(this.frame) then this.onFrame(...), so playback, seeking,
  // GSAP timeline and start-frame handling all flow through unchanged.
  core.renderFrame = function renderFrameGl(f) {
    glRenderFrame(this, glState, f);
  };

  const baseDispose = core.dispose.bind(core);
  core.dispose = function disposeGlRenderer() {
    for (const entry of this._glPaneTextureCache.values()) {
      if (entry?.texture) {
        glState.gl.deleteTexture(entry.texture);
      }
    }
    this._glPaneTextureCache.clear();
    deleteTextureMap(glState.gl, this._glTextureCache);
    baseDispose();
  };

  // Note: dispose does NOT delete the GL program/buffers or lose the context.
  // Those are cached on the canvas (see buildGlState) and reused when the renderer
  // is re-created on the same canvas (e.g. a settings change). The GPU resources
  // are released by the browser when the canvas element is unmounted/GC'd (which
  // happens on a backend switch, since the canvas is keyed on rendererBackend).
  return core;
}
