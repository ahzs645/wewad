// The shared cross-channel data format. Every Wii channel data feed (News,
// Forecast, and future ones) decodes into this one envelope so a single renderer
// / pipeline can consume them. The binary layers differ per channel, but they
// all share: a WC24 wrapper, a header with paired (count, offset) table
// descriptors, a UTF-16BE text blob, minutes-since-2000 timestamps, and a
// Locations primitive. Channel-specific data lives under `payload`, discriminated
// by `channel`. See docs/CHANNEL_DATA_FORMAT.md for the full spec.

/** Current shared-format version tag stored on every envelope. */
export const CHANNEL_DATA_FORMAT = "wii-channel-data/v1";

/**
 * @typedef {Object} ChannelLocation  Shared location primitive (News + Forecast).
 * @property {string} name         City/place name.
 * @property {string} region       Region/province name (may be "").
 * @property {string} country      Country name (may be "").
 * @property {number|null} lat      Latitude in degrees (null if not provided).
 * @property {number|null} lng      Longitude in degrees (null if not provided).
 * @property {number} countryCode   Nintendo country code.
 * @property {number} regionCode     Nintendo region code.
 * @property {number} locationCode   Nintendo city/location code.
 */

/**
 * @typedef {Object} ChannelData  The shared envelope returned by every decoder.
 * @property {"wii-channel-data/v1"} format
 * @property {"news"|"forecast"|string} channel  Discriminator for `payload`.
 * @property {number} version       Raw container version (e.g. 512 = v2).
 * @property {number} country       Header CountryCode.
 * @property {number} language      Header LanguageCode.
 * @property {string|null} updated  ISO-8601 of the file's open/updated time.
 * @property {string|null} expires  ISO-8601 of the file's close/end time.
 * @property {ChannelLocation[]} locations
 * @property {Object} payload       Channel-specific data (see news.js / forecast.js).
 */

/**
 * Build a shared envelope. Decoders fill `payload` with their channel-specific
 * shape and push any `locations` they carry.
 * @returns {ChannelData}
 */
export function createChannelData(channel, { version, country, language, updated, expires } = {}) {
  return {
    format: CHANNEL_DATA_FORMAT,
    channel,
    version: version ?? 0,
    country: country ?? 0,
    language: language ?? 0,
    updated: updated ?? null,
    expires: expires ?? null,
    locations: [],
    payload: {},
  };
}
