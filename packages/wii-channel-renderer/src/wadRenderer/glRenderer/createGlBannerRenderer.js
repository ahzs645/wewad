// WebGL banner backend (swappable with the Canvas-2D BannerRenderer).
//
// Design: reuse the *tested* Canvas pipeline for everything (parsing, animation
// sampling, per-pane state, and per-pane rasterization incl. the TEV evaluator),
// and use WebGL only for geometry placement and exact GX blend compositing of the
// resulting pane bitmaps. This is safe-by-construction — it can't render a pane's
// content more wrongly than the Canvas backend — while giving correct GX blend
// equations (additive/subtract/dest-alpha) that Canvas globalCompositeOperation
// only approximates. Full in-shader TEV is the documented next increment
// (docs/WEBGL_TEV_MIGRATION_PLAN.md).
//
// Returns a BannerRenderer instance whose draw step is replaced with the GL path,
// so it is API-compatible (play/stop/seekToFrame/applyFrame/dispose/…).

import { BannerRenderer } from "../BannerRenderer.js";
import { getProjectedTransform2D } from "../bannerRenderer/transformMethods.js";
import { buildChainAffine, buildQuadVertices, resolveChainAlphaVisibility } from "./paneGeometry.js";
import { resolveGlBlendState, applyGlBlendState } from "./gxBlend.js";

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
  const gl = createGlContext(glCanvas);
  const program = createProgram(gl);
  const quadBuffer = gl.createBuffer();
  const texture = gl.createTexture();

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

  return {
    gl,
    program,
    quadBuffer,
    texture,
    aPos: gl.getAttribLocation(program, "aPos"),
    aUV: gl.getAttribLocation(program, "aUV"),
    uTex: gl.getUniformLocation(program, "uTex"),
    uAlpha: gl.getUniformLocation(program, "uAlpha"),
    // Offscreen 2D surface used to rasterize each pane via the Canvas pipeline.
    rasterCanvas: document.createElement("canvas"),
    rasterCtx: null,
  };
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
  core.textureSrtAnimationCache.clear();

  const layoutWidth = core.layout.width || glCanvas.clientWidth || glCanvas.width;
  const layoutHeight = core.layout.height || glCanvas.clientHeight || glCanvas.height;
  const referenceAspect = Number.isFinite(core.referenceAspectRatio) && core.referenceAspectRatio > 0
    ? core.referenceAspectRatio
    : 4 / 3;
  const displayAspect = Number.isFinite(core.displayAspectRatio) && core.displayAspectRatio > 0
    ? core.displayAspectRatio
    : null;
  const displayScaleX = displayAspect ? displayAspect / referenceAspect : 1;
  const outputWidth = layoutWidth * displayScaleX;
  const outputHeight = layoutHeight;
  const dpr = Math.min(Math.max(1, globalThis.devicePixelRatio || 1), core.maxDevicePixelRatio ?? Infinity);
  const pixelWidth = Math.max(1, Math.round(outputWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(outputHeight * dpr));

  if (glCanvas.width !== pixelWidth || glCanvas.height !== pixelHeight) {
    glCanvas.width = pixelWidth;
    glCanvas.height = pixelHeight;
  }
  if (glCanvas.style && !glCanvas.dataset?.noStyleResize) {
    glCanvas.style.width = `${outputWidth}px`;
    glCanvas.style.height = `${outputHeight}px`;
  }

  const baseScaleX = dpr * displayScaleX;
  const baseScaleY = dpr;

  gl.viewport(0, 0, pixelWidth, pixelHeight);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(glState.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, glState.texture);
  gl.uniform1i(glState.uTex, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, glState.quadBuffer);
  gl.enableVertexAttribArray(glState.aPos);
  gl.enableVertexAttribArray(glState.aUV);
  gl.vertexAttribPointer(glState.aPos, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(glState.aUV, 2, gl.FLOAT, false, 16, 8);

  // Resolve all local pane states (same as Canvas renderFrame).
  const localPaneStates = core.localPaneStates;
  localPaneStates.clear();
  for (const p of core.allPanes) {
    localPaneStates.set(p, core.getLocalPaneState(p, frame));
  }
  const getState = (p) => localPaneStates.get(p);

  const ordered = core.activeRenderablePanes ?? core.renderablePanes;
  for (const pane of ordered) {
    const paneState = localPaneStates.get(pane);
    if (!paneState) {
      continue;
    }

    const chain = core.getPaneTransformChain(pane);
    const { alpha, visible } = resolveChainAlphaVisibility(chain, getState, pane);
    if (!visible || alpha <= 0) {
      continue;
    }
    if (!(Math.abs(paneState.width) > 1e-6) || !(Math.abs(paneState.height) > 1e-6)) {
      continue;
    }

    const chainStates = chain.map(getState).filter(Boolean);
    const originOffset = core.getPaneOriginOffset(pane, paneState.width, paneState.height);
    const chainAffine = buildChainAffine(
      chainStates,
      (state) => getProjectedTransform2D(core, state),
      layoutWidth,
      layoutHeight,
      originOffset,
    );

    const surface = rasterizePane(core, glState, pane, paneState);
    if (!surface) {
      continue;
    }

    const verts = buildQuadVertices(
      chainAffine,
      paneState.width,
      paneState.height,
      baseScaleX,
      baseScaleY,
      pixelWidth,
      pixelHeight,
    );

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, surface);
    gl.uniform1f(glState.uAlpha, Math.max(0, Math.min(1, alpha)));
    applyGlBlendState(gl, resolveGlBlendState(gl, core.layout?.materials?.[pane.materialIndex]));
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

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
  core.backend = "webgl";

  // Replace the Canvas draw step with the GL path. core.applyFrame() calls
  // this.renderFrame(this.frame) then this.onFrame(...), so playback, seeking,
  // GSAP timeline and start-frame handling all flow through unchanged.
  core.renderFrame = function renderFrameGl(f) {
    glRenderFrame(this, glState, f);
  };

  const originalDispose = core.dispose.bind(core);
  core.dispose = function disposeGl() {
    originalDispose();
    try {
      const { gl } = glState;
      gl.deleteTexture(glState.texture);
      gl.deleteBuffer(glState.quadBuffer);
      gl.deleteProgram(glState.program);
      const loseCtx = gl.getExtension("WEBGL_lose_context");
      if (loseCtx) {
        loseCtx.loseContext();
      }
    } catch {
      // best-effort GPU cleanup
    }
  };

  return core;
}
