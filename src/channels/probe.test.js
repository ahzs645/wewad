import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { probeChannelData } from "./probe.js";

const load = (name) => new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));

describe("probeChannelData", () => {
  it("reports the News container structure with a valid checksum", () => {
    const r = probeChannelData(load("sample-news.bin"), { channel: "news" });
    expect(r.format).toBe("wii-channel-data-probe/v1");
    expect(r.channel).toBe("news");
    expect(r.file.wrapper).toMatchObject({ bodyOffset: 0x140, compression: "LZ10" });
    expect(r.container.crc32.valid).toBe(true);

    const byName = Object.fromEntries(r.tables.map((t) => [t.name, t]));
    expect(byName.articles).toMatchObject({ count: 3, entrySize: 44 });
    expect(byName.menuHeadlines).toMatchObject({ count: 3, entrySize: 8 });
    expect(byName.articles.samples[0].headline).toContain("WiiNewsPR custom headline");
    expect(byName.articles.firstEntryHex).toMatch(/^[0-9a-f ]+$/);
  });

  it("reports the Forecast container structure", () => {
    const r = probeChannelData(load("sample-forecast.bin"), { channel: "forecast" });
    expect(r.channel).toBe("forecast");
    expect(r.container.crc32.valid).toBe(true);

    const byName = Object.fromEntries(r.tables.map((t) => [t.name, t]));
    expect(byName.locations).toMatchObject({ count: 2, entrySize: 24 });
    expect(byName.longForecast).toMatchObject({ count: 2, entrySize: 121 });
    // samples are capped (default sampleLimit 2) even though count is 3.
    expect(byName.weatherConditions.count).toBe(3);
    expect(byName.weatherConditions.samples.map((c) => c.name)).toEqual(["Sunny", "Cloudy"]);
  });

  it("annotates header fields and interprets timestamps", () => {
    const r = probeChannelData(load("sample-news.bin"), { channel: "news" });
    const updated = r.header.fields.find((f) => f.name === "updated");
    expect(updated.type).toBe("timestamp");
    expect(updated.value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof updated.raw).toBe("number");
  });

  it("emits a JSON Schema for the decoded envelope", () => {
    const r = probeChannelData(load("sample-forecast.bin"), { channel: "forecast" });
    expect(r.schema.properties.channel.const).toBe("forecast");
    expect(r.schema.properties.payload.properties).toHaveProperty("forecasts");
  });
});
