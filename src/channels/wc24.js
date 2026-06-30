// The WC24 download wrapper shared by every signed Wii channel data file
// (news.bin, forecast.bin, short.bin, ...). On disk each file is:
//
//   0x000  64 bytes  reserved / signature type (zero-filled in practice)
//   0x040  256 bytes RSA-2048 signature over the compressed body
//   0x140  ...       LZ10-compressed container (the actual data)
//
// The Wii verifies the signature against a key; reading the data only needs the
// LZ10 body, so we skip straight to 0x140. See docs/CHANNEL_DATA_FORMAT.md.

import { u8 } from "./binary.js";

/** Byte offset where the LZ10-compressed container begins. */
export const WC24_BODY_OFFSET = 0x140;

/** Magic byte for an LZ10 (Nintendo LZ77 type 0x10) stream. */
export const LZ10_MAGIC = 0x10;

/**
 * Decompress a Nintendo LZ10 (LZ77 type 0x10) stream starting at `start`.
 * Header: 0x10, then a 3-byte little-endian uncompressed size.
 * @returns {Uint8Array}
 */
export function lz10Decompress(bytes, start = 0) {
  if (u8(bytes, start) !== LZ10_MAGIC) {
    throw new Error(
      `not an LZ10 stream: expected 0x10 at 0x${start.toString(16)}, got 0x${u8(bytes, start).toString(16)}`,
    );
  }
  const size = bytes[start + 1] | (bytes[start + 2] << 8) | (bytes[start + 3] << 16);
  const out = new Uint8Array(size);
  let outPos = 0;
  let p = start + 4;

  while (outPos < size) {
    const flags = bytes[p++];
    for (let bit = 0; bit < 8 && outPos < size; bit++) {
      if (flags & (0x80 >> bit)) {
        // Back-reference: 2 bytes -> length (high nibble + 3), displacement.
        const b1 = bytes[p++];
        const b2 = bytes[p++];
        const length = (b1 >> 4) + 3;
        const disp = (((b1 & 0x0f) << 8) | b2) + 1;
        let copyFrom = outPos - disp;
        for (let i = 0; i < length && outPos < size; i++) {
          out[outPos++] = out[copyFrom++];
        }
      } else {
        out[outPos++] = bytes[p++];
      }
    }
  }
  return out;
}

/**
 * Unwrap a WC24 signed file: skip the 0x140 signature header and LZ10-decompress
 * the body into the raw container bytes.
 * @param {Uint8Array} bytes whole .bin file
 * @returns {Uint8Array} the decompressed container
 */
export function unwrapWC24(bytes) {
  if (bytes.length <= WC24_BODY_OFFSET) {
    throw new Error("file too small to be a WC24 channel data file");
  }
  return lz10Decompress(bytes, WC24_BODY_OFFSET);
}
