# Wii Channel Data Format

A **shared format** for the dynamic data feeds that WiiConnect24 channels
download — News, Forecast/Weather, and future ones — plus the decoders that read
them. This is separate from the banner/icon **graphics** the rest of WeWAD
renders: those live *inside* the WAD, while these feeds are downloaded at runtime
(`news.bin`, `forecast.bin`, …). This doc describes the on-disk binary layouts,
the one envelope they all decode into, and how to add a channel.

> Code lives in [`src/channels/`](../src/channels). News and Forecast are
> byte-validated against real server data; Everybody Votes is transcribed from
> a generator reference (RiiConnect24's `votes.py`) and validated structurally
> (no live `voting.bin` was reachable — see [Validation status](#validation-status)).

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

Everybody Votes is the same WC24 family — LZ10-compressed body, a header of
(count, offset) table descriptors, a UTF-16BE blob — but its *wrapper* genuinely
differs (128-byte signature, body at 0xC0, a 12-byte container prefix ahead of
the header): see [Everybody Votes Channel](#everybody-votes-channel-haj--votingbin)
below. That's exactly the gap [per-channel definitions](#per-channel-definitions)
exist to express.

## The shared envelope

Every decoder returns this (`src/channels/format.js`):

```jsonc
{
  "format": "wii-channel-data/v1",
  "channel": "news" | "forecast" | "everybodyVotes",   // discriminates `payload`
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

### Everybody Votes payload (`channel: "everybodyVotes"`)

```jsonc
{
  "questions": [
    { "scope": "national", "pollId": 101, "opens": "…", "closes": "…",
      "text": "Do you prefer cats?", "responses": ["Cats", "Dogs"],
      "translations": [{ "language": 1, "text": "…", "responses": ["…", "…"] }] }
  ],
  "results": [
    { "scope": "national", "pollId": 101,
      "male": [120, 80], "female": [100, 95], "predictors": [150, 50] }
  ],
  // Flat decoded tables (1:1 with votes.py), alongside the resolved views above:
  "nationalQuestions": [ /* … */ ], "worldwideQuestions": [ /* … */ ],
  "questionText": [ /* … */ ], "nationalResults": [ /* … */ ],
  "nationalResultsDetailed": [ /* … */ ], "worldwideResults": [ /* … */ ],
  "worldwideResultsDetailed": [ /* … */ ], "countryNames": [ /* … */ ],
  "positions": { "count": 2, "offset": 182, "decoded": false }
}
```

`questions[].text`/`.responses` resolve the first available translation; the
full set (per language) is in `.translations[]`. `positions` (the per-region
vote breakdown) stays an extension point: each entry is a variable-length raw
blob keyed by a country's region count, which lives in `voteslists.py` and
isn't ported here — see [Auto-deriving unknown tables](#auto-deriving-unknown-tables).

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

**Long-forecast entry — 128 bytes:** location key (`country/region/location`),
two timestamps, today & tomorrow blocks (forecast condition + four 6-hour codes,
high/low in °C and °F with difference bytes, four precipitation bytes, wind
direction/speed metric+imperial, UV/laundry/pollen), then a 7-day tail
(`day{1..7}` condition + high/low °C/°F + precipitation + **1 pad byte**).
Field order is mirrored exactly in `src/channels/forecast.js` (Go's
`LongForecastTable` leaves an explicit `_ uint8` after each day's
`Precipitation` — easy to miss since it doesn't affect `today`/`tomorrow`, only
the 7-day tail from day 2 onward; see
[Validation status](#validation-status)).

### Everybody Votes Channel (`HAJ?`) — `voting.bin`

Unlike News/Forecast, the wrapper itself differs: **128-byte** signature (not
256), body at **0xC0** (not 0x140), and a **12-byte container prefix**
(`u32 magic(0)`, `u32 size`, `u32 crc32`) ahead of the header, inside the
decompressed body. The file ends with a **footer**: 16 zero bytes + ASCII
`"RIICONNECT24"`.

**Header — 57 bytes, byte-packed (unaligned).** Timestamp `0x00`, CountryCode
`0x04`, PublicityFlag `0x05`, QuestionVersion `0x06`, ResultVersion `0x07`; then
(number, offset) descriptors — note several **counts are u8/u16, not u32**:
National-Question `0x08(u8)/0x09`, Worldwide-Question `0x0D(u8)/0x0E`,
Question-Text `0x12(u8)/0x13`, National-Result `0x17(u8)/0x18`,
National-Result-Detailed `0x1C(u16)/0x1E`, Position `0x22(u16)/0x24`,
Worldwide-Result `0x28(u8)/0x29`, Worldwide-Result-Detailed `0x2D(u16)/0x2F`,
Country-Name `0x33(u16)/0x35`.

Most tables are *also* addressed indirectly: a question entry's
`textStart`/`textCount` selects a slice of the global Question-Text table; a
result's `detailedStart`/`detailedCount` selects a slice of its Detailed table;
and so on — a (start-index, count) pair into the table the header points at,
not a second byte offset.

| Table | Entry size | Fields |
|-------|-----------|--------|
| National/Worldwide Question | 19 B | `pollId u32, category u8×2, opens u32, closes u32, textCount u8, textStart u32` |
| Question Text | 13 B | `language u8, questionOffset u32, response1Offset u32, response2Offset u32` (UTF-16BE NUL-terminated in blob) |
| National Result | 35 B | `pollId u32, male u32×2, female u32×2, predictors u32×2, showVoters u8, detailedFlag u8, detailedCount u8, detailedStart u32` |
| National Result Detailed | 13 B | `voters u32×2, positionCount u8, positionStart u32` |
| Worldwide Result | 33 B | `pollId u32, male u32×2, female u32×2, predictors u32×2, detailedCount u8, detailedStart u32` |
| Worldwide Result Detailed | 26 B | `unknown u32, male u32×2, female u32×2, countryNameCount u16, countryNameStart u32` |
| Country Name | 5 B | `language u8, textOffset u32` (UTF-16BE NUL-terminated in blob) |
| Position | variable | per-country raw blob (`binascii.unhexlify` in votes.py) keyed by that country's region count — **not decoded**, see [Auto-deriving unknown tables](#auto-deriving-unknown-tables) |

Field layout transcribed from RiiConnect24's
`File-Maker/Channels/Everybody_Votes_Channel/votes.py` + `voteslists.py`. Mirrored
exactly in `src/channels/votes.js`.

## Module map

| File | Responsibility |
|------|----------------|
| `binary.js` | Big-endian readers, UTF-16BE strings, Wii timestamps, coordinate decode |
| `wc24.js` | WC24 unwrap + LZ10 decompression (shared binary layer, configurable body offset) |
| `format.js` | The shared envelope + typedefs |
| `news.js` | `decodeNews(bytes) → ChannelData` |
| `forecast.js` | `decodeForecast(bytes) → ChannelData` |
| `votes.js` | `decodeEverybodyVotes(bytes) → ChannelData` |
| `index.js` | Registry: `decodeChannelData`, `channelForTitleId`, `CHANNELS` (data-only; no GSAP/DOM) |
| `layouts.js` | Declarative structural metadata (wrapper + crc config + header fields + table descriptors) |
| `probe.js` | `probeChannelData(bytes) → report` — walks the structure, emits JSON |
| `infer.js` | `inferTableLayout(...)` — derives entry layouts for unknown tables |
| `manifest.js` | `channelDefinition(name)` — per-channel definition (structure + rendering) |
| `renderNewsChannel.js` / `renderForecastChannel.js` / `renderEverybodyVotesChannel.js` | GSAP renderers for each envelope |
| `*.test.js` | Round-trip decode, probe, inference, and definition checks |

The app surfaces all of this in the **Channel Data** tab
(`src/components/tabs/ChannelDataTab.jsx`): load a `.bin`/`.json`, auto-detect the
channel from the loaded WAD's title, then render it (GSAP), inspect the probed
structure, and download the decoded envelope or the probe report as JSON.

> The decoders (`index.js` and everything it re-exports) are GSAP/DOM-free so
> they run anywhere, including Node and tests. The renderers depend on `gsap` and
> the DOM, so import them directly (`./renderNewsChannel.js`) rather than through
> the registry.

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

## Probing the structure

`probeChannelData(bytes, { channel | titleId })` walks a file and returns a
self-describing JSON report — useful to confirm the format against a real file,
see live values, and generate the structure as data:

```jsonc
{
  "format": "wii-channel-data-probe/v1",
  "channel": "news",
  "file":      { "size": 1025, "wrapper": { "bodyOffset": 320, "compression": "LZ10", … } },
  "container": { "size": 1536, "version": 512,
                 "crc32": { "stored": "0xE59BACFB", "computed": "0xE59BACFB", "valid": true },
                 "blobOffset": 300, "blobBytes": 1236 },
  "header":    { "fields": [ { "offset": 12, "type": "timestamp", "name": "updated",
                              "value": "2026-06-30T…", "raw": 13935735 }, … ] },
  "tables": [
    { "name": "articles", "count": 3, "offset": 128, "entrySize": 44,
      "totalBytes": 132, "firstEntryHex": "00 00 00 00 …", "samples": [ /* decoded rows */ ] },
    { "name": "images", "count": 0, "entrySize": null, "decoded": "not decoded (extension point)" }
  ],
  "schema":  { /* JSON Schema for the decoded envelope */ },
  "decoded": { /* the full shared envelope */ }
}
```

The structural metadata it walks (header field offsets/types + table descriptors)
lives in `layouts.js`; the decoded `samples` come from the channel decoder, so the
two are cross-checked (`probe.test.js`). The report is what the **Channel Data**
tab's "Structure" view renders and the `↓ probe.json` button downloads.

## Auto-deriving unknown tables

Some tables don't have a known struct yet (the forecast UV/laundry/pollen indices,
Everybody Votes' `positions` table, …). `inferTableLayout(container, { offset, count, boundary })`
discovers a candidate layout from a real file:

- **entry size** by stride — `(boundary − offset) / count`, where `boundary` is the
  next table's offset (or the blob start);
- **per-slot classification** — each 4-byte slot across all entries is tagged
  `constant` / `smallInt` / `pointer?` (value lands inside the container — likely a
  blob offset) / `timestamp?` / `u32`, with sample values.

The probe runs this automatically for any `extension point` table that has rows and
attaches an `inferred` block. It's a discovery aid (4-byte granularity, heuristic) —
confirm a candidate against a few files, then promote it to a real field list in the
decoder + `layouts.js`. Validated against known tables in `infer.test.js` (e.g. it
recovers the 24-byte forecast location entry and flags its three string pointers).

## Per-channel definitions

Each channel differs — different URL, container wrapper, tables, and on-screen
interface — so each has one self-contained **definition** that explains it.
`channelDefinition(name)` returns it; the Channel Data tab downloads one per channel:

```jsonc
{
  "format": "wii-channel-definition/v1",
  "channel": "everybodyVotes",
  "status": "decoded",
  "meta":   { "label": "Everybody Votes Channel", "url": "http://nwcs.wapp.wii.com/",
              "files": ["voting.bin", "first_data.bin"] },
  "container": { "signatureBytes": 128, "bodyOffset": 192,    // ← differs from News/Forecast!
                 "containerPrefix": { "bytes": 12, "fields": "u32 magic(0), u32 size, u32 crc32" }, … },
  "header":  [ /* field offsets/types */ ],
  "tables":  [ /* descriptors, incl. per-table countType (u8/u16/u32) */ ],
  "envelopeSchema": { /* decoded shape */ },
  "rendering": { "renderer": "renderEverybodyVotesChannel",
                 "bindings": { "question": "payload.questions[].text", … } }   // data → UI
}
```

The `rendering` block maps decoded-envelope fields to interface roles, so a host can
drive a channel from its definition alone. All three channels are `decoded` (composed
from the live layout + decoder + schema in `layouts.js`/`manifest.js`) — note
Everybody Votes' wrapper (128-byte signature, 0xC0 body, 12-byte container prefix,
several u8/u16 table counts) differs from News/Forecast (RSA-2048 at 0x140, all-u32
counts), which is exactly why definitions are per-channel.

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
5. Add its structural metadata to `layouts.js` (wrapper, crc config, header fields,
   table descriptors — set `countType` per table if a count isn't u32) so `probe.js`
   and the Channel Data tab can introspect it.
6. Add a fixture + test (decode known values; cross-check the probe).
7. Add a renderer if it needs one (or extend the envelope a shared renderer reads).

## Validation status

- **News** — byte-validated end-to-end against live server data
  (`news.bin.00`) and a self-generated fixture; the decode round-trips.
- **Forecast** — byte-validated end-to-end against **live data**: the fixture
  (`__fixtures__/sample-forecast.bin`) is a real `forecast.bin` fetched from a
  WiiLink WC24 revival server (Japan region), CRC32-verified, 653 locations /
  283 forecast entries (`forecast.test.js`). This replaced an earlier
  self-generated fixture (built from the WiiLink24/ForecastChannel Go structs
  but only checked one entry's first 7-day-tail day) and caught a real bug:
  the long-forecast entry is **128 bytes, not 121** — Go's `LongForecastTable`
  leaves a 1-byte pad after each day's `Precipitation` field in the 7-day
  tail, which the old fixture's single-entry check never exercised. Every
  entry's full 7-day tail now decodes to plausible values (was producing
  nulls/impossible temperatures like -59°C past day 1 before the fix).
- **Everybody Votes** — same approach as Forecast: the fixture
  (`__fixtures__/sample-everybody-votes.bin`) is built directly to the layout
  transcribed from RiiConnect24's `votes.py`/`voteslists.py` (header fields, all
  nine table entry sizes, the 128-byte-signature/0xC0-body/12-byte-prefix
  wrapper), LZ10-compressed and wrapped the same way a real `voting.bin` is, then
  decoded by this module (`votes.test.js`) — including a CRC32 check, which
  validates the prefix/header/table boundary math. It does **not** check values
  against a real poll (no live `voting.bin` was reachable), and `positions` (the
  per-region breakdown) stays undecoded — see [Everybody Votes payload](#everybody-votes-payload-channel-everybodyvotes).

## Sources

- [WiiBrew: News Channel](https://wiibrew.org/wiki/News_Channel) ·
  [Forecast Channel](https://wiibrew.org/wiki/Forecast_Channel)
- [WiiLink24/NewsChannel](https://github.com/WiiLink24/NewsChannel) ·
  [WiiLink24/ForecastChannel](https://github.com/WiiLink24/ForecastChannel)
- [RiiConnect24/File-Maker](https://github.com/RiiConnect24/File-Maker) ·
  [RiiConnect24/Kaitai-Files](https://github.com/RiiConnect24/Kaitai-Files)
