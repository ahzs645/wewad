// A probing interface for channel data files. Given a news.bin / forecast.bin,
// it walks the WC24 wrapper, the container header and every table descriptor and
// emits a self-describing JSON report: what tables exist, where, how big, sample
// decoded rows, checksum validation, and a JSON Schema for the decoded envelope.
//
// The point is discovery + documentation: point it at a real file to confirm the
// format, see live values, and generate the structure as data. Decoding of the
// rows is delegated to the channel decoders (one source of truth); this module
// adds the structural layer from layouts.js.

import { u8, u32, wiiMinutesToISO, crc32 } from "./binary.js";
import { unwrapWC24, WC24_BODY_OFFSET, LZ10_MAGIC } from "./wc24.js";
import { decodeChannelData, channelForTitleId } from "./index.js";
import { CHANNEL_LAYOUTS } from "./layouts.js";
import { inferTableLayout, tableBoundary } from "./infer.js";

const PROBE_FORMAT = "wii-channel-data-probe/v1";

function hex(bytes, start, end) {
  let out = "";
  for (let i = start; i < end && i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0") + (i + 1 < end ? " " : "");
  }
  return out;
}

const hex32 = (n) => "0x" + (n >>> 0).toString(16).padStart(8, "0").toUpperCase();

function readHeaderField(container, field) {
  switch (field.type) {
    case "u8":
      return { offset: field.offset, type: field.type, name: field.name, value: u8(container, field.offset) };
    case "u32":
      return { offset: field.offset, type: field.type, name: field.name, value: u32(container, field.offset) };
    case "timestamp": {
      const minutes = u32(container, field.offset);
      return { offset: field.offset, type: field.type, name: field.name, value: wiiMinutesToISO(minutes), raw: minutes };
    }
    default:
      return { offset: field.offset, type: field.type, name: field.name, value: null };
  }
}

// Compact JSON Schema for the decoded envelope, per channel. This is the
// "how we should work with the entries" artifact callers can save and target.
export function envelopeSchema(channel) {
  const location = {
    type: "object",
    properties: {
      name: { type: "string" },
      region: { type: "string" },
      country: { type: "string" },
      lat: { type: ["number", "null"] },
      lng: { type: ["number", "null"] },
      countryCode: { type: "integer" },
      regionCode: { type: "integer" },
      locationCode: { type: "integer" },
    },
  };
  const payloads = {
    news: {
      type: "object",
      properties: {
        menuHeadlines: { type: "array", items: { type: "string" } },
        articles: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "integer" },
              source: { type: "integer" },
              location: { type: ["integer", "null"] },
              picture: { type: ["integer", "null"] },
              published: { type: ["string", "null"] },
              updated: { type: ["string", "null"] },
              headline: { type: "string" },
              body: { type: "string" },
            },
          },
        },
        sources: { type: "array", items: { type: "object", properties: { name: { type: "string" }, copyright: { type: "string" } } } },
        topics: { type: "array", items: { type: "object", properties: { name: { type: "string" }, articleCount: { type: "integer" } } } },
      },
    },
    forecast: {
      type: "object",
      properties: {
        temperatureFlag: { type: "integer" },
        conditions: { type: "array", items: { type: "object", properties: { code1: { type: "integer" }, code2: { type: "integer" }, name: { type: "string" } } } },
        forecasts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              location: { type: "object" },
              updated: { type: ["string", "null"] },
              today: { type: "object" },
              tomorrow: { type: "object" },
              fiveDay: { type: "array" },
            },
          },
        },
        counts: { type: "object" },
      },
    },
  };
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: `wii-channel-data/v1 (${channel})`,
    type: "object",
    properties: {
      format: { const: "wii-channel-data/v1" },
      channel: { const: channel },
      version: { type: "integer" },
      country: { type: "integer" },
      language: { type: "integer" },
      updated: { type: ["string", "null"] },
      expires: { type: ["string", "null"] },
      locations: { type: "array", items: location },
      payload: payloads[channel] ?? { type: "object" },
    },
    required: ["format", "channel", "locations", "payload"],
  };
}

/**
 * Probe a channel data file and return a structured report.
 * @param {Uint8Array} fileBytes whole news.bin / forecast.bin
 * @param {{channel?: string, titleId?: string, sampleLimit?: number}} [options]
 * @returns {object} the probe report (JSON-serializable)
 */
export function probeChannelData(fileBytes, { channel, titleId, sampleLimit = 2 } = {}) {
  const name = channel ?? channelForTitleId(titleId);
  const layout = CHANNEL_LAYOUTS[name];
  if (!layout) {
    throw new Error(`probe: unknown channel${name ? ` "${name}"` : ""}`);
  }

  const container = unwrapWC24(fileBytes);
  const decoded = decodeChannelData(fileBytes, { channel: name });

  const storedCrc = u32(container, 8);
  const computedCrc = crc32(container, 12);

  const headerFields = layout.headerFields.map((field) => readHeaderField(container, field));

  let coveredBytes = layout.headerSize;
  const allOffsets = layout.tables.map((def) => u32(container, def.offsetOffset)).filter((o) => o > 0);
  for (const def of layout.tables) {
    if (def.entrySize != null) {
      coveredBytes += u32(container, def.countOffset) * def.entrySize;
    }
  }
  const blobOffset = coveredBytes <= container.length ? coveredBytes : null;

  const tables = layout.tables.map((def) => {
    const count = u32(container, def.countOffset);
    const offset = u32(container, def.offsetOffset);
    const totalBytes = def.entrySize != null ? count * def.entrySize : null;
    const rows = def.topKey ? decoded[def.topKey] : def.payloadKey ? decoded.payload?.[def.payloadKey] : null;
    // For tables we can't decode yet, try to infer their entry layout from the file.
    const inferred =
      def.entrySize == null && count > 0
        ? inferTableLayout(container, {
            offset,
            count,
            boundary: tableBoundary(offset, allOffsets, blobOffset, container.length),
          })
        : null;
    return {
      name: def.name,
      descriptor: { countOffset: def.countOffset, offsetOffset: def.offsetOffset },
      count,
      offset,
      entrySize: def.entrySize,
      totalBytes,
      decoded: def.entrySize == null ? "not decoded (extension point)" : "decoded",
      firstEntryHex: def.entrySize && count > 0 ? hex(container, offset, offset + Math.min(def.entrySize, 48)) : null,
      samples: Array.isArray(rows) ? rows.slice(0, sampleLimit) : null,
      inferred,
    };
  });

  return {
    format: PROBE_FORMAT,
    channel: name,
    file: {
      size: fileBytes.length,
      wrapper: {
        signatureHeaderBytes: 64,
        signatureBytes: 256,
        bodyOffset: WC24_BODY_OFFSET,
        compression: u8(fileBytes, WC24_BODY_OFFSET) === LZ10_MAGIC ? "LZ10" : "unknown",
      },
    },
    container: {
      size: container.length,
      headerSize: layout.headerSize,
      version: u32(container, 0),
      crc32: { stored: hex32(storedCrc), computed: hex32(computedCrc), valid: storedCrc === computedCrc },
      blobOffset,
      blobBytes: blobOffset != null ? container.length - blobOffset : null,
    },
    header: { fields: headerFields },
    tables,
    schema: envelopeSchema(name),
    decoded,
  };
}
