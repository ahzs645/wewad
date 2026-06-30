// Low-level primitives shared by every Wii channel data file (news.bin,
// forecast.bin, ...). These files are big-endian (PowerPC), pack UTF-16BE
// strings into a trailing blob, and timestamp everything as minutes since the
// Wii epoch (2000-01-01 UTC).

/** Read an unsigned 8-bit value. */
export function u8(bytes, offset) {
  return bytes[offset];
}

/** Read a big-endian unsigned 16-bit value. */
export function u16(bytes, offset) {
  return ((bytes[offset] << 8) | bytes[offset + 1]) >>> 0;
}

/** Read a big-endian unsigned 32-bit value. */
export function u32(bytes, offset) {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

/** Read a signed 8-bit value. */
export function i8(bytes, offset) {
  const v = bytes[offset];
  return v >= 0x80 ? v - 0x100 : v;
}

/** Read a big-endian signed 16-bit value. */
export function i16(bytes, offset) {
  const v = u16(bytes, offset);
  return v >= 0x8000 ? v - 0x10000 : v;
}

const utf16beDecoder = new TextDecoder("utf-16be");

/** Decode a fixed-length UTF-16BE string (length in bytes). */
export function readUtf16BE(bytes, offset, byteLength) {
  if (!byteLength || offset < 0 || offset + byteLength > bytes.length) {
    return "";
  }
  return utf16beDecoder.decode(bytes.subarray(offset, offset + byteLength));
}

/** Decode a NUL-terminated (0x0000) UTF-16BE string. */
export function readUtf16BEZ(bytes, offset) {
  if (offset < 0 || offset >= bytes.length) {
    return "";
  }
  let end = offset;
  while (end + 1 < bytes.length && !(bytes[end] === 0 && bytes[end + 1] === 0)) {
    end += 2;
  }
  return utf16beDecoder.decode(bytes.subarray(offset, end));
}

/** Milliseconds for 2000-01-01 UTC — the epoch every channel file counts from. */
export const WII_EPOCH_MS = Date.UTC(2000, 0, 1);

/** Convert "minutes since 2000-01-01 UTC" to a Date. */
export function wiiMinutesToDate(minutes) {
  return new Date(WII_EPOCH_MS + minutes * 60000);
}

/** Convert "minutes since 2000-01-01 UTC" to an ISO-8601 string (or null for 0). */
export function wiiMinutesToISO(minutes) {
  if (!minutes) {
    return null;
  }
  return wiiMinutesToDate(minutes).toISOString();
}

// Forecast Channel lat/long are stored as int16 scaled by 360/65536 degrees per
// unit (WiiLink24/ForecastChannel CoordinateEncode divides degrees by this).
export const COORDINATE_SCALE = 0.0054931640625;

/** Decode a raw int16 forecast coordinate to degrees. */
export function decodeCoordinate(raw) {
  return raw * COORDINATE_SCALE;
}

let crcTable = null;

/** IEEE CRC-32 over a byte range — the checksum stored in each container header. */
export function crc32(bytes, start = 0, end = bytes.length) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
