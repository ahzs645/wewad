import { BinaryReader, align, withLogger } from "../shared/index";

export function parseWAD(buffer, loggerInput) {
  const logger = withLogger(loggerInput);
  const reader = new BinaryReader(buffer);

  const headerSize = reader.u32();
  const wadType = reader.u32();
  const certChainSize = reader.u32();
  reader.skip(4); // reserved
  const ticketSize = reader.u32();
  const tmdSize = reader.u32();
  const dataSize = reader.u32();
  reader.skip(4); // footer size

  logger.info(
    `WAD header: type=0x${wadType.toString(16)}, certChain=${certChainSize}, ticket=${ticketSize}, tmd=${tmdSize}, data=${dataSize}`,
  );

  let offset = align(headerSize, 64);
  offset += align(certChainSize, 64);
  const ticketOffset = offset;
  offset += align(ticketSize, 64);
  const tmdOffset = offset;

  const tmdReader = new BinaryReader(buffer, tmdOffset);
  tmdReader.skip(0x1de);
  const numContents = tmdReader.u16();

  logger.info(`TMD: ${numContents} content(s)`);

  const contentRecords = [];
  tmdReader.seek(tmdOffset + 0x1e4);
  for (let i = 0; i < numContents; i += 1) {
    const contentId = tmdReader.u32();
    const index = tmdReader.u16();
    const type = tmdReader.u16();
    const sizeHigh = tmdReader.u32();
    const sizeLow = tmdReader.u32();
    tmdReader.slice(20); // hash

    const size = Number((BigInt(sizeHigh) << 32n) | BigInt(sizeLow));
    contentRecords.push({ contentId, index, type, size });
  }

  offset += align(tmdSize, 64);
  const dataOffset = offset;

  const contents = {};
  let contentOffset = dataOffset;
  for (const record of contentRecords) {
    const name = `${record.contentId.toString(16).padStart(8, "0")}.app`;
    record.name = name;
    record.offset = contentOffset;
    record.encryptedSize = align(record.size, 16);
    contents[name] = buffer.slice(contentOffset, contentOffset + record.size);
    logger.info(`Content: ${name} (${record.size} bytes)`);
    contentOffset += align(record.size, 64);
  }

  const ticketBytes = new Uint8Array(buffer, ticketOffset, ticketSize);
  const titleIdBytes = ticketBytes.slice(0x1dc, 0x1dc + 8);
  const encryptedTitleKey = ticketBytes.slice(0x1bf, 0x1bf + 16);
  // Wii ticket field offsets: common key index is at 0x1F5 (not 0x1F1).
  const commonKeyIndex = ticketBytes.length > 0x1f5 ? ticketBytes[0x1f5] : 0;

  let titleId = "";
  for (let i = 4; i < 8; i += 1) {
    const code = titleIdBytes[i];
    titleId += code >= 32 && code < 127 ? String.fromCharCode(code) : "?";
  }

  return {
    sourceBuffer: buffer,
    contents,
    contentRecords,
    numContents,
    titleId,
    wadType,
    ticket: {
      encryptedTitleKey,
      titleIdBytes,
      commonKeyIndex,
      ticketSize,
      ticketOffset,
    },
  };
}
