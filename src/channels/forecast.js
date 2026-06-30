// Forecast Channel (title HAFE...) data decoder: forecast.bin -> shared
// ChannelData. Same WC24 wrapper + header-with-table-descriptors shape as the
// News Channel; only the tables differ.
//
// Container header (88 bytes, big-endian): version, filesize, crc32, open/close
// timestamps, country/language, a temperature flag, then paired (count, offset)
// descriptors for the Long-forecast, Short-forecast, Weather-condition, UV,
// Laundry, Pollen and Locations tables.
//
// Table layouts are transcribed from WiiLink24/ForecastChannel. Locations,
// conditions and the long-forecast table are decoded here and validated by a
// round-trip against the canonical structs serialized with Go's encoding/binary
// (see forecast.test.js). That confirms offsets, strides, endianness and the
// coordinate scale; the values themselves are not checked against live weather
// data (no public forecast.bin was reachable). See docs/CHANNEL_DATA_FORMAT.md.

import {
  u8,
  i8,
  u16,
  i16,
  u32,
  readUtf16BEZ,
  wiiMinutesToISO,
  decodeCoordinate,
} from "./binary.js";
import { unwrapWC24 } from "./wc24.js";
import { createChannelData } from "./format.js";

const LOCATION_ENTRY_SIZE = 24;
const CONDITION_ENTRY_SIZE = 8;
const LONG_FORECAST_ENTRY_SIZE = 121;

function readLocation(c, base) {
  return {
    name: readUtf16BEZ(c, u32(c, base + 4)),
    region: readUtf16BEZ(c, u32(c, base + 8)),
    country: readUtf16BEZ(c, u32(c, base + 12)),
    lat: decodeCoordinate(i16(c, base + 16)),
    lng: decodeCoordinate(i16(c, base + 18)),
    countryCode: u8(c, base + 0),
    regionCode: u8(c, base + 1),
    locationCode: u16(c, base + 2),
  };
}

function readCondition(c, base) {
  return {
    code1: u16(c, base + 0),
    code2: u16(c, base + 2),
    name: readUtf16BEZ(c, u32(c, base + 4)),
  };
}

// Ordered field layout of LongForecastTable (WiiLink24/ForecastChannel), used to
// walk each fixed 121-byte entry. Generated to exactly mirror the Go struct.
function longForecastFields() {
  const f = [
    ["countryCode", "u8"],
    ["regionCode", "u8"],
    ["locationCode", "u16"],
    ["localTimestamp", "u32"],
    ["globalTimestamp", "u32"],
    ["unknown", "u32"],
  ];
  const periods = ["12AMto6AM", "6AMto12PM", "12PMto6PM", "6PMto12AM"];
  for (const day of ["today", "tomorrow"]) {
    f.push([`${day}Forecast`, "u16"]);
    for (const p of periods) f.push([`${day}_6h_${p}`, "u16"]);
    f.push(
      [`${day}HighC`, "i8"],
      [`${day}HighDiffC`, "i8"],
      [`${day}LowC`, "i8"],
      [`${day}LowDiffC`, "i8"],
      [`${day}HighF`, "i8"],
      [`${day}HighDiffF`, "i8"],
      [`${day}LowF`, "i8"],
      [`${day}LowDiffF`, "i8"],
    );
    for (const p of periods) f.push([`${day}Precip_${p}`, "u8"]);
    f.push(
      [`${day}WindDir`, "u8"],
      [`${day}WindMetric`, "u8"],
      [`${day}WindImperial`, "u8"],
      [`${day}UV`, "u8"],
      [`${day}Laundry`, "u8"],
      [`${day}Pollen`, "u8"],
    );
  }
  for (let d = 1; d <= 7; d++) {
    f.push(
      [`day${d}Forecast`, "u16"],
      [`day${d}HighC`, "i8"],
      [`day${d}LowC`, "i8"],
      [`day${d}HighF`, "i8"],
      [`day${d}LowF`, "i8"],
      [`day${d}Precip`, "i8"],
    );
  }
  return f;
}

const LONG_FIELDS = longForecastFields();
const READERS = { u8, i8, u16, i16, u32 };
const SIZES = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4 };

function readLongForecast(c, base, conditionNames) {
  const raw = {};
  let p = base;
  for (const [name, type] of LONG_FIELDS) {
    raw[name] = READERS[type](c, p);
    p += SIZES[type];
  }
  const day = (forecastCode, highC, lowC, highF, lowF) => ({
    condition: forecastCode,
    conditionName: conditionNames.get(forecastCode) ?? null,
    highC,
    lowC,
    highF,
    lowF,
  });
  const fiveDay = [];
  for (let d = 1; d <= 7; d++) {
    fiveDay.push({
      condition: raw[`day${d}Forecast`],
      conditionName: conditionNames.get(raw[`day${d}Forecast`]) ?? null,
      highC: raw[`day${d}HighC`],
      lowC: raw[`day${d}LowC`],
      highF: raw[`day${d}HighF`],
      lowF: raw[`day${d}LowF`],
      precipitation: raw[`day${d}Precip`],
    });
  }
  return {
    location: {
      countryCode: raw.countryCode,
      regionCode: raw.regionCode,
      locationCode: raw.locationCode,
    },
    updated: wiiMinutesToISO(raw.globalTimestamp),
    today: day(raw.todayForecast, raw.todayHighC, raw.todayLowC, raw.todayHighF, raw.todayLowF),
    tomorrow: day(
      raw.tomorrowForecast,
      raw.tomorrowHighC,
      raw.tomorrowLowC,
      raw.tomorrowHighF,
      raw.tomorrowLowF,
    ),
    fiveDay,
  };
}

/**
 * Decode a Forecast Channel data file (forecast.bin) into the shared envelope.
 * @param {Uint8Array} fileBytes whole forecast.bin (WC24-wrapped)
 * @returns {import("./format.js").ChannelData}
 */
export function decodeForecast(fileBytes) {
  const c = unwrapWC24(fileBytes);

  const data = createChannelData("forecast", {
    version: u32(c, 0),
    country: u8(c, 20),
    language: u8(c, 24),
    updated: wiiMinutesToISO(u32(c, 12)),
    expires: wiiMinutesToISO(u32(c, 16)),
  });

  const nLong = u32(c, 32);
  const longOffset = u32(c, 36);
  const nShort = u32(c, 40);
  const nConditions = u32(c, 48);
  const conditionOffset = u32(c, 52);
  const nUV = u32(c, 56);
  const nLaundry = u32(c, 64);
  const nPollen = u32(c, 72);
  const nLocations = u32(c, 80);
  const locationOffset = u32(c, 84);

  for (let i = 0; i < nLocations; i++) {
    data.locations.push(readLocation(c, locationOffset + i * LOCATION_ENTRY_SIZE));
  }

  const conditions = [];
  const conditionNames = new Map();
  for (let i = 0; i < nConditions; i++) {
    const cond = readCondition(c, conditionOffset + i * CONDITION_ENTRY_SIZE);
    conditions.push(cond);
    conditionNames.set(cond.code1, cond.name);
  }

  const forecasts = [];
  for (let i = 0; i < nLong; i++) {
    forecasts.push(readLongForecast(c, longOffset + i * LONG_FORECAST_ENTRY_SIZE, conditionNames));
  }

  data.payload = {
    temperatureFlag: u8(c, 25),
    conditions,
    forecasts,
    // Index/short tables share the same descriptor shape; counts are surfaced so
    // callers know they exist. Full per-entry decoding is a documented extension.
    counts: { shortForecasts: nShort, uvIndex: nUV, laundryIndex: nLaundry, pollenCount: nPollen },
  };
  return data;
}
