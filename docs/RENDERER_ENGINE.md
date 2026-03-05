# Wii Channel Rendering Engine

WeWAD now includes a separate reusable rendering package:

- Package path (in this repo): `packages/wii-channel-renderer`
- Package name: `@wewad/wii-channel-renderer`

This package is framework-agnostic and can be imported by other projects to parse/render Wii channel banners and icons.

## Install

From npm (after publishing):

```bash
npm install @wewad/wii-channel-renderer
```

From this repository (without publishing):

```bash
npm install /absolute/path/to/wewad/packages/wii-channel-renderer
```

## Public API

```js
import {
  BannerRenderer,
  processWAD,
  processArchive,
  processZipBundle,
  flattenTextures,
  parseWAD,
  parseU8,
  parseBRLYT,
  parseBRLAN,
  parseTPL,
} from "@wewad/wii-channel-renderer";
```

Optional helpers:

```js
import { loadRendererBundle } from "@wewad/wii-channel-renderer/bundle-loader";
import { exportBundle } from "@wewad/wii-channel-renderer/export-bundle";
```

## Render banner + icon from a WAD

```js
import { processWAD, BannerRenderer } from "@wewad/wii-channel-renderer";

const parsed = await processWAD(await wadFile.arrayBuffer());

function createRenderer(canvas, target) {
  const data = parsed.results[target];
  if (!data) return null;

  const layout = data.renderLayout;
  const startAnim = data.animStart ?? null;
  const loopAnim = data.animLoop ?? data.anim;

  canvas.width = layout.width;
  canvas.height = layout.height;

  return new BannerRenderer(canvas, layout, loopAnim, data.tplImages, {
    startAnim,
    loopAnim,
    fonts: data.fonts,
    playbackMode: "loop",
    tevQuality: "fast",
    displayAspect: target === "banner" ? 4 / 3 : null,
  });
}

const bannerRenderer = createRenderer(document.getElementById("banner"), "banner");
const iconRenderer = createRenderer(document.getElementById("icon"), "icon");

bannerRenderer?.play();
iconRenderer?.play();
```

## Notes for integrators

- `BannerRenderer` supports both banner and icon layouts.
- The engine is browser-first and relies on canvas APIs.
- For best compatibility, use a bundler environment (Vite, Webpack, Next.js, etc.).
- If you only need static snapshots, call `applyFrame(frame)` without `play()`.
- Call `dispose()` when unmounting to release animation and caches.

## Package maintenance

Current source-of-truth for the extracted engine is:

- `packages/wii-channel-renderer/src`

WeWAD app imports this package directly, so regressions are caught during normal app builds.
