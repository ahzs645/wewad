// News Channel (title HAGE...) data decoder: news.bin.NN -> shared ChannelData.
//
// Container layout (after WC24 unwrap), all big-endian:
//   Header (104 bytes): version, filesize, crc32, updated/end timestamps,
//     country/language, then paired (count, offset) descriptors for the Topics,
//     Articles, Sources, Locations, Images and Wii-Menu-Headlines tables.
//   Tables: fixed-size records that point (size, offset) into a trailing blob.
//   Blob: UTF-16BE strings (headlines, bodies, names) + image data.
//
// A "headline" is just `size` bytes of UTF-16BE at `offset` in the blob. The
// Wii-Menu-Headlines table is the feed shown on the channel's banner/icon.

import {
  u8,
  u16,
  u32,
  i16,
  readUtf16BE,
  readUtf16BEZ,
  wiiMinutesToISO,
  decodeCoordinate,
} from "./binary.js";
import { unwrapWC24 } from "./wc24.js";
import { createChannelData } from "./format.js";

const NULL_REF = 0xffffffff;
const ARTICLE_ENTRY_SIZE = 44;
const SOURCE_ENTRY_SIZE = 28;
const TOPIC_ENTRY_SIZE = 12;
const LOCATION_ENTRY_SIZE = 16;
const HEADLINE_ENTRY_SIZE = 8;

function readLocation(c, base) {
  const textOffset = u32(c, base + 0);
  return {
    name: readUtf16BEZ(c, textOffset),
    region: "",
    country: "",
    lat: decodeCoordinate(i16(c, base + 4)),
    lng: decodeCoordinate(i16(c, base + 6)),
    countryCode: u8(c, base + 8),
    regionCode: u8(c, base + 9),
    locationCode: u16(c, base + 10),
  };
}

function readArticle(c, base) {
  const locationNumber = u32(c, base + 8);
  const pictureNumber = u32(c, base + 16);
  const headlineSize = u32(c, base + 28);
  const headlineOffset = u32(c, base + 32);
  const articleSize = u32(c, base + 36);
  const articleOffset = u32(c, base + 40);
  return {
    id: u32(c, base + 0),
    source: u32(c, base + 4),
    location: locationNumber === NULL_REF ? null : locationNumber,
    picture: pictureNumber === NULL_REF ? null : pictureNumber,
    published: wiiMinutesToISO(u32(c, base + 20)),
    updated: wiiMinutesToISO(u32(c, base + 24)),
    headline: readUtf16BE(c, headlineOffset, headlineSize),
    body: readUtf16BE(c, articleOffset, articleSize),
  };
}

function readSource(c, base) {
  return {
    name: readUtf16BE(c, u32(c, base + 16), u32(c, base + 12)),
    copyright: readUtf16BE(c, u32(c, base + 24), u32(c, base + 20)),
  };
}

function readTopic(c, base) {
  return {
    name: readUtf16BEZ(c, u32(c, base + 0)),
    articleCount: u32(c, base + 4),
  };
}

/**
 * Decode a News Channel data file into the shared envelope.
 * @param {Uint8Array} fileBytes whole news.bin.NN (WC24-wrapped)
 * @returns {import("./format.js").ChannelData}
 */
export function decodeNews(fileBytes) {
  const c = unwrapWC24(fileBytes);

  const data = createChannelData("news", {
    version: u32(c, 0),
    country: u8(c, 20),
    language: u8(c, 44),
    updated: wiiMinutesToISO(u32(c, 12)),
    expires: wiiMinutesToISO(u32(c, 16)),
  });

  const nTopics = u32(c, 52);
  const topicOffset = u32(c, 56);
  const nArticles = u32(c, 60);
  const articleOffset = u32(c, 64);
  const nSources = u32(c, 68);
  const sourceOffset = u32(c, 72);
  const nLocations = u32(c, 76);
  const locationOffset = u32(c, 80);
  const nHeadlines = u32(c, 96);
  const headlineOffset = u32(c, 100);

  for (let i = 0; i < nLocations; i++) {
    data.locations.push(readLocation(c, locationOffset + i * LOCATION_ENTRY_SIZE));
  }

  const menuHeadlines = [];
  for (let i = 0; i < nHeadlines; i++) {
    const e = headlineOffset + i * HEADLINE_ENTRY_SIZE;
    menuHeadlines.push(readUtf16BE(c, u32(c, e + 4), u32(c, e)));
  }

  const articles = [];
  for (let i = 0; i < nArticles; i++) {
    articles.push(readArticle(c, articleOffset + i * ARTICLE_ENTRY_SIZE));
  }

  const sources = [];
  for (let i = 0; i < nSources; i++) {
    sources.push(readSource(c, sourceOffset + i * SOURCE_ENTRY_SIZE));
  }

  const topics = [];
  for (let i = 0; i < nTopics; i++) {
    topics.push(readTopic(c, topicOffset + i * TOPIC_ENTRY_SIZE));
  }

  data.payload = { menuHeadlines, articles, sources, topics };
  return data;
}
