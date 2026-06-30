# Wii Channel Data Format

A **shared format** for the dynamic data feeds that WiiConnect24 channels
download — News, Forecast/Weather, and future ones — plus the decoders that read
them. This is separate from the banner/icon **graphics** the rest of WeWAD
renders: those live *inside* the WAD, while these feeds are downloaded at runtime
(`news.bin`, `forecast.bin`, …). This doc describes the on-disk binary layouts,
the one envelope they all decode into, and how to add a channel.

> Code lives in [`src/channels/`](../src/channels). News decoding is byte-validated
> against real server data; Forecast is transcribed from the WiiLink24 generator
> structs and validated structurally (no live `forecast.bin` was reachable at
> authoring time — see [Validation status](#validation-status)).

## Why a shared format

The News and Forecast channels carry very different content, but their files are
built the same way. Every channel data file is:

```
┌─────────────────────────────────────────────────────────────┐
│ WC24 wrapper (shared)                                        │
│   0x000  64 bytes  reserved / signature type (zero-filled)   │
│   0x040  256 bytes RSA-2048 signature over the body          │
│   0x140  ...       LZ10-compressed container ───────────┐    │
└──────────────────────────────────────────────────────────┼───┘
                                                            ▼  decompress
┌─────────────────────────────────────────────────────────────┐
│ Container (shared shape)                                     │
│   Header: version, filesize, CRC32, two timestamps,          │
│           country, language, then paired (count, offset)     │
│           descriptors for each table                         │
│   Tables: fixed-size records pointing (size, offset) into…   │
│   Blob:   UTF-16BE strings + binary data                     │
└─────────────────────────────────────────────────────────────┘
```

So the **shared layers** are: the WC24 wrapper, LZ10 compression, the
header-with-table-descriptors pattern, UTF-16BE strings, minutes-since-2000
timestamps, and a **Locations** primitive that both channels carry. Only the
table set differs. That is exactly what the shared format captures.

## The shared envelope

Every decoder returns this (`src/channels/format.js`):

```jsonc
{
  "format": "wii-channel-data/v1",
  "channel": "news" | "forecast",   // discriminates `payload`
  "version": 512,                    // raw container version (512 = v2)
  "country": 49,                     // header CountryCode
  "language": 1,                     // header LanguageCode
  "updated": "2026-06-30T04:30:00Z", // ISO-8601 (open/updated timestamp)
  "expires": "2026-07-07T04:30:00Z", // ISO-8601 (close/end timestamp)
  "locations": [                     // SHARED primitive
    { "name": "San Juan", "region": "", "country": "",
      "lat": 18.46, "lng": -66.11,
      "countryCode": 49, "regionCode": 2, "locationCode": 1234 }
  ],
  "payload": { /* channel-specific, see below */ }
}
```

### News payload (`channel: "news"`)

```jsonc
{
  "menuHeadlines": ["…"],            // the Wii-Menu icon/banner feed
  "articles": [
    { "id": 0, "source": 0, "location": null, "picture": null,
      "published": "2026-06-30T04:30:00Z", "updated": "…",
      "headline": "…", "body": "…" }
  ],
  "sources": [{ "name": "…", "copyright": "…" }],
  "topics":  [{ "name": "…", "articleCount": 3 }]
}
```

### Forecast payload (`channel: "forecast"`)

```jsonc
{
  "temperatureFlag": 0,
  "conditions": [{ "code1": 16, "code2": 0, "name": "Sunny" }],
  "forecasts": [
    { "location": { "countryCode": 1, "regionCode": 4, "locationCode": 49 },
      "updated": "…",
      "today":    { "condition": 16, "conditionName": "Sunny", "highC": 31, "lowC": 24, "highF": 88, "lowF": 75 },
      "tomorrow": { "…": "…" },
      "fiveDay":  [{ "condition": 12, "conditionName": "Cloudy", "highC": 30, "lowC": 24, "highF": 86, "lowF": 75, "precipitation": 40 }] }
  ],
  "counts": { "shortForecasts": 1, "uvIndex": 49, "laundryIndex": 49, "pollenCount": 49 }
}
```

## Binary layouts

All multi-byte values are **big-endian**. Strings are **UTF-16BE**, either a
fixed `(size, offset)` slice or NUL-terminated (`0x0000`) at an `offset`, packed
into the trailing blob and 4-byte aligned.

### Shared header prefix (both channels)

| Offset | Type | Field |
|--------|------|-------|
| 0x00 | u32 | Version (256 = v1, 512 = v2) |
| 0x04 | u32 | Filesize (of the container) |
| 0x08 | u32 | CRC32 (IEEE, over container bytes `[12:]`) |
| 0x0C | u32 | Updated / Open timestamp (minutes since 2000) |
| 0x10 | u32 | End / Close timestamp |
| 0x14 | u8  | CountryCode |

After this the two diverge. Each table descriptor is a `u32 count` followed by a
`u32 offset` (absolute, from the start of the container).

### News Channel (`HAG?`) — `news.bin.00 … news.bin.23`

Header descriptors at: Topics `0x34/0x38`, Articles `0x3C/0x40`, Sources
`0x44/0x48`, Locations `0x4C/0x50`, Images `0x54/0x58`, Wii-Menu Headlines
`0x60/0x64`. LanguageCode at `0x2C`.

**Article entry — 44 bytes:**

| Offset | Type | Field |
|--------|------|-------|
| 0x00 | u32 | ArticleNumber |
| 0x04 | u32 | SourceNumber |
| 0x08 | u32 | LocationNumber (`0xFFFFFFFF` = none) |
| 0x0C | u32 | PictureTimestamp |
| 0x10 | u32 | PictureNumber (`0xFFFFFFFF` = none) |
| 0x14 | u32 | PublishedTime |
| 0x18 | u32 | UpdatedTime |
| 0x1C | u32 | HeadlineSize (bytes) |
| 0x20 | u32 | HeadlineOffset |
| 0x24 | u32 | ArticleSize (bytes) |
| 0x28 | u32 | ArticleOffset |

A headline is literally `HeadlineSize` bytes of UTF-16BE at `HeadlineOffset`.
Sources are 28-byte entries (name + copyright `(size, offset)` pairs); Topics are
12-byte entries (NUL-terminated name offset + article count); the Wii-Menu
Headlines table is `(size, offset)` pairs — that feed is what the Wii Menu shows
on the channel's banner/icon.

### Forecast Channel (`HAF?`) — `forecast.bin`, `short.bin`

**Header — 88 bytes.** After the shared prefix: LanguageCode `0x18`,
TemperatureFlag `0x19`; descriptors for Long-forecast `0x20/0x24`, Short-forecast
`0x28/0x2C`, Weather-condition `0x30/0x34`, UV `0x38/0x3C`, Laundry `0x40/0x44`,
Pollen `0x48/0x4C`, Locations `0x50/0x54`.

**Location entry — 24 bytes:** `CountryCode u8`, `RegionCode u8`,
`LocationCode u16`, `CityTextOffset u32`, `RegionTextOffset u32`,
`CountryTextOffset u32`, `Latitude i16`, `Longitude i16`, `Zoom1 u8`, `Zoom2 u8`,
pad `u16`. Coordinates are scaled int16: **`degrees = raw × 0.0054931640625`**
(= 360 / 65536).

**Weather-condition entry — 8 bytes:** `Code1 u16`, `Code2 u16`,
`TextOffset u32` (NUL-terminated UTF-16BE name).

**Long-forecast entry — 121 bytes:** location key (`country/region/location`),
two timestamps, today & tomorrow blocks (forecast condition + four 6-hour codes,
high/low in °C and °F with difference bytes, four precipitation bytes, wind
direction/speed metric+imperial, UV/laundry/pollen), then a 7-day tail
(`day{1..7}` condition + high/low °C/°F + precipitation). Field order is mirrored
exactly in `src/channels/forecast.js`.

## Module map

| File | Responsibility |
|------|----------------|
| `binary.js` | Big-endian readers, UTF-16BE strings, Wii timestamps, coordinate decode |
| `wc24.js` | WC24 unwrap + LZ10 decompression (shared binary layer) |
| `format.js` | The shared envelope + typedefs |
| `news.js` | `decodeNews(bytes) → ChannelData` |
| `forecast.js` | `decodeForecast(bytes) → ChannelData` |
| `index.js` | Registry: `decodeChannelData`, `channelForTitleId`, `CHANNELS` |
| `renderNewsChannel.js` | GSAP renderer consuming the News envelope |
| `news.test.js` | Round-trip decode of a real fixture |

## Usage

```js
import { decodeChannelData, channelForTitleId } from "./channels/index.js";
import { renderNewsChannel } from "./channels/renderNewsChannel.js";

const data = decodeChannelData(fileBytes, { titleId: "HAGE" }); // or { channel: "news" }
if (data.channel === "news") {
  renderNewsChannel(data, document.getElementById("app"));
}
```

`fileBytes` is the raw `news.bin.NN` / `forecast.bin` as a `Uint8Array`. The
decoder does **not** verify the RSA signature (reading only needs the LZ10 body).

## Adding a new channel

1. Identify the channel's data file(s) and download URL (in the channel's DOL,
   e.g. `http://weather.wapp.wii.com/%d/%03d/forecast.bin`). The `%d/%03d` are
   language and region.
2. Map its header descriptors and table entry layouts — the WiiLink24 /
   RiiConnect24 generators and the RiiConnect24 Kaitai files are the references.
3. Write `src/channels/<name>.js` exporting `decode<Name>(bytes) → ChannelData`.
   Reuse `unwrapWC24`, the `binary.js` readers, and `createChannelData`. Put any
   cities into the shared `locations` array; channel-specific data under `payload`.
4. Register it in `index.js` (`CHANNELS`) with its title-code prefix.
5. Add a fixture + test (decode known values).
6. Add a renderer if it needs one (or extend the envelope a shared renderer reads).

## Validation status

- **News** — byte-validated end-to-end against live server data
  (`news.bin.00`) and a self-generated fixture; the decode round-trips.
- **Forecast** — header, locations (incl. coordinates) and conditions are
  decoded from the verified WiiLink24 structs; the long-forecast table is
  transcribed field-for-field but **not yet byte-validated** against a live
  `forecast.bin` (the weather servers were unreachable at authoring time). Treat
  forecast weather values as provisional until checked against a real file.

## Sources

- [WiiBrew: News Channel](https://wiibrew.org/wiki/News_Channel) ·
  [Forecast Channel](https://wiibrew.org/wiki/Forecast_Channel)
- [WiiLink24/NewsChannel](https://github.com/WiiLink24/NewsChannel) ·
  [WiiLink24/ForecastChannel](https://github.com/WiiLink24/ForecastChannel)
- [RiiConnect24/File-Maker](https://github.com/RiiConnect24/File-Maker) ·
  [RiiConnect24/Kaitai-Files](https://github.com/RiiConnect24/Kaitai-Files)
