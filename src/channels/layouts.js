// Declarative structural metadata for the channel data containers. The decoders
// turn bytes into values; this captures the on-disk *shape* (wrapper, header
// field offsets/types, table descriptors) so the probe (probe.js) can walk any
// file and emit a self-describing JSON report, and manifest.js can compose a
// per-channel definition — the machine-readable spec of the format. Keep this in
// sync with the decoders; probe.test.js cross-checks them.

/** Shorthand for a header field annotation. */
const f = (offset, type, name) => ({ offset, type, name });

// A table descriptor: where its (count, offset) pair lives in the header, the
// fixed entry size, and which decoded collection holds the decoded rows
// (`payloadKey` -> data.payload[key], `topKey` -> data[key]). `countType`
// defaults to "u32" — News/Forecast counts are all u32, but Everybody Votes
// packs several as u8/u16.
const table = (name, countOffset, offsetOffset, entrySize, sample = {}, countType = "u32") => ({
  name,
  countOffset,
  offsetOffset,
  countType,
  entrySize,
  payloadKey: sample.payloadKey ?? null,
  topKey: sample.topKey ?? null,
});

// The WC24 wrapper shared by News and Forecast: 64 reserved bytes, a 256-byte
// RSA-2048 signature, then an LZ10-compressed body at 0x140 with no prefix
// ahead of the header.
const WC24_RSA2048 = {
  wrapper: "wc24",
  signatureType: "RSA-2048-SHA1",
  reservedBytes: 64,
  signatureBytes: 256,
  bodyOffset: 0x140,
  compression: "LZ10",
};

// CRC32 is the 3rd u32 of the leading 12 bytes (News/Forecast: version/filesize/
// crc32 *are* the header's first fields; Everybody Votes: magic/size/crc32 are a
// separate prefix ahead of the header) and is computed over what follows it.
const CRC_IN_HEADER = { scope: "container", at: 8, computedFrom: 12 };
const CRC_IN_PREFIX = { scope: "prefix", at: 8, computedFrom: 0 };

export const CHANNEL_LAYOUTS = {
  news: {
    titlePrefix: "HAG",
    files: ["news.bin.00 … news.bin.23"],
    wrapper: WC24_RSA2048,
    crc: CRC_IN_HEADER,
    headerSize: 104,
    headerFields: [
      f(0, "u32", "version"),
      f(4, "u32", "filesize"),
      f(8, "u32", "crc32"),
      f(12, "timestamp", "updated"),
      f(16, "timestamp", "end"),
      f(20, "u8", "countryCode"),
      f(44, "u8", "languageCode"),
    ],
    tables: [
      table("topics", 52, 56, 12, { payloadKey: "topics" }),
      table("articles", 60, 64, 44, { payloadKey: "articles" }),
      table("sources", 68, 72, 28, { payloadKey: "sources" }),
      table("locations", 76, 80, 16, { topKey: "locations" }),
      table("images", 84, 88, null),
      table("menuHeadlines", 96, 100, 8, { payloadKey: "menuHeadlines" }),
    ],
  },
  forecast: {
    titlePrefix: "HAF",
    files: ["forecast.bin", "short.bin"],
    wrapper: WC24_RSA2048,
    crc: CRC_IN_HEADER,
    headerSize: 88,
    headerFields: [
      f(0, "u32", "version"),
      f(4, "u32", "filesize"),
      f(8, "u32", "crc32"),
      f(12, "timestamp", "open"),
      f(16, "timestamp", "close"),
      f(20, "u8", "countryCode"),
      f(24, "u8", "languageCode"),
      f(25, "u8", "temperatureFlag"),
    ],
    tables: [
      table("longForecast", 32, 36, 128, { payloadKey: "forecasts" }),
      table("shortForecast", 40, 44, null),
      table("weatherConditions", 48, 52, 8, { payloadKey: "conditions" }),
      table("uvIndex", 56, 60, null),
      table("laundryIndex", 64, 68, null),
      table("pollenCount", 72, 76, null),
      table("locations", 80, 84, 24, { topKey: "locations" }),
    ],
  },
  everybodyVotes: {
    titlePrefix: "HAJ",
    files: ["voting.bin", "first_data.bin"],
    // Differs from News/Forecast: 128-byte (not 256) signature, body at 0xC0
    // (not 0x140), and a 12-byte container prefix (magic/size/crc32) ahead of
    // the header — per RiiConnect24's votes.py.
    wrapper: {
      wrapper: "wc24",
      signatureType: "RSA-SHA1 (votes.py: 128-byte signature)",
      reservedBytes: 64,
      signatureBytes: 128,
      bodyOffset: 0xc0,
      compression: "LZ10",
      containerPrefix: { bytes: 12, fields: "u32 magic(0), u32 size, u32 crc32" },
      footer: "16 zero bytes + ASCII \"RIICONNECT24\"",
      note: "Wrapper differs from News/Forecast (RSA-2048 @ 0x140) — values per votes.py; verify against a live voting.bin.",
    },
    crc: CRC_IN_PREFIX,
    headerSize: 57,
    headerFields: [
      f(0, "timestamp", "timestamp"),
      f(4, "u8", "countryCode"),
      f(5, "u8", "publicityFlag"),
      f(6, "u8", "questionVersion"),
      f(7, "u8", "resultVersion"),
    ],
    tables: [
      table("nationalQuestions", 8, 9, 19, { payloadKey: "nationalQuestions" }, "u8"),
      table("worldwideQuestions", 13, 14, 19, { payloadKey: "worldwideQuestions" }, "u8"),
      table("questionText", 18, 19, 13, { payloadKey: "questionText" }, "u8"),
      table("nationalResults", 23, 24, 35, { payloadKey: "nationalResults" }, "u8"),
      table("nationalResultsDetailed", 28, 30, 13, { payloadKey: "nationalResultsDetailed" }, "u16"),
      table("positions", 34, 36, null, {}, "u16"),
      table("worldwideResults", 40, 41, 33, { payloadKey: "worldwideResults" }, "u8"),
      table("worldwideResultsDetailed", 45, 47, 26, { payloadKey: "worldwideResultsDetailed" }, "u16"),
      table("countryNames", 51, 53, 5, { payloadKey: "countryNames" }, "u16"),
    ],
  },
};
