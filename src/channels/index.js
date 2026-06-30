// Channel data registry. Maps a channel (by name or Wii title/game code) to its
// decoder, so the rest of the app — and future channels — go through one entry
// point. To add a channel: write a decoder that returns a shared ChannelData
// envelope (see format.js) and register it here.

import { decodeNews } from "./news.js";
import { decodeForecast } from "./forecast.js";

export { decodeNews } from "./news.js";
export { decodeForecast } from "./forecast.js";
export { unwrapWC24, lz10Decompress } from "./wc24.js";
export { CHANNEL_DATA_FORMAT, createChannelData } from "./format.js";

// The 4-char ASCII game code's first 3 chars identify the channel; the 4th is the
// region (E=USA, J=Japan, P=Europe, ...). News = HAG?, Forecast = HAF?.
export const CHANNELS = {
  news: {
    decode: decodeNews,
    titlePrefix: "HAG",
    files: ["news.bin.00 … news.bin.23"],
    label: "News Channel",
  },
  forecast: {
    decode: decodeForecast,
    titlePrefix: "HAF",
    files: ["forecast.bin", "short.bin"],
    label: "Forecast Channel",
  },
};

/**
 * Resolve a channel name from a 4-char game code (e.g. "HAGE" -> "news").
 * @param {string} titleId 4-char ASCII game code, or full 16-hex-digit title id.
 * @returns {string|null}
 */
export function channelForTitleId(titleId) {
  if (!titleId) {
    return null;
  }
  let code = String(titleId).trim();
  // Accept a full 16-hex-char title id by taking its low 4 bytes as ASCII.
  if (/^[0-9a-fA-F]{16}$/.test(code)) {
    code = code
      .slice(8)
      .match(/.{2}/g)
      .map((h) => String.fromCharCode(parseInt(h, 16)))
      .join("");
  }
  const prefix = code.slice(0, 3).toUpperCase();
  for (const [name, def] of Object.entries(CHANNELS)) {
    if (def.titlePrefix === prefix) {
      return name;
    }
  }
  return null;
}

/**
 * Decode a channel data file into the shared envelope, picking the decoder by
 * explicit channel name or by title/game code.
 * @param {Uint8Array} fileBytes
 * @param {{channel?: string, titleId?: string}} options
 * @returns {import("./format.js").ChannelData}
 */
export function decodeChannelData(fileBytes, { channel, titleId } = {}) {
  const name = channel ?? channelForTitleId(titleId);
  const def = name && CHANNELS[name];
  if (!def) {
    throw new Error(
      `unknown channel${name ? ` "${name}"` : ""}${titleId ? ` (title ${titleId})` : ""}`,
    );
  }
  return def.decode(fileBytes);
}
