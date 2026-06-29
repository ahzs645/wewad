# Wii Shop-style RSO icon carousel

## Problem

The Wii Shop Channel icon (and other RSO-authored channels) did not loop like the
real System Menu. Decompiling `meta/icon.bin` shows the icon is **not** a single
looping animation — it ships **16 group-bound animations** `icon_Rso0.brlan` …
`icon_Rso15.brlan` plus 16 matching `icon.brlyt` groups `Rso0..Rso15`, forming a
**4-slot "recommended titles" carousel** (4 slots × 4 layered sub-animations:
logo/title/bg, recommendation image+caption, inner card, card).

`icon_Rso0` is a *conductor*: its keyframes span 0–~78000 on a lattice where each
slot is keyed at roughly `K × 20000`, but only slot 0 carries real low-frame
(~0–650) motion; the rest are held "state markers". The real Wii composes the 16
animations with a System Menu sequencer (and pulls the rotating title content from
a WiiConnect24 `csdf` dynamic-banner blob that is **not** in the WAD).

### What the renderer used to do

- `inferAnimationRole` only recognised `start`/`loop`/`_in` names, so all 16
  `Rso*` files were `generic`.
- The package then kept only the **largest** brlan (`icon_Rso0`) and the app
  looped the `RSO0` state (merged with `RSO1–3`) at its authored `frameSize 5000`.
- Real motion only exists in frames 0–650, so the icon revealed slot 0, then sat
  on a long **static dead-hold** to frame 5000, then looped — and slots 1–3 never
  animated.

## Fix

References: Nintendo *Icon and Banner Specifications* (60 fps, Start→Loop);
`giantpune/wii-system-menu-player` `Banner.cpp` (start = `_Start → _In → _Rso0`,
loop = bare → `_Loop → _Rso1`); NW4R `nw4r::lyt` (`BindAnimationAuto`, host-driven
frame counter, clamped curve sampling).

### Package (`@firstform/wii-channel-renderer`)

- **Role recognition** (`pipeline/resourceExtraction.js`): `_Rso0` → `start`,
  `_Rso1` → `loop`, matching the banner player's fallback chains. `_Rso2..N`
  stay `generic`.
- **Dead-hold trim**: the RSO `start`/`loop` animations are tightened to their
  active content range so neither phase sits on clamped state-marker values
  (e.g. `Rso0` 5000 → ~660; `Rso1` keeps 12000, which is real dwell).
- **`disableRenderStateFilter` option** (`BannerRendererImpl` + `stateMethods`):
  bypasses the single-active-render-state visibility filter so the carousel can
  drive panes across all RSO state groups at once.

Standalone integrators now get the documented reference behaviour: play `Rso0`
once as the intro, then loop `Rso1`.

### App (`src/`)

- **`buildRsoCarousel(targetResult)`** (`utils/renderState.js`) reconstructs the
  4-slot carousel as **one looping animation**: it builds each slot's composite
  (base `Rso(4N)` + aux `Rso(4N+1..4N+3)` via `mergeRelatedRsoAnimations`),
  time-shifts each slot's real motion into its own window, drops the
  beyond-`frameSize` state markers, and adds step-visibility (`RLVI`) gates so
  each slot shows only during its window. Returns `null` for any non-carousel
  layout, so other channels are unaffected.
- `App.jsx` selects the carousel for the icon when the user hasn't pinned a
  specific RSO state / animation and isn't customising weather, and passes
  `disableRenderStateFilter`.
- `resolveAnimationSelection` (`utils/animation.js`) otherwise prefers a distinct
  `animLoop` (`Rso1`) over re-looping the `RSO0` state.

## Tuning (needs visual confirmation)

The real per-slot cadence is undocumented and the title content is external
(WiiConnect24), so the timing is a best-effort reconstruction. Constants in
`utils/renderState.js`:

- `CAROUSEL_REVEAL_CAP` (default 4000) — keyframes at/after this are treated as
  state markers and dropped.
- `CAROUSEL_DWELL_FRAMES` (default 150) — extra hold after each slot's reveal.
- `CAROUSEL_MIN_SLOT_FRAMES` (default 120) — floor on slot duration.

With the real Wii Shop icon this yields 4 slots × stride 1150 = 4600 frames
(≈77 s at the app's 60 fps; ≈19 s/slot). Lower the constants for a snappier
cycle. Known limitation: the nested `N_title_0N` title containers are not
hard-gated (gating an ancestor would hide other slots' titles), so title
visibility relies on each slot's alpha reveal.
