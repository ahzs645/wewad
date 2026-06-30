import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeNews } from "./news.js";
import { decodeChannelData, channelForTitleId } from "./index.js";
import { CHANNEL_DATA_FORMAT } from "./format.js";

// A real news.bin.00 fetched live from a WiiLink WC24 revival server (USA
// region, fetched 2026-06-30): WC24-wrapped, LZ10-compressed, signed, CRC32
// verified. Carries 7 real AP articles, 7 Wii-Menu headlines, 4 dateline
// locations, 8 topics and the AP source/copyright entry.
const fixture = new Uint8Array(
  readFileSync(new URL("./__fixtures__/sample-news.bin", import.meta.url)),
);

describe("decodeNews", () => {
  it("unwraps WC24 + LZ10 and returns a shared envelope", () => {
    const data = decodeNews(fixture);
    expect(data.format).toBe(CHANNEL_DATA_FORMAT);
    expect(data.channel).toBe("news");
    expect(data.version).toBe(512);
    expect(data.country).toBe(49);
    expect(data.language).toBe(1);
    expect(data.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("decodes article headlines and bodies as UTF-16BE", () => {
    const { articles } = decodeNews(fixture).payload;
    expect(articles).toHaveLength(7);
    expect(articles[0]).toMatchObject({
      id: 1,
      source: 0,
      headline: "Supreme Court ruling gives a reprieve to states with grace periods for receiving mail ballots",
    });
    expect(articles[0].body).toContain("U.S. Supreme Court rejected a Republican effort");
    expect(articles[0].published).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // every article has real, non-empty content — no garbage/truncated text.
    for (const a of articles) {
      expect(a.headline.length).toBeGreaterThan(0);
      expect(a.body.length).toBeGreaterThan(0);
    }
  });

  it("decodes the Wii-Menu headline feed (the icon/banner feed)", () => {
    const { menuHeadlines } = decodeNews(fixture).payload;
    expect(menuHeadlines).toHaveLength(7);
    expect(menuHeadlines[0]).toBe(
      "Supreme Court ruling gives a reprieve to states with grace periods for receiving mail ballots",
    );
  });

  it("decodes sources, topics and dateline locations", () => {
    const data = decodeNews(fixture);
    expect(data.payload.sources[0].copyright).toBe("Copyright 2026 The Associated Press. All rights reserved.");
    expect(data.payload.topics.map((t) => t.name)).toEqual([
      "",
      "National News",
      "International News",
      "Sports",
      "Arts/Entertainment",
      "Business",
      "Science/Health",
      "Technology",
    ]);
    expect(data.locations.map((l) => l.name)).toEqual(["Deir el-Balah", "Irvine", "Richmond", "Washington D.C."]);
  });
});

describe("channel registry", () => {
  it("resolves channels from a 4-char game code", () => {
    expect(channelForTitleId("HAGE")).toBe("news");
    expect(channelForTitleId("HAFE")).toBe("forecast");
    expect(channelForTitleId("XXXX")).toBeNull();
  });

  it("resolves channels from a full 16-hex title id", () => {
    // 0001000248414745 -> low 4 bytes "HAGE"
    expect(channelForTitleId("0001000248414745")).toBe("news");
  });

  it("decodeChannelData picks the decoder by title id", () => {
    const data = decodeChannelData(fixture, { titleId: "HAGE" });
    expect(data.channel).toBe("news");
    expect(data.payload.articles).toHaveLength(7);
  });
});
