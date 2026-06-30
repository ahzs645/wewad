// Structure discovery for tables whose entry layout we don't yet know. Given a
// table's (offset, count) and the boundary where it ends, it infers the entry
// size by stride and classifies each 4-byte slot across all entries (constant,
// small int, blob pointer, timestamp, …). This turns a real file into candidate
// decoder fields — point it at the "extension point" tables (short-forecast,
// UV/laundry/pollen, Everybody Votes results) to derive their layout.
//
// Inference is coarse (4-byte granularity) and heuristic; it's a discovery aid,
// not a decoder. Confirm a candidate against a few files before trusting it.

import { u32 } from "./binary.js";

// Minutes-since-2000 that land roughly in 2020–2031 — a value in this band in a
// u32 slot is very likely a timestamp.
const TS_MIN = 10_000_000;
const TS_MAX = 16_500_000;

function classifySlot(values, containerLength) {
  const unique = new Set(values);
  if (unique.size === 1) {
    return { type: "constant", value: values[0] };
  }
  const all = (pred) => values.every(pred);
  if (all((v) => v >= TS_MIN && v <= TS_MAX)) {
    return { type: "timestamp?" };
  }
  // A plausible pointer: every value lands inside the container, past the header.
  if (all((v) => v >= 48 && v < containerLength)) {
    return { type: "pointer?", note: "values fall within the container — likely an offset into the blob" };
  }
  if (all((v) => v < 1024)) {
    return { type: "smallInt" };
  }
  return { type: "u32" };
}

/**
 * Infer the entry layout of a table.
 * @param {Uint8Array} container decompressed container bytes
 * @param {{offset: number, count: number, boundary: number}} table
 *   `boundary` is where the table ends (the next table's offset, the blob start,
 *   or the container end).
 * @returns {{entrySize: number|null, region: number, slots?: object[], note?: string}}
 */
export function inferTableLayout(container, { offset, count, boundary }) {
  if (!count || boundary == null || boundary <= offset) {
    return { entrySize: null, region: 0, note: "no entries or unknown boundary" };
  }
  const region = boundary - offset;
  if (region % count !== 0) {
    return {
      entrySize: null,
      region,
      note: `region ${region} not divisible by count ${count} — boundary or count may be wrong`,
    };
  }
  const entrySize = region / count;
  const slots = [];
  for (let pos = 0; pos + 4 <= entrySize; pos += 4) {
    const values = [];
    for (let i = 0; i < count; i++) {
      values.push(u32(container, offset + i * entrySize + pos));
    }
    slots.push({
      offset: pos,
      ...classifySlot(values, container.length),
      sampleValues: values.slice(0, 3),
    });
  }
  return { entrySize, region, slots };
}

/**
 * Compute where a table ends: the smallest other-table offset greater than this
 * one, else the blob start, else the container end.
 */
export function tableBoundary(offset, allTableOffsets, blobOffset, containerLength) {
  let boundary = blobOffset ?? containerLength;
  for (const other of allTableOffsets) {
    if (other > offset && other < boundary) {
      boundary = other;
    }
  }
  return boundary;
}
