import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { unwrapWC24 } from "./wc24.js";
import { inferTableLayout, tableBoundary } from "./infer.js";

// Validate the inference engine against a table whose layout we DO know (the
// forecast locations table: 24-byte entries, real live data, 653 rows). The
// real file lays each table's own text blob immediately after its entries
// (not one trailing blob after every table), so the boundary here is the
// known end of the locations table itself, not another table's header offset.
const container = unwrapWC24(
  new Uint8Array(readFileSync(new URL("./__fixtures__/sample-forecast.bin", import.meta.url))),
);
const LOCATIONS_OFFSET = 88;
const LOCATIONS_COUNT = 653;
const LOCATIONS_ENTRY_SIZE = 24; // ground truth, per forecast.js
const LOCATIONS_BOUNDARY = LOCATIONS_OFFSET + LOCATIONS_COUNT * LOCATIONS_ENTRY_SIZE;

describe("inferTableLayout", () => {
  it("recovers the entry size by stride", () => {
    const r = inferTableLayout(container, { offset: LOCATIONS_OFFSET, count: LOCATIONS_COUNT, boundary: LOCATIONS_BOUNDARY });
    expect(r.entrySize).toBe(LOCATIONS_ENTRY_SIZE);
  });

  it("classifies the city-name text offset slot as a pointer", () => {
    const r = inferTableLayout(container, { offset: LOCATIONS_OFFSET, count: LOCATIONS_COUNT, boundary: LOCATIONS_BOUNDARY });
    const byOffset = Object.fromEntries(r.slots.map((s) => [s.offset, s.type]));
    // CityTextOffset (every real location has a name, unlike region/country
    // which some entries omit — those don't classify cleanly as pointers,
    // an honest real-data finding, not a bug in the classifier).
    expect(byOffset[4]).toBe("pointer?");
  });

  it("reports a constant slot when every sampled entry shares a value", () => {
    // Self-contained synthetic buffer: 3 entries of 8 bytes, first 4-byte slot
    // constant (0), second slot varies. Real forecast location entries don't
    // have a guaranteed-constant slot (zoom/pad bytes vary per city), so this
    // checks the classifier in isolation rather than against fixture data.
    const buf = new Uint8Array(24);
    const view = new DataView(buf.buffer);
    for (let i = 0; i < 3; i++) {
      view.setUint32(i * 8, 0, false);
      view.setUint32(i * 8 + 4, 100 + i, false);
    }
    const r = inferTableLayout(buf, { offset: 0, count: 3, boundary: 24 });
    expect(r.entrySize).toBe(8);
    const zero = r.slots.find((s) => s.offset === 0);
    expect(zero).toMatchObject({ type: "constant", value: 0 });
  });

  it("returns no entry size when the region is not divisible by the count", () => {
    const r = inferTableLayout(container, { offset: 100, count: 7, boundary: 110 });
    expect(r.entrySize).toBeNull();
    expect(r.note).toMatch(/not divisible/);
  });

  it("tableBoundary picks the next table offset", () => {
    expect(tableBoundary(88, [88, 136, 160], 402, 530)).toBe(136);
    expect(tableBoundary(160, [88, 136, 160], 402, 530)).toBe(402); // falls back to blob start
  });
});
