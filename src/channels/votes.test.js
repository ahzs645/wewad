import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeEverybodyVotes } from "./votes.js";
import { decodeChannelData, channelForTitleId } from "./index.js";
import { CHANNEL_DATA_FORMAT } from "./format.js";

// A voting.bin built by serializing the layout transcribed from RiiConnect24's
// votes.py/voteslists.py (header fields, table entry sizes, the EV-specific
// wrapper: 128-byte signature, 0xC0 body offset, 12-byte container prefix) —
// so the bytes match the real on-disk shape. Decoding it here validates this
// module's offsets, strides, table linkage and the wrapper/prefix handling
// independently of the hand-written reader, the same way sample-forecast.bin
// validates forecast.js. No live voting.bin was reachable, so values are not
// confirmed against a real poll — see docs/CHANNEL_DATA_FORMAT.md.
const fixture = new Uint8Array(
  readFileSync(new URL("./__fixtures__/sample-everybody-votes.bin", import.meta.url)),
);

describe("decodeEverybodyVotes", () => {
  it("returns a shared envelope", () => {
    const data = decodeEverybodyVotes(fixture);
    expect(data.format).toBe(CHANNEL_DATA_FORMAT);
    expect(data.channel).toBe("everybodyVotes");
    expect(data.country).toBe(1);
    expect(data.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("resolves national and worldwide questions with localized text", () => {
    const { questions } = decodeEverybodyVotes(fixture).payload;
    expect(questions).toHaveLength(2);

    const national = questions.find((q) => q.scope === "national");
    expect(national).toMatchObject({ pollId: 101, text: "Do you prefer cats?", responses: ["Cats", "Dogs"] });
    expect(national.translations).toHaveLength(2);
    expect(national.translations[1]).toMatchObject({
      language: 2,
      text: "Preferez-vous les chats?",
      responses: ["Chats", "Chiens"],
    });

    const worldwide = questions.find((q) => q.scope === "worldwide");
    expect(worldwide).toMatchObject({ pollId: 202, text: "Is pizza the best food?", responses: ["Yes", "No"] });
    expect(worldwide.translations).toHaveLength(1);
  });

  it("decodes national and worldwide results with male/female/predictor counts", () => {
    const { results } = decodeEverybodyVotes(fixture).payload;
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      scope: "national",
      pollId: 101,
      male: [120, 80],
      female: [100, 95],
      predictors: [150, 50],
    });
    expect(results[1]).toMatchObject({ scope: "worldwide", pollId: 202, male: [300, 200], predictors: [350, 150] });
  });

  it("decodes the flat raw tables alongside the resolved views", () => {
    const { payload } = decodeEverybodyVotes(fixture);
    expect(payload.nationalResultsDetailed).toEqual([{ voters: [120, 80], positionCount: 2, positionStart: 0 }]);
    expect(payload.worldwideResultsDetailed).toEqual([
      { male: [120, 80], female: [100, 95], countryNameCount: 2, countryNameStart: 0 },
    ]);
    expect(payload.countryNames).toEqual([
      { language: 1, name: "United States" },
      { language: 2, name: "USA" },
    ]);
  });

  it("leaves positions as an undecoded extension point (variable-length per-country blob)", () => {
    const { positions } = decodeEverybodyVotes(fixture).payload;
    expect(positions).toEqual({ count: 2, offset: 182, decoded: false });
  });

  it("is reachable through the registry by title code", () => {
    expect(channelForTitleId("HAJE")).toBe("everybodyVotes");
    const data = decodeChannelData(fixture, { titleId: "HAJE" });
    expect(data.channel).toBe("everybodyVotes");
    expect(data.payload.questions).toHaveLength(2);
  });
});
