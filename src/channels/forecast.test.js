import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeForecast } from "./forecast.js";
import { decodeChannelData } from "./index.js";
import { CHANNEL_DATA_FORMAT } from "./format.js";

// A real forecast.bin fetched live from a WiiLink WC24 revival server (Japan
// region, fetched 2026-06-30) — WC24-wrapped, LZ10-compressed, signed, CRC32
// verified. Decoding real data (not a hand-built or self-generated fixture) is
// what caught the 7-day-tail padding-byte bug: the long-forecast entry is 128
// bytes, not 121 — Go's LongForecastTable leaves a 1-byte pad after each day's
// Precipitation field, which only shows up once you read more than one entry's
// 7-day tail. See docs/CHANNEL_DATA_FORMAT.md.
const fixture = new Uint8Array(
  readFileSync(new URL("./__fixtures__/sample-forecast.bin", import.meta.url)),
);

describe("decodeForecast", () => {
  it("returns a shared envelope with a valid checksum", () => {
    const data = decodeForecast(fixture);
    expect(data.format).toBe(CHANNEL_DATA_FORMAT);
    expect(data.channel).toBe("forecast");
    expect(data.version).toBe(0);
    expect(data.country).toBe(1);
    expect(data.language).toBe(1);
    expect(data.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("decodes all locations with names and quantized coordinates", () => {
    const { locations } = decodeForecast(fixture);
    expect(locations).toHaveLength(653);
    expect(locations[0]).toMatchObject({
      name: "Tokyo",
      region: "Tokyo",
      country: "Japan",
      countryCode: 1,
      regionCode: 2,
      locationCode: 1,
    });
    expect(locations[0].lat).toBeCloseTo(35.68, 1);
    expect(locations[0].lng).toBeCloseTo(139.76, 1);
    expect(locations[1].name).toBe("Hachijojima");
  });

  it("maps weather condition codes to names", () => {
    const { conditions } = decodeForecast(fixture).payload;
    expect(conditions).toHaveLength(80);
    expect(conditions[0]).toMatchObject({ code1: 1124, code2: 101, name: "Sunny" });
    expect(conditions[1]).toMatchObject({ code1: 100, code2: 1, name: "Sunny" });
  });

  it("decodes today/tomorrow for every forecast entry", () => {
    const { forecasts } = decodeForecast(fixture).payload;
    expect(forecasts).toHaveLength(283);
    const f0 = forecasts[0];
    expect(f0.location).toEqual({ countryCode: 1, regionCode: 2, locationCode: 1 });
    expect(f0.today).toMatchObject({ conditionName: "Showers", highC: 28, lowC: 21, highF: 83, lowF: 70 });
    expect(f0.tomorrow).toMatchObject({ conditionName: "Rain", highC: 23, lowC: 20, highF: 75, lowF: 68 });

    const f1 = forecasts[1];
    expect(f1.location).toEqual({ countryCode: 1, regionCode: 2, locationCode: 2 });
    expect(f1.today).toMatchObject({ conditionName: "Thunderstorms", highC: 25, lowC: 23 });
  });

  it("decodes the full 7-day tail without drift past day 1 (regression: padding-byte bug)", () => {
    const { forecasts } = decodeForecast(fixture).payload;
    const f0 = forecasts[0];
    expect(f0.fiveDay).toHaveLength(7);
    // Every day must resolve to a real condition name and a plausible
    // temperature — the padding-byte bug produced nulls/impossible values
    // (e.g. highC: -59) starting at day 2 for every entry past the first.
    for (const day of f0.fiveDay) {
      expect(day.conditionName).not.toBeNull();
      expect(day.highC).toBeGreaterThan(-90);
      expect(day.highC).toBeLessThan(60);
      expect(day.lowC).toBeGreaterThan(-90);
      expect(day.lowC).toBeLessThan(60);
    }
    expect(f0.fiveDay[0]).toMatchObject({ conditionName: "Rain", highC: 23, precipitation: 58 });

    // forecasts[1] only decodes correctly if the entry-to-entry stride (128,
    // not 121) is also right — its 7-day tail would be reading inside
    // forecasts[0]'s bytes otherwise.
    const f1 = forecasts[1];
    expect(f1.fiveDay[6]).toMatchObject({ conditionName: "Intermittent Clouds", highC: 28, precipitation: 25 });
  });

  it("surfaces the not-yet-decoded index tables as counts", () => {
    const { counts } = decodeForecast(fixture).payload;
    expect(counts).toEqual({ shortForecasts: 372, uvIndex: 13, laundryIndex: 12, pollenCount: 5 });
  });

  it("is reachable through the registry by title code", () => {
    const data = decodeChannelData(fixture, { titleId: "HAFE" });
    expect(data.channel).toBe("forecast");
    expect(data.payload.forecasts).toHaveLength(283);
  });
});
