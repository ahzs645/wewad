# Tier 2 — WebGL TEV Renderer Migration Plan

Plan for replacing the Canvas-2D pane compositor with a WebGL TEV pipeline, the
approach every faithful Wii layout renderer uses (Dolphin, `wii-banner-player`,
noclip.website). See `TRANSPARENCY_RENDERING_RESEARCH.md` for the research this
is based on.

## Status

- **Done — swappable backend (v1).** A WebGL backend exists and is selectable in
  the Preview tab ("Renderer" dropdown, default Canvas). It reuses the tested
  Canvas pipeline to rasterize each pane (including the TEV evaluator) and uses
  WebGL only for geometry placement and **exact GX blend compositing**
  (`packages/.../glRenderer/`: `createGlBannerRenderer.js`, `paneGeometry.js`,
  `gxBlend.js`). Geometry math is unit-tested against the Canvas transform; the
  draw loop is smoke-tested end-to-end. Note: actual GPU output needs in-browser
  validation — it could not be run in CI (no GPU/display).
- **Next — in-shader TEV (v2).** Move the per-pane TEV combine into a GLSL
  fragment shader (below) so multi-texture/konst/compare/indirect render on the
  GPU and the per-frame Canvas raster + texture upload per pane goes away.

## Why

Canvas-2D compositing is a fixed Porter-Duff + blend-mode enum (W3C spec). A GX
TEV stage is a programmable per-pixel combiner (`out = d + (1-c)·a + c·b`, then
bias/scale/clamp, with up to 16 chained stages, multi-texture inputs, konst/color
registers, alpha-test `discard`, and blend factors Canvas can't express such as
subtract, logic-op, and dual-source/dest-alpha). Our Canvas path approximates
this with offscreen surfaces and per-pixel JS loops — which is both **incomplete**
(it can't express many TEV/blend configs) and **slow** (the per-pixel evaluator is
the main source of playback lag). A WebGL TEV shader makes effects like the Wii
Shop mask/light backdrop "just work" and moves the cost to the GPU.

## What stays vs. changes

Keep (no GPU needed, already correct):
- WAD/U8/IMET parsing, decompression, `parseBRLYT` / `parseBRLAN` / `parseTPL`.
- TPL decode to RGBA (verified correct, incl. CMPR 1-bit alpha & RGB5A3).
- Animation sampling (`paneAnimValues.js`, `animations.js`) — produces per-frame
  pane transforms, vertex colors, material colors, texture SRT/pattern.
- Layout/transform math, pane tree, group/state/locale resolution.

Replace:
- The pane draw path (`paneDrawMethods.js`, `textureDrawMethods.js`,
  `colorModulationMethods.js`, `lumaEffectMethods.js`, `tevMethods.js`,
  `tevEvaluator.js`) → a WebGL renderer that uploads textures once and draws each
  pane as a textured quad with a generated/uber TEV fragment shader.

## Architecture (mirror noclip's `Common/NW4R/lyt` + `gx`)

1. **GL context & resources.** Create one `WebGL2RenderingContext` on the target
   canvas (premultiplied alpha, `preserveDrawingBuffer` only if needed for PNG
   export). Upload each decoded TPL to a `WebGLTexture` once (respect wrap S/T and
   the texture SRT via a 2x3 matrix uniform). Cache by texture name.

2. **Material → shader.** Translate each material to a TEV program:
   - Start from the parsed stages; for **0 stages** synthesize the NW4R default
     (`lerp(C0,C1,tex)` then `× vertexColor`, chained alpha) — already encoded in
     `getDefaultTevStages()`.
   - Emit GLSL implementing each stage's `a/b/c/d` inputs (TEXC/TEXA, RASC/RASA,
     C0–C2, K0–K3, CPREV/APREV), the `d + (1-c)·a + c·b` combine, bias∈{0,±.5},
     scale∈{1,2,4,.5}, clamp, and `regId` output.
   - Emit the alpha-test as `if(!(cmp0 op cmp1)) discard;` (GX compare funcs +
     AND/OR/XOR/XNOR).
   - **Two options:** (a) generate+cache one shader per unique material signature
     (fast at steady state, compile stutter on first sight), or (b) a single
     "ubershader" that reads stage config from uniforms/UBO (no stutter, slightly
     slower per pixel). Start with (a) keyed by a material signature string; it's
     simpler and our material count per banner is small (≈30–40).

3. **Blend & write state (GPU state, not shader).** Map `GX_SetBlendMode` to
   `gl.blendFunc`/`blendEquation` with the GX factor remapping (note `SRCCLR`/
   `INVSRCCLR` → Dst/OneMinusDst on the source side). `SUBTRACT` →
   `FUNC_REVERSE_SUBTRACT`. `LOGIC` → log+fallback to `(ONE,ZERO)` (rare; noclip
   skips it). Honor color/alpha write masks (`GX_SetColorUpdate`/`AlphaUpdate`).

4. **Per-pane draw.** Recurse the pane tree back-to-front. Compute the pane's
   model matrix (translate/rotate/scale + 3D perspective we already support).
   Apply **pane-alpha inheritance**: `childAlpha = propagateAlpha ? parent*self :
   parent`; fold `alpha` into vertex-color alpha and material color alpha. Emit a
   quad with the 4 corner positions, per-corner vertex colors, and texcoords; set
   the material's shader + uniforms (C0–C2, K0–K3, MAT0, texture SRT) + blend
   state; `drawArrays`. Windows (`wnd1`) = content quad inset by border padding +
   frame quads (with UV flip/swap), same as today.

5. **Output.** Render straight to the visible canvas. For PNG export, render to an
   FBO / read back with `readPixels` (or draw the GL canvas onto a 2D canvas).

## Suggested file layout (in `packages/wii-channel-renderer/src/wadRenderer/glRenderer/`)

- `glContext.js` — context, texture cache, quad VAO/VBO, FBO helpers.
- `gxShaderGen.js` — material → GLSL TEV program + cache (the core).
- `gxBlend.js` — GX blend/alpha-compare → GL state translation table.
- `GlBannerRenderer.js` — public class mirroring `BannerRenderer`'s API
  (`constructor(canvas, layout, anim, tplImages, options)`, `play/stop/seekToFrame/
  applyFrame/dispose`, `onFrame`) so `App.jsx`, `gsapExport.js`, and
  `bundleRenderer.js` switch with minimal changes.
- Reuse existing parsing + `paneAnimValues`/`animations` unchanged.

## Migration strategy (incremental, low-risk)

1. Land `GlBannerRenderer` behind a flag (e.g. `options.backend: "webgl" | "canvas"`,
   or a "Renderer" dropdown next to the Performance one). Default stays Canvas
   until parity is confirmed.
2. Bring up in stages, diffing against the Canvas renderer per frame on a corpus
   of WADs (the headless `@napi-rs/canvas` harness can be swapped for `headless-gl`
   / `gl` npm pkg, or compare in-browser):
   - a) opaque single-texture panes (no blend) → verify geometry/UV/transform.
   - b) vertex-color modulate + alpha → verify the white-square tinting idiom.
   - c) material C0/C1 + konst + multi-stage TEV → verify Wii Shop logo/lights.
   - d) blend modes + alpha test → verify the mask/backdrop and cutouts.
   - e) text panes (BRFNT) and windows.
3. Once parity holds across the WAD corpus, flip the default to WebGL and keep
   Canvas as a fallback for environments without WebGL2.
4. Retire `enableWiiShopBackdropMask` — it becomes unnecessary once TEV+blend+
   draw-order are correct.

## Risks / notes

- **Dual-source / dest-alpha blend** is the known hard case (Dolphin falls back to
  in-shader blending via a second color output or framebuffer-fetch). Rare in
  banners; implement the common factors first, log+approximate the rest.
- **Shader compile stutter** with per-material shaders on first frame — pre-warm by
  compiling all materials at load, or use the ubershader option.
- **PNG export path** must read back from GL; keep the Canvas renderer available
  for export if simpler initially.
- WebGL2 is broadly available; provide the Canvas fallback for the rare miss.

## Reference implementations to mirror

- noclip.website: `src/Common/NW4R/lyt/Layout.ts`, `src/gx/gx_material.ts`
  (GX→GLSL incl. alpha-test discard), `src/gx/gx_render.ts` (blend→GL state).
- wii-banner-player: `Source/WrapGx.cpp` (GX-on-OpenGL GLSL TEV gen),
  `Material.cpp`, `Pane.cpp`.
- Dolphin: `Source/Core/VideoCommon/PixelShaderGen.cpp` (combine + alpha test);
  Ubershaders blog for the single-shader interpreter approach.
