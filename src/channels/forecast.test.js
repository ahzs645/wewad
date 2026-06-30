import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeForecast } from "./forecast.js";
import { decodeChannelData } from "./index.js";
import { CHANNEL_DATA_FORMAT } from "./format.js";

// A forecast.bin built by serializing the canonical WiiLink24/ForecastChannel
// structs with Go's encoding/binary (big-endian) — so the bytes match the real
// layout/packing. Decoding it here validates this module's offsets, strides,
// endianness and coordinate scale independently of the hand-written reader.
const fixture = new Uint8Array(
  readFileSync(new URL("./__fixtures__/sample-forecast.bin", import.meta.url)),
);

describe("decodeForecast", () => {
  it("returns a shared envelope", () => {
    const data = decodeForecast(fixture);
    expect(data.format).toBe(CHANNEL_DATA_FORMAT);
    expect(data.channel).toBe("forecast");
    expect(data.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("decodes locations with names and quantized coordinates", () => {
    const { locations } = decodeForecast(fixture);
    expect(locations).toHaveLength(2);
    expect(locations[0]).toMatchObject({
      name: "San Juan",
      region: "Puerto Rico",
      country: "USA",
      countryCode: 1,
      regionCode: 4,
      locationCode: 49,
    });
    // int16-quantized round-trip of 18.4663 / -66.1057.
    expect(locations[0].lat).toBeCloseTo(18.46, 1);
    expect(locations[0].lng).toBeCloseTo(-66.11, 1);
    expect(locations[1].name).toBe("Tokyo");
    expect(locations[1].lat).toBeCloseTo(35.69, 1);
  });

  it("maps weather condition codes to names", () => {
    const { conditions } = decodeForecast(fixture).payload;
    expect(conditions.map((c) => `${c.code1}:${c.name}`)).toEqual([
      "16:Sunny",
      "12:Cloudy",
      "4:Rain",
    ]);
  });

  it("decodes the long forecast: today, tomorrow and the 7-day tail", () => {
    const { forecasts } = decodeForecast(fixture).payload;
    expect(forecasts).toHaveLength(2);
    const f0 = forecasts[0];
    expect(f0.location).toEqual({ countryCode: 1, regionCode: 4, locationCode: 49 });
    expect(f0.today).toMatchObject({ conditionName: "Sunny", highC: 31, lowC: 24, highF: 88, lowF: 75 });
    expect(f0.tomorrow).toMatchObject({ conditionName: "Cloudy", highC: 30, lowC: 23 });
    expect(f0.fiveDay[0]).toMatchObject({ conditionName: "Rain", highC: 29, precipitation: 60 });
    expect(forecasts[1].today).toMatchObject({ conditionName: "Cloudy", highC: 27 });
  });

  it("is reachable through the registry by title code", () => {
    const data = decodeChannelData(fixture, { titleId: "HAFE" });
    expect(data.channel).toBe("forecast");
    expect(data.payload.forecasts).toHaveLength(2);
  });
});
