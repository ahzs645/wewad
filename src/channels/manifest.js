// Per-channel "definition" JSON. Each channel is different — different download
// URL, container wrapper, tables, and on-screen interface — so each gets one
// self-contained descriptor that *explains* it: where its data comes from, how
// the bytes are laid out (structure), and how the decoded envelope maps to the
// UI (rendering). Save/download one per channel; a generic host can drive a
// channel purely from its definition.
//
// All three channels are composed from the live layout + decoder + schema
// (status "decoded"). Their wrappers genuinely differ — News/Forecast share a
// 256-byte-signature WC24 wrapper at 0x140; Everybody Votes uses a 128-byte
// signature, a body at 0xC0, and a 12-byte container prefix (RiiConnect24's
// votes.py) — which is exactly why per-channel definitions are needed.

import { CHANNELS } from "./index.js";
import { CHANNEL_LAYOUTS } from "./layouts.js";
import { envelopeSchema } from "./probe.js";

// Extra per-channel metadata not already on CHANNELS (index.js) or
// CHANNEL_LAYOUTS (layouts.js): the runtime download URL and, for Everybody
// Votes, attribution for the reverse-engineered format.
const CHANNEL_META = {
  news: { url: "http://news.wapp.wii.com/v2/%d/%03d/news.bin" },
  forecast: { url: "http://weather.wapp.wii.com/%d/%03d/forecast.bin" },
  everybodyVotes: { url: "http://nwcs.wapp.wii.com/", provider: "RiiConnect24 votes.py" },
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
    renderer: "renderEverybodyVotesChannel",
    layout: "poll question + two responses, male/female/predictor result bars",
    bindings: {
      question: "payload.questions[].text",
      responses: "payload.questions[].responses[]",
      results: "payload.results[] (scope, male/female/predictor counts per response)",
      regional: "payload.positions (count/offset only — see note)",
    },
    note: "positions (per-region breakdown) stays an extension point: each entry is a variable-length raw blob, so walking individual rows needs the per-country region-count table from voteslists.py, which isn't ported here.",
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
      ...CHANNEL_META[name],
    },
    container: { ...layout.wrapper, headerSize: layout.headerSize },
    header: layout.headerFields,
    tables: layout.tables.map((t) => ({
      name: t.name,
      countOffset: t.countOffset,
      offsetOffset: t.offsetOffset,
      countType: t.countType,
      entrySize: t.entrySize,
      decoded: t.entrySize != null,
    })),
    envelopeSchema: envelopeSchema(name),
    rendering: RENDERING[name],
  };
}

export const CHANNEL_DEFINITION_NAMES = ["news", "forecast", "everybodyVotes"];

/**
 * Return the self-contained definition for a channel: meta + url, container
 * wrapper, header/table structure, envelope schema, and rendering mapping.
 * @param {string} name "news" | "forecast" | "everybodyVotes"
 */
export function channelDefinition(name) {
  if (CHANNEL_LAYOUTS[name]) {
    return composeDefinition(name);
  }
  throw new Error(`no definition for channel "${name}"`);
}
