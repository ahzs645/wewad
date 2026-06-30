import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { unwrapWC24 } from "./wc24.js";
import { u32 } from "./binary.js";
import { inferTableLayout, tableBoundary } from "./infer.js";

// Validate the inference engine against a table whose layout we DO know (the
// forecast locations table: 24-byte entries with string pointers at 4/8/12).
const container = unwrapWC24(
  new Uint8Array(readFileSync(new URL("./__fixtures__/sample-forecast.bin", import.meta.url))),
);

describe("inferTableLayout", () => {
  it("recovers the entry size by stride", () => {
    const r = inferTableLayout(container, { offset: u32(container, 84), count: u32(container, 80), boundary: u32(container, 52) });
    expect(r.entrySize).toBe(24); // ground truth
  });

  it("classifies the string-offset slots as pointers", () => {
    const r = inferTableLayout(container, { offset: u32(container, 84), count: u32(container, 80), boundary: u32(container, 52) });
    const byOffset = Object.fromEntries(r.slots.map((s) => [s.offset, s.type]));
    // city / region / country text offsets
    expect(byOffset[4]).toBe("pointer?");
    expect(byOffset[8]).toBe("pointer?");
    expect(byOffset[12]).toBe("pointer?");
  });

  it("reports a constant slot for zero-filled padding", () => {
    const r = inferTableLayout(container, { offset: u32(container, 84), count: u32(container, 80), boundary: u32(container, 52) });
    const zoom = r.slots.find((s) => s.offset === 20);
    expect(zoom).toMatchObject({ type: "constant", value: 0 });
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
