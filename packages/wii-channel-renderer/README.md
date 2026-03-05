# @firstform/wii-channel-renderer

Standalone Wii channel rendering engine extracted from WeWAD.

It parses `.wad` / `.arc` assets and renders Wii banner/icon animations to Canvas 2D, including BRLYT/BRLAN/TPL support and animation playback.

## Install

```bash
npm install @firstform/wii-channel-renderer
```

## What you get

- `processWAD(buffer, logger?)`: Parse a WAD and extract renderable banner/icon data.
- `processArchive(buffer, logger?)`: Parse a raw U8/ARC archive.
- `processZipBundle(buffer, logger?)`: Parse a ZIP of renderer resources or ARC files.
- `BannerRenderer`: Draw + animate parsed layouts on canvas.
- `parse*` utilities (`parseWAD`, `parseU8`, `parseBRLYT`, `parseBRLAN`, `parseTPL`, ...).

## Basic usage

```js
import { processWAD, BannerRenderer } from "@firstform/wii-channel-renderer";

const wadBytes = await file.arrayBuffer();
const parsed = await processWAD(wadBytes);

const banner = parsed.results.banner;
const icon = parsed.results.icon;

if (banner) {
  const canvas = document.getElementById("banner");
  const layout = banner.renderLayout;
  const startAnim = banner.animStart ?? null;
  const loopAnim = banner.animLoop ?? banner.anim;

  canvas.width = layout.width;
  canvas.height = layout.height;

  const bannerRenderer = new BannerRenderer(canvas, layout, loopAnim, banner.tplImages, {
    startAnim,
    loopAnim,
    fonts: banner.fonts,
    displayAspect: 4 / 3,
    playbackMode: "loop",
    tevQuality: "fast",
  });

  bannerRenderer.play();
}

if (icon) {
  const canvas = document.getElementById("icon");
  const layout = icon.renderLayout;
  const startAnim = icon.animStart ?? null;
  const loopAnim = icon.animLoop ?? icon.anim;

  canvas.width = layout.width;
  canvas.height = layout.height;

  const iconRenderer = new BannerRenderer(canvas, layout, loopAnim, icon.tplImages, {
    startAnim,
    loopAnim,
    fonts: icon.fonts,
    playbackMode: "loop",
    tevQuality: "fast",
  });

  iconRenderer.play();
}
```

## Common renderer options

- `startAnim`, `loopAnim`: Separate start + loop BRLAN support.
- `displayAspect`: `4 / 3`, `16 / 9`, or ratio string.
- `renderState`: Force `RSO*` state selection.
- `titleLocale`: Force title locale.
- `paneStateSelections`: Override pane-state groups.
- `playbackMode`: `"loop"` or `"hold"`.
- `tevQuality`: `"fast"` or `"accurate"`.

## Bundle helpers

Optional helpers are exported as subpaths:

```js
import { loadRendererBundle } from "@firstform/wii-channel-renderer/bundle-loader";
import { exportBundle } from "@firstform/wii-channel-renderer/export-bundle";
```

These are useful when you want to serialize parsed data into a reusable ZIP and load it later.

## Runtime requirements

Browser APIs used by the engine include:

- `CanvasRenderingContext2D`
- `ImageData`
- `OffscreenCanvas` (for export helpers)
- `createImageBitmap` (bundle loader)

If you need Node-only rendering, provide equivalent polyfills/canvas bindings.
