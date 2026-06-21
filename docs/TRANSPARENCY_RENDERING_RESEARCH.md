# Wii Banner/Icon Transparency & Masking — Research and Fix Plan

Research into why panes that should be transparent/blended (e.g. the Wii Shop
Channel `mask_01` backdrop and the `CL*` "light" panes) render as opaque white in
our Canvas-2D renderer, and how the reference implementations solve it.

## TL;DR

1. **A material with ZERO TEV stages is NOT a texture passthrough.** NW4R
   synthesizes a default combiner. For one texture it is:
   ```
   outColor = lerp(C0, C1, textureColor) × vertexColor
   outAlpha = lerp(A0, A1, textureAlpha) × vertexAlpha × paneAlpha
   ```
   where **C0 = material `color1` (fore / "black color")** and
   **C1 = material `color2` (back / "white color")**. With no texture the output
   is just `C1`, then `× vertexColor`.
   Our renderer instead draws the **raw texture** for 0-stage materials (modulating
   only when `color2`/vertex are non-white). That is the root correctness gap.

2. **The Wii Shop "mask + colored lights behind the logo" is not a special
   feature.** It is an *emergent* result of correct **TEV combine + per-material
   blend mode + alpha test + pane-alpha inheritance + back-to-front draw order**.
   No reference renderer special-cases it. Our hand-rolled
   `enableWiiShopBackdropMask` is an approximation of a mechanism that should fall
   out of the pipeline for free.

3. **No faithful renderer uses Canvas 2D.** Dolphin, `wii-banner-player`, and
   noclip.website all **generate GPU fragment shaders** for the TEV combiner.
   Canvas 2D compositing is a fixed Porter-Duff + blend-mode enum (W3C spec) and
   structurally cannot express a TEV stage (`a*(1-c)+b*c ± d` with arbitrary
   inputs, multi-texture, alpha-test `discard`, dual-source/dest-alpha blend).
   Editor tools (LayoutStudio, BrawlCrate) deliberately skip TEV with a simplified
   quad+alpha path — which approximates simple banners but gets Wii-Shop-style
   mask/light effects wrong. **That is exactly our situation.**

4. Our **TPL decode is fine** — verified by hands-on test (CMPR `tentative_Wiishop`
   decodes 75% transparent; `WiiShopCh_Text_*` carry proper alpha). Transparency is
   lost in the *compositing/TEV* step, not in texture decode.

## The authoritative TEV / layout model

A layout (`brlyt`) material is a serialized GX TEV configuration. Final pixel:

1. Texgen → texcoords (apply 2D texture SRT).
2. Texture lookup → `TEXC`/`TEXA`.
3. Rasterized color `RASC`/`RASA` = interpolated per-corner **vertex color**
   (4 corners TL/TR/BL/BR, each RGBA) — *or* the material color (`MAT0`),
   selected by the material's **Channel Control** (separately for color and
   alpha; default = vertex color).
4. **TEV stages** run in order, each computing
   `out = (d + ((1-c)*a + c*b)) <op,bias,scale>` (clamped) into
   `TEVPREV`/`C0..C2`. Inputs draw from `TEXC/TEXA`, `RASC/RASA`,
   registers `C0–C2` (= `color1`/`color2`/`tevREG3`), konst `K0–K3`,
   and `CPREV/APREV`.
5. **Pane alpha** is folded in *before* TEV: it multiplies the corner vertex
   alpha (→ `RASA`) and the material color alpha (`MAT0`). Pane alpha also
   **cascades down the tree**: `childAlpha = propagateAlpha ? parent*self : parent`.
6. **Alpha compare** (`GX_SetAlphaCompare`) discards pixels (hard cutouts), then
   **blend** (`GX_SetBlendMode`) composites.

### Zero-stage default, verbatim from noclip (`Layout.ts`)

```js
if (tevStageCount === 0) {
  if (samplerCount === 0) {                 // no texture
    setTevColorIn(s, ZERO, ZERO, ZERO, C1); // = C1
    setTevAlphaIn(s, ZERO, ZERO, ZERO, A1);
    vertexColorEnabled = true;
  } else if (samplerCount === 1) {          // one texture
    setTevColorIn(s, C0, C1, TEXC, ZERO);   // = lerp(C0, C1, TEXC)
    setTevAlphaIn(s, A0, A1, TEXA, ZERO);
  }
  // always: modulate by vertex color
  setTevColorIn(s+1, ZERO, CPREV, RASC, ZERO); // = CPREV * RASC
  setTevAlphaIn(s+1, ZERO, APREV, RASA, ZERO); // = APREV * RASA
}
```

Confirmed identical in `wii-banner-player`'s `Material.cpp` (raw enum integers
decoded against libogc), and consistent with the GX hardware default
`GX_SetTevOp(GX_MODULATE)` = `Cv = Cr·Ct`, `Av = Ar·At` (libogc `gx.c`).

### GX blend factor → Canvas-2D compositing (approximation table)

| GX src | GX dst | equation | Canvas-2D `globalCompositeOperation` |
|---|---|---|---|
| SRCALPHA | INVSRCALPHA | `src·a + dst·(1-a)` | `source-over` (normal) |
| ONE | INVSRCALPHA | premultiplied over | `source-over` |
| ONE | ONE | `src + dst` | `lighter` (additive) |
| ZERO | SRCCLR* | `dst·src` | `multiply` (approx) |
| ZERO | INVSRCALPHA | `dst·(1-a)` | `destination-out` (mask erase) |
| ZERO | SRCALPHA | `dst·a` | `destination-in` (mask keep) |
| ONE | ZERO | `src` | `copy` |
| SUBTRACT (type) | — | `dst - src` clamped | **no Canvas equiv** (needs WebGL `FUNC_REVERSE_SUBTRACT` or per-pixel) |
| LOGIC (type) | — | bitwise rop | **no Canvas equiv** |

\* GX factor `SRCCLR`/`INVSRCCLR` mean "the *other* operand's color" — on the
source side they map to `Dst`/`OneMinusDst`. Classic GX quirk.

**Alpha test** (`discard`) and **subtract/logic** blend have **no Canvas-2D
equivalent** — they require a fragment shader (or `getImageData` CPU loops).

## How this maps to our code

- `paneDrawMethods.js drawPane()`: for a 0-stage material with both vertex- and
  material-modulation trivial, it calls `drawPaneTexture()` → **raw texture**.
  Correct behavior is `lerp(C0,C1,tex) × vtxColor` (+ chained alpha). Coincidentally
  ~right when `color1=(0,0,0,0)` & `color2=(255,255,255,255)`, wrong otherwise.
- `colorModulationMethods.js getPaneMaterialColorModulation()`: uses **only
  `color2` (C1)** as a plain multiply tint. It ignores `color1` (C0) entirely and
  never does the texture-driven `lerp(C0,C1,tex)`.
- `tevMethods.js shouldUseTevPipeline()`: returns false when there are no explicit
  stages, so **0-stage materials never reach the per-pixel TEV path** (which does
  have a `getModulateTevStages()` fallback that is currently unreachable for them).
- `resolveBlendCompositeOp()`: a reasonable but partial GX→Canvas blend map; no
  alpha-test, no subtract/logic, no dual-source/dest-alpha.

## Fix plan

### Tier 1 — Canvas-2D correctness (incremental, no architecture change)
1. **Implement the NW4R 0-stage default** in the heuristic path: when a material
   has 0 explicit TEV stages, render `lerp(C0, C1, texColor) × vtxColor` with
   `outAlpha = lerp(A0, A1, texAlpha) × vtxAlpha × paneAlpha`, instead of raw
   texture. The existing offscreen `paneCompositeSurface` machinery can host this
   (compute via per-pixel pass, or via `multiply`/`screen` composites for the
   common `C0≈0 / C1≈white` case).
2. **Use C0 (color1), not just C1 (color2)** in material color modulation; do the
   texture-driven lerp rather than a flat multiply.
3. **Route 0-stage materials through the existing `getModulateTevStages()` path**
   so the per-pixel TEV evaluator (which can already do `lerp + multiply`) handles
   them, instead of the raw-texture shortcut.
4. **Add an alpha-test approximation** (threshold alpha to 0/255 per
   `GX_SetAlphaCompare`) and round out the blend-mode map.

This fixes color/alpha for many panes and likely most of the "not transparent"
cases, but will remain an approximation for multi-texture / subtract / dual-source.

### Tier 2 — WebGL TEV (the real fix; what every faithful renderer does)
Port pane compositing to WebGL with a generated TEV fragment shader, mirroring
noclip's `Layout.ts` + `gx_material.ts`: parse material → `GXMaterial`, generate
GLSL for the stages (lerp/bias/scale/clamp, konst, alpha-test `discard`), set
blend/logic as GPU state with the GX factor remapping, implement `propagateAlpha`
inheritance, draw back-to-front. The Wii-Shop mask/light effect then renders
correctly as a consequence of the pipeline — no special `enableWiiShopBackdropMask`
code needed. Bonus: it also removes the software-rendering lag.

## Sources

- noclip.website NW4R layout renderer: https://github.com/magcius/noclip.website/blob/main/src/Common/NW4R/lyt/Layout.ts
- noclip GX→GLSL TEV + alpha test: https://github.com/magcius/noclip.website/blob/main/src/gx/gx_material.ts
- noclip GX blend→GPU state (SRCCLR quirk): https://github.com/magcius/noclip.website/blob/main/src/gx/gx_render.ts
- wii-banner-player (GX-on-OpenGL, GLSL TEV): https://github.com/Tilka/wii-banner-player (`Source/WrapGx.cpp`, `Material.cpp`, `Pane.cpp`)
- Dolphin TEV pixel-shader gen + Ubershaders writeup: https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/VideoCommon/PixelShaderGen.cpp · https://dolphin-emu.org/blog/2017/07/30/ubershaders/
- LayoutStudio (simplified, no-TEV editor): https://github.com/Treeki/LayoutStudio
- libogc GX (`GX_SetTevOp`, blend/alpha enums): https://github.com/devkitPro/libogc/blob/master/gc/ogc/gx.h · https://github.com/devkitPro/libogc/blob/master/libogc/gx.c
- BRLYT format (channel control, vertex/material colors, TEV): https://wiki.tockdom.com/wiki/BRLYT_(File_Format)
- BRLAN targets (RLVC/RLMC color+alpha, RLPA, RLTP): https://wiki.tockdom.com/wiki/BRLAN_(File_Format)/Targets
- HackMii "The Elusive Banner" (banner internals, alpha masks): https://hackmii.com/2008/05/the-elusive-banner/
- WiiBrew opening.bnr / Wii Animations: https://wiibrew.org/wiki/Opening.bnr · https://wiibrew.org/wiki/Wii_Animations
- YAGCD GX pixel engine + CMPR: https://www.gc-forever.com/yagcd/chap5.html · https://www.gc-forever.com/yagcd/chap17.html
- CMPR/DXT1 1-bit alpha rule: https://learn.microsoft.com/en-us/windows/win32/direct3d9/opaque-and-1-bit-alpha-textures · https://en.wikipedia.org/wiki/S3_Texture_Compression
- Canvas 2D compositing is a fixed set (spec): https://www.w3.org/TR/compositing-1/ · https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation
