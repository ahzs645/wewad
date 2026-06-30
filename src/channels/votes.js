// Everybody Votes Channel (title HAJE...) data decoder: voting.bin -> shared
// ChannelData. Same WC24 family as News/Forecast, but the container genuinely
// differs: a 128-byte (not 256-byte) signature, body at 0xC0 (not 0x140), and
// a 12-byte container prefix (magic/size/crc32) ahead of the header.
//
// Container header (57 bytes, big-endian, byte-packed/unaligned): timestamp,
// country/publicity/version flags, then (number, offset) descriptors for the
// National/Worldwide-Question, Question-Text, National/Worldwide-Result(+Detailed),
// Position and Country-Name tables. Unlike News/Forecast the counts are not all
// u32 (several are u8/u16), and most tables are addressed from a parent entry's
// own (count, start-index) pair into the *global* table — not a second
// top-level (count, offset) header descriptor.
//
// Field layout is transcribed from RiiConnect24's File-Maker
// (Channels/Everybody_Votes_Channel/votes.py + voteslists.py) and validated by
// a round-trip against a fixture built to that exact layout (votes.test.js) —
// no live voting.bin was reachable, so values are not confirmed against a real
// poll. See docs/CHANNEL_DATA_FORMAT.md.

import { u8, u16, u32, readUtf16BEZ, wiiMinutesToISO } from "./binary.js";
import { lz10Decompress } from "./wc24.js";
import { createChannelData } from "./format.js";

/** Byte offset where the LZ10-compressed body begins (64 reserved + 128-byte signature). */
export const EV_BODY_OFFSET = 0xc0;
/** Size of the magic(0)/size/crc32 prefix ahead of the header, inside the decompressed body. */
export const EV_CONTAINER_PREFIX_SIZE = 12;

const NATIONAL_QUESTION_ENTRY_SIZE = 19;
const WORLDWIDE_QUESTION_ENTRY_SIZE = 19;
const QUESTION_TEXT_ENTRY_SIZE = 13;
const NATIONAL_RESULT_ENTRY_SIZE = 35;
const NATIONAL_RESULT_DETAILED_ENTRY_SIZE = 13;
const WORLDWIDE_RESULT_ENTRY_SIZE = 33;
const WORLDWIDE_RESULT_DETAILED_ENTRY_SIZE = 26;
const COUNTRY_NAME_ENTRY_SIZE = 5;

/**
 * Unwrap an Everybody Votes file: skip the 0xC0 signature header, LZ10-decompress
 * the body, then drop the 12-byte container prefix (magic/size/crc32) ahead of
 * the header. Returns the same "header at offset 0" container shape News/Forecast
 * decoders work with.
 * @param {Uint8Array} fileBytes whole voting.bin
 * @returns {Uint8Array}
 */
export function unwrapEverybodyVotes(fileBytes) {
  if (fileBytes.length <= EV_BODY_OFFSET) {
    throw new Error("file too small to be an Everybody Votes data file");
  }
  const body = lz10Decompress(fileBytes, EV_BODY_OFFSET);
  return body.subarray(EV_CONTAINER_PREFIX_SIZE);
}

// National and worldwide question entries share the same 19-byte layout.
function readQuestion(c, base) {
  return {
    pollId: u32(c, base + 0),
    category1: u8(c, base + 4),
    category2: u8(c, base + 5),
    opens: wiiMinutesToISO(u32(c, base + 6)),
    closes: wiiMinutesToISO(u32(c, base + 10)),
    textCount: u8(c, base + 14),
    textStart: u32(c, base + 15),
  };
}

function readQuestionText(c, base) {
  return {
    language: u8(c, base + 0),
    questionOffset: u32(c, base + 1),
    response1Offset: u32(c, base + 5),
    response2Offset: u32(c, base + 9),
  };
}

function readResult(c, base) {
  return {
    pollId: u32(c, base + 0),
    male: [u32(c, base + 4), u32(c, base + 8)],
    female: [u32(c, base + 12), u32(c, base + 16)],
    predictors: [u32(c, base + 20), u32(c, base + 24)],
    showVoters: u8(c, base + 28),
    detailedFlag: u8(c, base + 29),
    detailedCount: u8(c, base + 30),
    detailedStart: u32(c, base + 31),
  };
}

function readResultDetailed(c, base) {
  return {
    voters: [u32(c, base + 0), u32(c, base + 4)],
    positionCount: u8(c, base + 8),
    positionStart: u32(c, base + 9),
  };
}

function readWorldwideResult(c, base) {
  return {
    pollId: u32(c, base + 0),
    male: [u32(c, base + 4), u32(c, base + 8)],
    female: [u32(c, base + 12), u32(c, base + 16)],
    predictors: [u32(c, base + 20), u32(c, base + 24)],
    detailedCount: u8(c, base + 28),
    detailedStart: u32(c, base + 29),
  };
}

function readWorldwideResultDetailed(c, base) {
  return {
    male: [u32(c, base + 4), u32(c, base + 8)],
    female: [u32(c, base + 12), u32(c, base + 16)],
    countryNameCount: u16(c, base + 20),
    countryNameStart: u32(c, base + 22),
  };
}

function readCountryName(c, base) {
  return {
    language: u8(c, base + 0),
    name: readUtf16BEZ(c, u32(c, base + 1)),
  };
}

function readTable(c, count, offset, entrySize, reader) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(reader(c, offset + i * entrySize));
  }
  return rows;
}

// Join a question's (textStart, textCount) slice of the global questionText
// table to its localized strings in the blob.
function resolveQuestionText(c, question, questionText) {
  return questionText
    .slice(question.textStart, question.textStart + question.textCount)
    .map((t) => ({
      language: t.language,
      text: readUtf16BEZ(c, t.questionOffset),
      responses: [readUtf16BEZ(c, t.response1Offset), readUtf16BEZ(c, t.response2Offset)],
    }));
}

function resolveQuestions(c, rawQuestions, questionText, scope) {
  return rawQuestions.map((q) => {
    const translations = resolveQuestionText(c, q, questionText);
    const primary = translations[0] ?? null;
    return {
      scope,
      pollId: q.pollId,
      category: [q.category1, q.category2],
      opens: q.opens,
      closes: q.closes,
      text: primary?.text ?? null,
      responses: primary?.responses ?? [],
      translations,
    };
  });
}

/**
 * Decode an Everybody Votes Channel data file (voting.bin) into the shared
 * envelope.
 * @param {Uint8Array} fileBytes whole voting.bin (EV-wrapped: 0xC0 body offset)
 * @returns {import("./format.js").ChannelData}
 */
export function decodeEverybodyVotes(fileBytes) {
  const c = unwrapEverybodyVotes(fileBytes);

  const data = createChannelData("everybodyVotes", {
    updated: wiiMinutesToISO(u32(c, 0)),
    country: u8(c, 4),
  });

  const nNationalQ = u8(c, 8);
  const nationalQOffset = u32(c, 9);
  const nWorldwideQ = u8(c, 13);
  const worldwideQOffset = u32(c, 14);
  const nQuestionText = u8(c, 18);
  const questionTextOffset = u32(c, 19);
  const nNationalResults = u8(c, 23);
  const nationalResultOffset = u32(c, 24);
  const nNationalResultsDetailed = u16(c, 28);
  const nationalResultDetailedOffset = u32(c, 30);
  const nPositions = u16(c, 34);
  const positionOffset = u32(c, 36);
  const nWorldwideResults = u8(c, 40);
  const worldwideResultOffset = u32(c, 41);
  const nWorldwideResultsDetailed = u16(c, 45);
  const worldwideResultDetailedOffset = u32(c, 47);
  const nCountryNames = u16(c, 51);
  const countryNameOffset = u32(c, 53);

  const nationalQuestions = readTable(c, nNationalQ, nationalQOffset, NATIONAL_QUESTION_ENTRY_SIZE, readQuestion);
  const worldwideQuestions = readTable(c, nWorldwideQ, worldwideQOffset, WORLDWIDE_QUESTION_ENTRY_SIZE, readQuestion);
  const questionText = readTable(c, nQuestionText, questionTextOffset, QUESTION_TEXT_ENTRY_SIZE, readQuestionText);
  const nationalResults = readTable(c, nNationalResults, nationalResultOffset, NATIONAL_RESULT_ENTRY_SIZE, readResult);
  const nationalResultsDetailed = readTable(
    c,
    nNationalResultsDetailed,
    nationalResultDetailedOffset,
    NATIONAL_RESULT_DETAILED_ENTRY_SIZE,
    readResultDetailed,
  );
  const worldwideResults = readTable(
    c,
    nWorldwideResults,
    worldwideResultOffset,
    WORLDWIDE_RESULT_ENTRY_SIZE,
    readWorldwideResult,
  );
  const worldwideResultsDetailed = readTable(
    c,
    nWorldwideResultsDetailed,
    worldwideResultDetailedOffset,
    WORLDWIDE_RESULT_DETAILED_ENTRY_SIZE,
    readWorldwideResultDetailed,
  );
  const countryNames = readTable(c, nCountryNames, countryNameOffset, COUNTRY_NAME_ENTRY_SIZE, readCountryName);

  const questions = [
    ...resolveQuestions(c, nationalQuestions, questionText, "national"),
    ...resolveQuestions(c, worldwideQuestions, questionText, "worldwide"),
  ];
  const results = [
    ...nationalResults.map((r) => ({ scope: "national", ...r })),
    ...worldwideResults.map((r) => ({ scope: "worldwide", ...r })),
  ];

  data.payload = {
    questions,
    results,
    // Raw decoded tables (1:1 with votes.py), kept alongside the resolved
    // views above for inspection/extension — same pattern as forecast.js's
    // separate `conditions` table.
    nationalQuestions,
    worldwideQuestions,
    questionText,
    nationalResults,
    nationalResultsDetailed,
    worldwideResults,
    worldwideResultsDetailed,
    countryNames,
    // Per-country region breakdown (positions): each entry is a variable-length
    // raw blob (binascii.unhexlify in votes.py) keyed by a country's region
    // count, which lives in voteslists.py and isn't ported here. Surfaced as a
    // count/offset extension point, same as forecast.js's short/UV/laundry/
    // pollen tables.
    positions: { count: nPositions, offset: positionOffset, decoded: false },
  };
  return data;
}
