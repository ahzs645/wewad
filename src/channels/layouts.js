// Declarative structural metadata for the channel data containers. The decoders
// turn bytes into values; this captures the on-disk *shape* (header field
// offsets/types and the table descriptors) so the probe (probe.js) can walk any
// file and emit a self-describing JSON report — the machine-readable spec of the
// format. Keep this in sync with the decoders; probe.test.js cross-checks them.

/** Shorthand for a header field annotation. */
const f = (offset, type, name) => ({ offset, type, name });

// A table descriptor: where its (count, offset) pair lives in the header, the
// fixed entry size, and which decoded collection holds the decoded rows
// (`payloadKey` -> data.payload[key], `topKey` -> data[key]).
const table = (name, countOffset, offsetOffset, entrySize, sample = {}) => ({
  name,
  countOffset,
  offsetOffset,
  entrySize,
  payloadKey: sample.payloadKey ?? null,
  topKey: sample.topKey ?? null,
});

export const CHANNEL_LAYOUTS = {
  news: {
    titlePrefix: "HAG",
    files: ["news.bin.00 … news.bin.23"],
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
      table("longForecast", 32, 36, 121, { payloadKey: "forecasts" }),
      table("shortForecast", 40, 44, null),
      table("weatherConditions", 48, 52, 8, { payloadKey: "conditions" }),
      table("uvIndex", 56, 60, null),
      table("laundryIndex", 64, 68, null),
      table("pollenCount", 72, 76, null),
      table("locations", 80, 84, 24, { topKey: "locations" }),
    ],
  },
};
