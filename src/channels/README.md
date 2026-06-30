# Channel data feeds

Decoders for the **downloaded data feeds** of WiiConnect24 channels (News,
Forecast, …) and a GSAP renderer for them. This is distinct from the banner/icon
graphics in `packages/wii-channel-renderer` — those come from inside the WAD,
these are downloaded at runtime (`news.bin`, `forecast.bin`).

Every decoder returns one shared envelope (`format.js`) so a single renderer or
pipeline can consume any channel. Full spec, binary layouts, and a guide for
adding channels: [`docs/CHANNEL_DATA_FORMAT.md`](../../docs/CHANNEL_DATA_FORMAT.md).

```js
import { decodeChannelData } from "./index.js";
import { renderNewsChannel } from "./renderNewsChannel.js";

const data = decodeChannelData(newsBinBytes, { titleId: "HAGE" });
renderNewsChannel(data, mountElement);
```
