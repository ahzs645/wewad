import { describe, expect, it } from "vitest";
import { channelDefinition, CHANNEL_DEFINITION_NAMES } from "./manifest.js";

describe("channelDefinition", () => {
  it("lists the known channels", () => {
    expect(CHANNEL_DEFINITION_NAMES).toEqual(["news", "forecast", "everybodyVotes"]);
  });

  it("composes a decoded definition for News with structure + rendering", () => {
    const d = channelDefinition("news");
    expect(d.status).toBe("decoded");
    expect(d.container).toMatchObject({ bodyOffset: 0x140, signatureBytes: 256, compression: "LZ10" });
    expect(d.header.length).toBeGreaterThan(0);
    expect(d.envelopeSchema.properties.channel.const).toBe("news");
    expect(d.rendering.renderer).toBe("renderNewsChannel");
    expect(d.rendering.bindings.ticker).toBe("payload.menuHeadlines[]");
  });

  it("composes a decoded definition for Everybody Votes with its distinct container", () => {
    const d = channelDefinition("everybodyVotes");
    expect(d.status).toBe("decoded");
    // wrapper differs from News/Forecast — the reason per-channel definitions exist.
    expect(d.container.bodyOffset).toBe(0xc0);
    expect(d.container.signatureBytes).toBe(128);
    expect(d.container.containerPrefix.bytes).toBe(12);
    expect(d.meta.files).toContain("voting.bin");
    expect(d.rendering.renderer).toBe("renderEverybodyVotesChannel");
  });

  it("throws for an unknown channel", () => {
    expect(() => channelDefinition("bogus")).toThrow(/no definition/);
  });
});
