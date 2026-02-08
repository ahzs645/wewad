import {
  BinaryReader,
  NOOP_LOGGER,
  decodeLz77,
  decodeYaz0,
  withLogger,
} from "../shared/index";

export function parseU8(buffer, loggerInput) {
  const logger = withLogger(loggerInput);
  const reader = new BinaryReader(buffer);

  const magic = reader.u32();
  if (magic !== 0x55aa382d) {
    reader.seek(0);
    const tag = reader.string(4);
    reader.seek(0);

    if (tag === "IMD5") {
      logger.info("Found IMD5 header, skipping 32 bytes");
      return parseU8(buffer.slice(32), logger);
    }

    if (tag === "LZ77") {
      logger.info("Found LZ77 stream, decompressing");
      const source = new Uint8Array(buffer);

      const attempts = [
        { mode: "be", label: "big-endian" },
        { mode: "le", label: "little-endian" },
      ];

      function scoreParsedFiles(files) {
        const entries = Object.entries(files);
        if (entries.length === 0) {
          return -1;
        }

        let nonEmpty = 0;
        let totalBytes = 0;
        let renderableNonEmpty = 0;

        for (const [path, data] of entries) {
          const size = data.byteLength;
          if (size > 0) {
            nonEmpty += 1;
            totalBytes += size;
          }

          const lower = path.toLowerCase();
          const isRenderable =
            lower.endsWith(".tpl") ||
            lower.endsWith(".brlyt") ||
            lower.endsWith(".brlan") ||
            lower.endsWith(".bin") ||
            lower.endsWith(".szs");
          if (isRenderable && size > 0) {
            renderableNonEmpty += 1;
          }
        }

        // Prioritize attempts that produce actual non-empty renderable payloads.
        return renderableNonEmpty * 1_000_000 + nonEmpty * 10_000 + Math.min(totalBytes, 9_999);
      }

      let bestAttempt = null;
      let lastError = null;
      for (const attempt of attempts) {
        try {
          const decompressed = decodeLz77(source, attempt.mode);
          const parsed = parseU8(decompressed, NOOP_LOGGER);
          const score = scoreParsedFiles(parsed);

          if (
            !bestAttempt ||
            score > bestAttempt.score ||
            (score === bestAttempt.score && decompressed.byteLength < bestAttempt.decompressed.byteLength)
          ) {
            bestAttempt = { ...attempt, score, decompressed };
          }
        } catch (error) {
          lastError = error;
        }
      }

      if (bestAttempt) {
        logger.info(`LZ77 decompressed using ${bestAttempt.label} size mode`);
        return parseU8(bestAttempt.decompressed, logger);
      }

      throw new Error(`Failed to decompress LZ77 stream: ${lastError?.message ?? "unknown error"}`);
    }

    if (tag === "Yaz0") {
      logger.info("Found Yaz0 stream, decompressing");
      const decompressed = decodeYaz0(new Uint8Array(buffer));
      return parseU8(decompressed, logger);
    }

    const view = new DataView(buffer);
    const maxOffset = buffer.byteLength - 4;
    for (let i = 0; i <= maxOffset; i += 1) {
      if (view.getUint32(i, false) !== 0x55aa382d) {
        continue;
      }

      // Validate likely U8 structure before recursing.
      if (i + 16 > buffer.byteLength) {
        continue;
      }

      const rootNodeOffset = view.getUint32(i + 4, false);
      if (rootNodeOffset < 0x10 || i + rootNodeOffset + 12 > buffer.byteLength) {
        continue;
      }

      const rootType = view.getUint8(i + rootNodeOffset);
      const rootNumEntries = view.getUint32(i + rootNodeOffset + 8, false);
      if (rootType !== 1 || rootNumEntries < 1) {
        continue;
      }

      const stringTableOffset = i + rootNodeOffset + rootNumEntries * 12;
      if (stringTableOffset >= buffer.byteLength) {
        continue;
      }

      logger.info(`Found U8 magic at offset ${i}`);
      return parseU8(buffer.slice(i), logger);
    }

    throw new Error(`Not a U8 archive (magic: 0x${magic.toString(16)})`);
  }

  const rootNodeOffset = reader.u32();
  reader.u32(); // nodesSize
  reader.u32(); // dataOffset

  reader.seek(rootNodeOffset);

  const rootType = reader.u8();
  const rootNameOffset = (reader.u8() << 16) | reader.u16();
  const rootDataOffset = reader.u32();
  const rootNumEntries = reader.u32();

  const stringTableOffset = rootNodeOffset + rootNumEntries * 12;

  const nodes = [
    {
      type: rootType,
      nameOffset: rootNameOffset,
      dataOffset: rootDataOffset,
      size: rootNumEntries,
    },
  ];

  for (let i = 1; i < rootNumEntries; i += 1) {
    const type = reader.u8();
    const nameOffset = (reader.u8() << 16) | reader.u16();
    const dataOffset = reader.u32();
    const size = reader.u32();
    nodes.push({ type, nameOffset, dataOffset, size });
  }

  const files = {};
  const dirStack = [{ name: "", end: rootNumEntries }];

  for (let i = 1; i < rootNumEntries; i += 1) {
    const node = nodes[i];

    while (dirStack.length > 1 && i >= dirStack[dirStack.length - 1].end) {
      dirStack.pop();
    }

    const pathPrefix = dirStack
      .map((dir) => dir.name)
      .filter(Boolean)
      .join("/");

    const nameReader = new BinaryReader(buffer, stringTableOffset + node.nameOffset);
    const name = nameReader.nullString();

    if (node.type === 1) {
      dirStack.push({ name, end: node.size });
      continue;
    }

    const fullPath = pathPrefix ? `${pathPrefix}/${name}` : name;
    files[fullPath] = buffer.slice(node.dataOffset, node.dataOffset + node.size);
    logger.info(`  U8 file: ${fullPath} (${node.size} bytes)`);
  }

  return files;
}
