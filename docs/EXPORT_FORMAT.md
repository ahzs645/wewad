# WeWAD Export Format

## Overview

WeWAD can export Wii channel banner and icon assets as a **zip archive** containing rendered images, extracted textures, audio, and a JSON manifest. This bundle is designed for consumption by downstream pipelines (e.g., channel database builders, thumbnail generators, video renderers).

## Export Bundle Structure

```
{source-name}.zip
├── manifest.json              # Metadata + animation timeline
├── banner.png                 # Banner snapshot (current preview aspect)
├── banner-4x3.png             # Banner at 4:3 (608×456)
├── banner-16x9.png            # Banner at 16:9 (811×456)
├── icon.png                   # Icon snapshot (current preview)
├── icon-4x3.png               # Icon (aspect-independent, 128×96 typical)
├── icon-16x9.png              # Icon (same as 4x3 — icons don't stretch)
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

## Aspect Ratio Handling

The Wii renders channel banners differently depending on the console's display setting:

| Setting | Aspect | Banner Size | How it works |
|---------|--------|-------------|--------------|
| Standard | 4:3 | 608×456 | Native layout dimensions, no stretch |
| Widescreen | 16:9 | ~811×456 | Layout horizontally scaled by 16:9 ÷ 4:3 = 1.333× |

**What's exported:**
- **Snapshots**: Both `banner-4x3.png` and `banner-16x9.png` are always included so your pipeline can pick whichever it needs
- **`banner.png`**: A copy of whatever aspect the preview is currently showing
- **Animation frames**: Rendered at the aspect ratio you select in the Export tab (defaults to 4:3)
- **Icon**: Not affected by aspect ratio — icons are always square-ish (typically 128×96)
- **Textures**: Raw texture data, not rendered — always at their native TPL resolution

**For your pipeline:**
```javascript
// Pick the right snapshot for your target display
const bannerUrl = manifest.banner.snapshots["16:9"].file; // "banner-16x9.png"
const bannerWidth = manifest.banner.snapshots["16:9"].width; // 811
```

## manifest.json

```jsonc
{
  // Version of the export format (semver)
  "version": "1.0.0",

  // WAD metadata
  "titleId": "HAJA",
  "sourceFile": "Internet Channel [USA] (WiiLink).wad",
  // Which aspect ratio was used for animation frame renders
  "exportAspect": "4:3",

  // Banner info
  "banner": {
    // Native BRLYT layout dimensions (before aspect ratio scaling)
    "nativeWidth": 608,
    "nativeHeight": 456,
    // Pre-rendered snapshots at both aspect ratios
    "snapshots": {
      "4:3":  { "file": "banner-4x3.png",  "width": 608, "height": 456 },
      "16:9": { "file": "banner-16x9.png", "width": 811, "height": 456 }
    },
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
    "frames": {
      "directory": "banner-frames/",
      "aspect": "4:3"
    },
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
      }
    ],
    // Render state groups available (RSO0, RSO1, etc.)
    "groups": ["RootGroup", "RSO0"]
  },

  // Icon info (same structure, nullable)
  "icon": {
    "nativeWidth": 128,
    "nativeHeight": 96,
    "snapshots": {
      "4:3":  { "file": "icon-4x3.png",  "width": 128, "height": 96 },
      "16:9": { "file": "icon-16x9.png", "width": 128, "height": 96 }
    },
    "animation": {
      "totalFrames": 5000,
      "fps": 60,
      "startFrames": null,
      "loopFrames": 5000,
      "durationSeconds": 83.33
    },
    "frames": null,
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

const zip = await JSZip.loadAsync(readFileSync("Internet Channel [USA] (WiiLink).zip"));
const manifest = JSON.parse(await zip.file("manifest.json").async("string"));

// Pick the right aspect ratio for your use case
const banner43 = await zip.file(manifest.banner.snapshots["4:3"].file).async("nodebuffer");
const banner169 = await zip.file(manifest.banner.snapshots["16:9"].file).async("nodebuffer");

// Icon (same for both aspects)
const icon = await zip.file(manifest.icon.snapshots["4:3"].file).async("nodebuffer");

// Audio (if available)
if (manifest.audio) {
  const audioWav = await zip.file(manifest.audio.file).async("nodebuffer");
}

// Iterate animation frames (if exported)
if (manifest.banner.frames) {
  const dir = manifest.banner.frames.directory;
  const total = manifest.banner.animation.totalFrames;
  for (let i = 0; i < total; i++) {
    const framePng = await zip.file(`${dir}${String(i).padStart(4, "0")}.png`).async("nodebuffer");
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
from PIL import Image
import io

with zipfile.ZipFile("Internet Channel [USA] (WiiLink).zip") as zf:
    manifest = json.loads(zf.read("manifest.json"))

    # Get banner at desired aspect ratio
    banner_file = manifest["banner"]["snapshots"]["16:9"]["file"]
    banner = Image.open(io.BytesIO(zf.read(banner_file)))
    print(f"Banner: {banner.size}")  # (811, 456) for 16:9

    # Icon
    icon_file = manifest["icon"]["snapshots"]["4:3"]["file"]
    icon = Image.open(io.BytesIO(zf.read(icon_file)))

    # Iterate frames for video generation
    frames_info = manifest["banner"].get("frames")
    if frames_info:
        fps = manifest["banner"]["animation"]["fps"]
        total = manifest["banner"]["animation"]["totalFrames"]
        for i in range(total):
            path = f"{frames_info['directory']}{i:04d}.png"
            frame = Image.open(io.BytesIO(zf.read(path)))
            # feed to ffmpeg, moviepy, etc.

    # Audio
    if manifest.get("audio"):
        audio_wav = zf.read(manifest["audio"]["file"])
```

### Creating a Video (ffmpeg)

```bash
# Extract the zip first
unzip "Internet Channel [USA] (WiiLink).zip" -d channel/

# Banner video from frames + audio
ffmpeg -framerate 60 -i channel/banner-frames/%04d.png \
       -i channel/audio.wav \
       -c:v libx264 -pix_fmt yuv420p \
       -c:a aac -shortest \
       channel_banner.mp4

# Icon GIF (looping, scaled up with nearest neighbor for pixel art feel)
ffmpeg -framerate 60 -i channel/icon-frames/%04d.png \
       -vf "fps=30,scale=256:192:flags=neighbor" \
       -loop 0 \
       channel_icon.gif
```

### Generating Thumbnails

The simplest pipeline use case — just grab the snapshots:

```bash
# Extract just the 4:3 snapshots
unzip -j channel.zip banner-4x3.png icon-4x3.png -d thumbnails/

# Or use 16:9 for widescreen displays
unzip -j channel.zip banner-16x9.png -d thumbnails/
```

## Previewing a Bundle

The **Export** tab in the WeWAD UI includes a built-in bundle previewer. You can:

1. **After exporting**: The bundle is automatically loaded into the previewer
2. **Load any .zip**: Click "Load .zip" to inspect a previously exported bundle
3. **Browse sections**:
   - **Snapshots** — View all banner/icon snapshots at both aspect ratios
   - **Textures** — Browse individual extracted textures
   - **Manifest** — Read the full manifest.json
   - **All Files** — File listing with sizes and types
   - **Audio** — Play back the channel audio directly

## Export Options

| Option | Default | Description |
|--------|---------|-------------|
| **Frame aspect ratio** | `4:3` | Aspect ratio for animation frame PNGs (snapshots always include both) |
| **Include frames** | `false` | Export every animation frame as individual PNGs |
| **Include textures** | `true` | Export individual texture PNGs |
| **Include audio** | `true` | Export channel audio as WAV |

## Format Details

### Images
- All images are **PNG** with alpha channel (RGBA)
- Banner 4:3: **608×456** pixels (native Wii layout)
- Banner 16:9: **~811×456** pixels (horizontally scaled for widescreen)
- Icon: typically **128×96** pixels (varies by channel)
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

For building a channel thumbnail database:

```
foreach WAD:
  1. Export bundle (frames=false)
  2. Read manifest.json for titleId
  3. Pick banner-4x3.png or banner-16x9.png based on target display
  4. Store icon-4x3.png keyed by titleId
```

### Pattern 2: Animated Previews

For generating animated GIF/WebP previews:

```
foreach WAD:
  1. Export with frames=true, aspect=4:3 or 16:9
  2. Use ffmpeg/sharp/Pillow to encode frames → animated WebP
  3. Trim to first 3-5 seconds for reasonable file size
```

### Pattern 3: Video Compilation

For creating video showcases of Wii channels:

```
foreach WAD:
  1. Export with frames=true, aspect=16:9
  2. Combine start + loop frames
  3. Mux with audio.wav
  4. Concatenate into compilation video
```
