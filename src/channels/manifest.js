// Per-channel "definition" JSON. Each channel is different — different download
// URL, container wrapper, tables, and on-screen interface — so each gets one
// self-contained descriptor that *explains* it: where its data comes from, how
// the bytes are laid out (structure), and how the decoded envelope maps to the
// UI (rendering). Save/download one per channel; a generic host can drive a
// channel purely from its definition.
//
// News and Forecast are composed from the live layout + decoder + schema (status
// "decoded"). Everybody Votes is documented from RiiConnect24's votes.py
// (status "documented") — its wrapper and container even differ, which is exactly
// why per-channel definitions are needed.

import { CHANNELS } from "./index.js";
import { CHANNEL_LAYOUTS } from "./layouts.js";
import { envelopeSchema } from "./probe.js";

// The WC24 wrapper News and Forecast share.
const WC24_RSA2048 = {
  wrapper: "wc24",
  signatureType: "RSA-2048-SHA1",
  reservedBytes: 64,
  signatureBytes: 256,
  bodyOffset: 0x140,
  compression: "LZ10",
};

// How the decoded envelope maps to each channel's on-screen interface — the
// "rendering" half of the definition.
const RENDERING = {
  news: {
    renderer: "renderNewsChannel",
    layout: "feature story + headline list + scrolling ticker",
    bindings: {
      featureTitle: "payload.articles[].headline",
      featureBody: "payload.articles[].body",
      list: "payload.articles[].headline",
      ticker: "payload.menuHeadlines[]",
      source: "payload.sources[].name",
      timestamp: "updated",
    },
    note: "menuHeadlines is the feed the Wii Menu shows on the channel icon/banner.",
  },
  forecast: {
    renderer: "renderForecastChannel",
    layout: "current conditions + location list + 7-day strip, with a °C/°F toggle",
    bindings: {
      locationList: "locations[].name",
      current: "payload.forecasts[].today",
      temperature: { celsius: "payload.forecasts[].today.highC", fahrenheit: "payload.forecasts[].today.highF" },
      condition: "payload.forecasts[].today.conditionName",
      days: "payload.forecasts[].fiveDay[]",
    },
  },
  everybodyVotes: {
    renderer: null,
    status: "TBD",
    layout: "poll question + two responses, male/female/predictor result bars, regional breakdown",
    bindings: {
      question: "payload.questions[].text",
      responses: "payload.questions[].responses[]",
      results: "payload.results[] (male/female/predictor counts per response)",
      regional: "payload.positions[] (per-region breakdown)",
    },
  },
};

function composeDefinition(name) {
  const layout = CHANNEL_LAYOUTS[name];
  const meta = CHANNELS[name];
  return {
    format: "wii-channel-definition/v1",
    channel: name,
    status: "decoded",
    meta: {
      label: meta.label,
      titlePrefix: meta.titlePrefix,
      files: meta.files,
      url: name === "news"
        ? "http://news.wapp.wii.com/v2/%d/%03d/news.bin"
        : "http://weather.wapp.wii.com/%d/%03d/forecast.bin",
    },
    container: { ...WC24_RSA2048, headerSize: layout.headerSize },
    header: layout.headerFields,
    tables: layout.tables.map((t) => ({
      name: t.name,
      countOffset: t.countOffset,
      offsetOffset: t.offsetOffset,
      entrySize: t.entrySize,
      decoded: t.entrySize != null,
    })),
    envelopeSchema: envelopeSchema(name),
    rendering: RENDERING[name],
  };
}

// Everybody Votes Channel — documented from RiiConnect24 votes.py. Not yet
// decoded here; included to show the definition system scaling to a different
// channel (note the distinct wrapper + 12-byte container prefix).
const EVERYBODY_VOTES_DEFINITION = {
  format: "wii-channel-definition/v1",
  channel: "everybodyVotes",
  status: "documented",
  meta: {
    label: "Everybody Votes Channel",
    titlePrefix: "HAJ",
    files: ["voting.bin", "first_data.bin"],
    url: "http://nwcs.wapp.wii.com/",
    provider: "RiiConnect24 votes.py",
  },
  container: {
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
  // Byte-packed header (struct.pack, unaligned), big-endian.
  header: [
    { offset: 0, type: "u32", name: "timestamp" },
    { offset: 4, type: "u8", name: "countryCode" },
    { offset: 5, type: "u8", name: "publicityFlag" },
    { offset: 6, type: "u8", name: "questionVersion" },
    { offset: 7, type: "u8", name: "resultVersion" },
    { offset: 8, type: "u8", name: "nationalQuestionNumber" },
    { offset: 9, type: "u32", name: "nationalQuestionOffset" },
    { offset: 13, type: "u8", name: "worldwideQuestionNumber" },
    { offset: 14, type: "u32", name: "worldwideQuestionOffset" },
    { offset: 18, type: "u8", name: "questionTextNumber" },
    { offset: 19, type: "u32", name: "questionTextOffset" },
    { offset: 23, type: "u8", name: "nationalResultNumber" },
    { offset: 24, type: "u32", name: "nationalResultOffset" },
    { offset: 28, type: "u16", name: "nationalResultDetailedNumber" },
    { offset: 30, type: "u32", name: "nationalResultDetailedOffset" },
    { offset: 34, type: "u16", name: "positionNumber" },
    { offset: 36, type: "u32", name: "positionOffset" },
    { offset: 40, type: "u8", name: "worldwideResultNumber" },
    { offset: 41, type: "u32", name: "worldwideResultOffset" },
    { offset: 45, type: "u16", name: "worldwideResultDetailedNumber" },
    { offset: 47, type: "u32", name: "worldwideResultDetailedOffset" },
    { offset: 51, type: "u16", name: "countryNameNumber" },
    { offset: 53, type: "u32", name: "countryNameOffset" },
  ],
  tables: [
    {
      name: "nationalQuestions",
      entryFields: "poll_id u32, category u8×2, opening u32, closing u32, textCount u8, textStart u32",
      decoded: false,
    },
    {
      name: "questionText",
      entryFields: "language u8, questionOffset u32, response1Offset u32, response2Offset u32 (UTF-16BE in blob)",
      decoded: false,
    },
    {
      name: "nationalResults",
      entryFields: "poll_id u32, male1/male2/female1/female2/predictor1/predictor2 u32, showVoters u8, detailedFlag u8, detailedCount u8, detailedStart u32",
      decoded: false,
    },
    { name: "nationalResultsDetailed", entryFields: "voters1 u32, voters2 u32, positionCount u8, positionStart u32", decoded: false },
    { name: "positions", entryFields: "per-region breakdown", decoded: false },
    { name: "worldwideResults", entryFields: "poll_id u32, summed counts u32×6, detailedCount u8, detailedStart u32", decoded: false },
    { name: "countryNames", entryFields: "language u8, textOffset u32 (UTF-16BE in blob)", decoded: false },
  ],
  rendering: RENDERING.everybodyVotes,
};

export const CHANNEL_DEFINITION_NAMES = ["news", "forecast", "everybodyVotes"];

/**
 * Return the self-contained definition for a channel: meta + url, container
 * wrapper, header/table structure, envelope schema, and rendering mapping.
 * @param {string} name "news" | "forecast" | "everybodyVotes"
 */
export function channelDefinition(name) {
  if (name === "everybodyVotes") {
    return EVERYBODY_VOTES_DEFINITION;
  }
  if (CHANNEL_LAYOUTS[name]) {
    return composeDefinition(name);
  }
  throw new Error(`no definition for channel "${name}"`);
}
