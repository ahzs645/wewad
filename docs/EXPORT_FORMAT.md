# WeWAD Export Format

## Overview

WeWAD can export Wii channel banner and icon assets as a **zip archive** containing rendered images, extracted textures, audio, and a JSON manifest. This bundle is designed for consumption by downstream pipelines (e.g., channel database builders, thumbnail generators, video renderers).

## Export Bundle Structure

```
{title-id}.zip
├── manifest.json              # Metadata + animation timeline
├── banner.png                 # Banner snapshot (first loop frame, 608×456)
├── icon.png                   # Icon snapshot (128×128)
├── banner-frames/             # Optional: all banner animation frames
│   ├── 0000.png
│   ├── 0001.png
│   └── ...
├── icon-frames/               # Optional: all icon animation frames
│   ├── 0000.png
│   └── ...
├── textures/                  # Individual extracted textures
│   ├── banner/
│   │   ├── {name}.png
│   │   └── ...
│   └── icon/
│       ├── {name}.png
│       └── ...
└── audio.wav                  # Channel audio (if available)
```

## manifest.json

```jsonc
{
  // Version of the export format (semver)
  "version": "1.0.0",

  // WAD metadata
  "titleId": "HAJA",
  "sourceFile": "Internet Channel [USA] (WiiLink).wad",

  // Banner info
  "banner": {
    "width": 608,
    "height": 456,
    "snapshot": "banner.png",
    "animation": {
      // Total frame count across start + loop phases
      "totalFrames": 300,
      // Wii runs at 60 fps
      "fps": 60,
      // Start animation plays once, then loop repeats
      "startFrames": 100,    // null if no start animation
      "loopFrames": 200,
      // Duration in seconds
      "durationSeconds": 5.0
    },
    // Frame directory (present only if frame export was requested)
    "frames": "banner-frames/",
    // Textures used by this banner
    "textures": [
      "my_texture_01.tpl",
      "my_texture_02.tpl"
    ],
    // Materials summary
    "materials": [
      {
        "name": "M_background",
        "textureMaps": ["my_texture_01.tpl"],
        "blendMode": "blend"
      }
    ],
    // Pane tree (flattened)
    "panes": [
      {
        "name": "RootPane",
        "type": "pan1",
        "parent": null,
        "size": [608, 456],
        "visible": true
      },
      {
        "name": "P_bg",
        "type": "pic1",
        "parent": "RootPane",
        "size": [608, 456],
        "visible": true,
        "materialIndex": 0
      }
    ],
    // Render state groups available (RSO0, RSO1, etc.)
    "groups": ["RootGroup", "RSO0"]
  },

  // Icon info (same structure, nullable)
  "icon": {
    "width": 128,
    "height": 96,
    "snapshot": "icon.png",
    "animation": {
      "totalFrames": 5000,
      "fps": 60,
      "startFrames": null,
      "loopFrames": 5000,
      "durationSeconds": 83.33
    },
    "frames": "icon-frames/",
    "textures": ["icon_bg01.tpl"],
    "materials": [],
    "panes": [],
    "groups": []
  },

  // Audio info (null if no channel audio)
  "audio": {
    "file": "audio.wav",
    "sampleRate": 32000,
    "channels": 2,
    "durationSeconds": 5.0
  }
}
```

## Consuming the Export

### Quick Start (Node.js)

```javascript
import { readFileSync } from "fs";
import JSZip from "jszip";

const zip = await JSZip.loadAsync(readFileSync("HAJA.zip"));
const manifest = JSON.parse(await zip.file("manifest.json").async("string"));

// Get the static banner PNG
const bannerPng = await zip.file(manifest.banner.snapshot).async("nodebuffer");

// Get the static icon PNG
const iconPng = await zip.file(manifest.icon.snapshot).async("nodebuffer");

// Get audio WAV (if available)
if (manifest.audio) {
  const audioWav = await zip.file(manifest.audio.file).async("nodebuffer");
}

// Iterate animation frames (if exported)
if (manifest.banner.frames) {
  const totalFrames = manifest.banner.animation.loopFrames;
  for (let i = 0; i < totalFrames; i++) {
    const framePng = await zip
      .file(`${manifest.banner.frames}${String(i).padStart(4, "0")}.png`)
      .async("nodebuffer");
    // process frame...
  }
}

// Access individual textures
for (const texName of manifest.banner.textures) {
  const texPng = await zip.file(`textures/banner/${texName}.png`).async("nodebuffer");
}
```

### Quick Start (Python)

```python
import json
import zipfile
from pathlib import Path
from PIL import Image
import io

with zipfile.ZipFile("HAJA.zip") as zf:
    manifest = json.loads(zf.read("manifest.json"))

    # Get banner snapshot
    banner_bytes = zf.read(manifest["banner"]["snapshot"])
    banner = Image.open(io.BytesIO(banner_bytes))

    # Get icon snapshot
    icon_bytes = zf.read(manifest["icon"]["snapshot"])
    icon = Image.open(io.BytesIO(icon_bytes))

    # Iterate frames for video generation
    if manifest["banner"].get("frames"):
        fps = manifest["banner"]["animation"]["fps"]
        total = manifest["banner"]["animation"]["loopFrames"]
        for i in range(total):
            frame_path = f"{manifest['banner']['frames']}{i:04d}.png"
            frame = Image.open(io.BytesIO(zf.read(frame_path)))
            # feed to ffmpeg, moviepy, etc.

    # Extract audio
    if manifest.get("audio"):
        audio_wav = zf.read(manifest["audio"]["file"])
```

### Creating a Video (ffmpeg)

```bash
# Extract the zip first
unzip HAJA.zip -d HAJA/

# Banner video from frames + audio
ffmpeg -framerate 60 -i HAJA/banner-frames/%04d.png \
       -i HAJA/audio.wav \
       -c:v libx264 -pix_fmt yuv420p \
       -c:a aac -shortest \
       HAJA_banner.mp4

# Icon GIF (looping)
ffmpeg -framerate 60 -i HAJA/icon-frames/%04d.png \
       -vf "fps=30,scale=256:192:flags=neighbor" \
       -loop 0 \
       HAJA_icon.gif
```

### Generating Thumbnails

The simplest pipeline use case — just grab the snapshots:

```bash
unzip -j HAJA.zip banner.png icon.png -d thumbnails/
# banner.png = 608×456, icon.png = 128×128 (or 128×96 for some channels)
```

## Export Options

When triggering an export from the UI, these options are available:

| Option | Default | Description |
|--------|---------|-------------|
| **Include frames** | `false` | Export every animation frame as individual PNGs |
| **Frame range** | `loop` | Which phase to export: `start`, `loop`, or `all` |
| **Include textures** | `true` | Export individual texture PNGs |
| **Include audio** | `true` | Export channel audio as WAV |
| **Snapshot frame** | `0` (loop start) | Which frame to use for the static snapshot |

## Format Details

### Images
- All images are **PNG** with alpha channel (RGBA)
- Banner: **608×456** pixels (native Wii banner resolution)
- Icon: **128×128** or **128×96** pixels (depends on channel)
- Textures: Original resolution from TPL, various sizes

### Audio
- **WAV** format, PCM 16-bit signed little-endian
- Sample rate varies by channel (typically 32000 Hz)
- Mono or stereo depending on the channel's BNS data
- Duration typically 2-5 seconds (matches banner start animation)

### Animation
- Wii animations run at **60 fps**
- Most banners: 100-300 frames start, 100-300 frames loop
- Some channels (e.g., Wii Shop icon): up to 5000 loop frames
- Frame export uses the same Canvas 2D renderer as the preview

## Pipeline Integration Patterns

### Pattern 1: Thumbnail Database

For building a channel thumbnail database (e.g., for a game launcher):

```
foreach WAD:
  1. Export with frames=false (snapshots only)
  2. Read manifest.json for titleId
  3. Store banner.png and icon.png keyed by titleId
```

### Pattern 2: Animated Previews

For generating animated GIF/WebP previews:

```
foreach WAD:
  1. Export with frames=true, range=loop
  2. Use ffmpeg/sharp/Pillow to encode frames → animated WebP
  3. Trim to first 3-5 seconds for reasonable file size
```

### Pattern 3: Channel Database

For extracting structured metadata:

```
foreach WAD:
  1. Export with frames=false, textures=false, audio=false
  2. Parse manifest.json
  3. Store: titleId, pane tree, materials, texture names, animation info
  4. Use banner.png + icon.png as visual assets
```

### Pattern 4: Video Compilation

For creating video showcases of Wii channels:

```
foreach WAD:
  1. Export with frames=true, range=all (start + loop)
  2. Combine start + loop frames
  3. Mux with audio.wav
  4. Concatenate into compilation video
```
