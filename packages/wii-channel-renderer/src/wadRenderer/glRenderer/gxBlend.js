// Map a GX/BRLYT material blend mode to WebGL blend state.
//
// GX equation: final = (Source × srcFactor) <op> (Destination × dstFactor).
// Our pane textures are straight-alpha (uploaded with UNPACK_PREMULTIPLY_ALPHA
// off), and the fragment shader outputs straight alpha (tex.rgb, tex.a*paneAlpha),
// so SRCALPHA/INVSRCALPHA reproduces normal "over". This covers the common modes
// exactly and approximates the rare ones (logic op) with normal alpha blending.

// GX blend factor (3-bit) → GL factor. The "color" factors 2/3 are the OTHER
// operand's color (the classic GX alias), so they differ by slot.
function srcFactorToGL(gl, f) {
  switch (f & 0x7) {
    case 0: return gl.ZERO;
    case 1: return gl.ONE;
    case 2: return gl.DST_COLOR;            // SRCCLR in src slot = dst color
    case 3: return gl.ONE_MINUS_DST_COLOR;  // INVSRCCLR in src slot
    case 4: return gl.SRC_ALPHA;
    case 5: return gl.ONE_MINUS_SRC_ALPHA;
    case 6: return gl.DST_ALPHA;
    case 7: return gl.ONE_MINUS_DST_ALPHA;
    default: return gl.SRC_ALPHA;
  }
}

function dstFactorToGL(gl, f) {
  switch (f & 0x7) {
    case 0: return gl.ZERO;
    case 1: return gl.ONE;
    case 2: return gl.SRC_COLOR;            // (DSTCLR alias) in dst slot = src color
    case 3: return gl.ONE_MINUS_SRC_COLOR;
    case 4: return gl.SRC_ALPHA;
    case 5: return gl.ONE_MINUS_SRC_ALPHA;
    case 6: return gl.DST_ALPHA;
    case 7: return gl.ONE_MINUS_DST_ALPHA;
    default: return gl.ONE_MINUS_SRC_ALPHA;
  }
}

// Returns { enabled, equation, srcRGB, dstRGB, srcA, dstA }.
// Alpha is accumulated as coverage (srcA=ONE, dstA=ONE_MINUS_SRC_ALPHA) so the
// canvas's own alpha channel stays meaningful for transparent-page compositing.
export function resolveGlBlendState(gl, material) {
  const standard = {
    enabled: true,
    equation: gl.FUNC_ADD,
    srcRGB: gl.SRC_ALPHA,
    dstRGB: gl.ONE_MINUS_SRC_ALPHA,
    srcA: gl.ONE,
    dstA: gl.ONE_MINUS_SRC_ALPHA,
  };

  const bm = material?.blendMode;
  if (!bm) {
    return standard;
  }

  // func 0 = blending disabled → replace (overwrite destination).
  if (bm.func === 0) {
    return { enabled: false };
  }

  // func 3 = subtract: dst - src, factors ignored on hardware.
  if (bm.func === 3) {
    return {
      enabled: true,
      equation: gl.FUNC_REVERSE_SUBTRACT,
      srcRGB: gl.ONE,
      dstRGB: gl.ONE,
      srcA: gl.ONE,
      dstA: gl.ONE,
    };
  }

  // func 2 = logic op: not expressible in WebGL blend; approximate with "over".
  if (bm.func === 2) {
    return standard;
  }

  // func 1 = add (the normal blend path): honor src/dst factors.
  return {
    enabled: true,
    equation: gl.FUNC_ADD,
    srcRGB: srcFactorToGL(gl, bm.srcFactor),
    dstRGB: dstFactorToGL(gl, bm.dstFactor),
    srcA: gl.ONE,
    dstA: gl.ONE_MINUS_SRC_ALPHA,
  };
}

export function applyGlBlendState(gl, state) {
  if (!state.enabled) {
    gl.disable(gl.BLEND);
    return;
  }
  gl.enable(gl.BLEND);
  gl.blendEquation(state.equation);
  gl.blendFuncSeparate(state.srcRGB, state.dstRGB, state.srcA, state.dstA);
}
