import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeNews } from "./news.js";
import { decodeChannelData, channelForTitleId } from "./index.js";
import { CHANNEL_DATA_FORMAT } from "./format.js";

// A real (self-generated) news.bin.00: WC24-wrapped, LZ10-compressed, signed.
// Carries 3 known articles + 3 Wii-Menu headlines.
const fixture = new Uint8Array(
  readFileSync(new URL("./__fixtures__/sample-news.bin", import.meta.url)),
);

describe("decodeNews", () => {
  it("unwraps WC24 + LZ10 and returns a shared envelope", () => {
    const data = decodeNews(fixture);
    expect(data.format).toBe(CHANNEL_DATA_FORMAT);
    expect(data.channel).toBe("news");
    expect(data.version).toBe(512);
    expect(data.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("decodes article headlines and bodies as UTF-16BE", () => {
    const { articles } = decodeNews(fixture).payload;
    expect(articles).toHaveLength(3);
    expect(articles[0].headline).toBe("WiiNewsPR custom headline test #1 - it works!");
    expect(articles[0].body).toContain("generated entirely by our own tool");
    expect(articles[0].published).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("decodes the Wii-Menu headline feed (the icon/banner feed)", () => {
    const { menuHeadlines } = decodeNews(fixture).payload;
    expect(menuHeadlines).toHaveLength(3);
    expect(menuHeadlines[0]).toBe("WiiNewsPR custom headline test #1 - it works!");
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
    expect(data.payload.articles).toHaveLength(3);
  });
});
