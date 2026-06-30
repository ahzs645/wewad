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

  it("reports the Everybody Votes container structure through its distinct wrapper", () => {
    const r = probeChannelData(load("sample-everybody-votes.bin"), { channel: "everybodyVotes" });
    expect(r.file.wrapper).toMatchObject({ bodyOffset: 0xc0, signatureBytes: 128, compression: "LZ10" });
    // crc32 lives in the 12-byte prefix ahead of the header, not inside it —
    // still validates against the post-prefix container, per votes.py.
    expect(r.container.crc32.valid).toBe(true);

    const byName = Object.fromEntries(r.tables.map((t) => [t.name, t]));
    // counts are not all u32 in this format (several are u8/u16) — confirms
    // probe.js reads each table's count at its declared width.
    expect(byName.nationalQuestions).toMatchObject({ count: 1, entrySize: 19 });
    expect(byName.nationalResultsDetailed).toMatchObject({ count: 1, entrySize: 13 });
    expect(byName.countryNames).toMatchObject({ count: 2, entrySize: 5 });
    expect(byName.countryNames.samples[1]).toMatchObject({ name: "USA" });

    // positions is a genuine extension point (variable entry size); the probe
    // still infers a candidate stride from the file.
    expect(byName.positions.entrySize).toBeNull();
    expect(byName.positions.inferred?.entrySize).toBe(4);
  });
});
