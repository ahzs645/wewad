import { withLogger } from "../shared/index";

function readAscii(view, offset, length) {
  let value = "";
  for (let i = 0; i < length; i += 1) {
    value += String.fromCharCode(view.getUint8(offset + i));
  }
  return value;
}

function clampSample16(value) {
  if (value > 32767) {
    return 32767;
  }
  if (value < -32768) {
    return -32768;
  }
  return value;
}

function decodeDspAdpcmChannel(source, dataOffset, sampleCount, coefficients, initialHist1 = 0, initialHist2 = 0) {
  const output = new Int16Array(sampleCount);
  const frameCount = Math.ceil(sampleCount / 14);

  let hist1 = initialHist1;
  let hist2 = initialHist2;
  let sampleIndex = 0;

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameOffset = dataOffset + frameIndex * 8;
    const header = source[frameOffset];
    const predictor = header >> 4;
    const shift = header & 0x0f;
    const coefBase = Math.min(7, predictor) * 2;
    const coef1 = coefficients[coefBase] ?? 0;
    const coef2 = coefficients[coefBase + 1] ?? 0;

    for (let nibbleIndex = 0; nibbleIndex < 14 && sampleIndex < sampleCount; nibbleIndex += 1) {
      const byteValue = source[frameOffset + 1 + (nibbleIndex >> 1)];
      let nibble = (nibbleIndex & 1) === 0 ? byteValue >> 4 : byteValue & 0x0f;
      if (nibble >= 8) {
        nibble -= 16;
      }

      const sample = nibble << shift;
      const predicted = ((sample << 11) + 1024 + coef1 * hist1 + coef2 * hist2) >> 11;
      const pcm = clampSample16(predicted);

      output[sampleIndex] = pcm;
      sampleIndex += 1;

      hist2 = hist1;
      hist1 = pcm;
    }
  }

  return output;
}

export function parseBNS(buffer, loggerInput) {
  const logger = withLogger(loggerInput);
  let sourceBuffer = buffer;

  if (sourceBuffer.byteLength >= 32) {
    const imd5View = new DataView(sourceBuffer, 0, Math.min(32, sourceBuffer.byteLength));
    if (readAscii(imd5View, 0, 4) === "IMD5") {
      logger.info("Found IMD5 header, skipping 32 bytes");
      sourceBuffer = sourceBuffer.slice(32);
    }
  }

  const view = new DataView(sourceBuffer);
  const source = new Uint8Array(sourceBuffer);

  if (readAscii(view, 0, 4) !== "BNS ") {
    throw new Error(`Not a BNS stream (${readAscii(view, 0, 4)})`);
  }

  const bomVersion = view.getUint32(0x04, false);
  if (bomVersion !== 0xfeff0100) {
    throw new Error(`Unsupported BNS version 0x${bomVersion.toString(16)}`);
  }

  const fileSize = view.getUint32(0x08, false);
  if (fileSize > sourceBuffer.byteLength) {
    throw new Error(`Invalid BNS size ${fileSize} (buffer=${sourceBuffer.byteLength})`);
  }

  const headerSize = view.getUint16(0x0c, false);
  const chunkCount = view.getUint16(0x0e, false);

  let infoOffset = 0;
  let dataOffset = 0;

  for (let i = 0; i < chunkCount; i += 1) {
    const chunkInfoOffset = 0x10 + i * 0x08;
    if (chunkInfoOffset + 8 > headerSize || chunkInfoOffset + 8 > sourceBuffer.byteLength) {
      throw new Error(`Invalid chunk table entry ${i}`);
    }

    const chunkOffset = view.getUint32(chunkInfoOffset, false);
    const chunkSize = view.getUint32(chunkInfoOffset + 4, false);
    if (chunkOffset + chunkSize > fileSize || chunkOffset + 8 > sourceBuffer.byteLength) {
      throw new Error(`Chunk ${i} out of bounds`);
    }

    const chunkType = readAscii(view, chunkOffset, 4);
    if (chunkType === "INFO") {
      infoOffset = chunkOffset + 8;
    } else if (chunkType === "DATA") {
      dataOffset = chunkOffset + 8;
    }
  }

  if (!infoOffset || !dataOffset) {
    throw new Error("BNS stream missing INFO or DATA chunk");
  }

  const format = view.getUint8(infoOffset + 0x00);
  if (format !== 0) {
    throw new Error(`Unsupported BNS format ${format}`);
  }

  const loopFlag = view.getUint8(infoOffset + 0x01) !== 0;
  const channelCount = view.getUint8(infoOffset + 0x02);
  if (channelCount < 1 || channelCount > 8) {
    throw new Error(`Invalid BNS channel count ${channelCount}`);
  }

  const sampleRate = view.getUint16(infoOffset + 0x04, false);
  const loopStart = view.getUint32(infoOffset + 0x08, false);
  const sampleCount = view.getUint32(infoOffset + 0x0c, false);
  const channelInfoListOffset = infoOffset + view.getUint32(infoOffset + 0x10, false);
  const bytesPerChannel = Math.ceil(sampleCount / 14) * 8;

  const pcm16 = [];

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelInfoOffset = infoOffset + view.getUint32(channelInfoListOffset + channelIndex * 4, false);
    const channelDataOffset = dataOffset + view.getUint32(channelInfoOffset + 0x00, false);
    const channelDspOffset = infoOffset + view.getUint32(channelInfoOffset + 0x04, false);

    if (channelDataOffset + bytesPerChannel > source.length) {
      throw new Error(`Channel ${channelIndex} data out of bounds`);
    }
    if (channelDspOffset + 0x2e > source.length) {
      throw new Error(`Channel ${channelIndex} DSP coefficients out of bounds`);
    }

    const coefficients = new Int16Array(16);
    for (let i = 0; i < 16; i += 1) {
      coefficients[i] = view.getInt16(channelDspOffset + i * 2, false);
    }

    const initialHist1 = view.getInt16(channelDspOffset + 0x24, false);
    const initialHist2 = view.getInt16(channelDspOffset + 0x26, false);

    pcm16.push(
      decodeDspAdpcmChannel(source, channelDataOffset, sampleCount, coefficients, initialHist1, initialHist2),
    );
  }

  const durationSeconds = sampleRate > 0 ? sampleCount / sampleRate : 0;
  logger.success(
    `Decoded BNS audio: ${channelCount} channel(s), ${sampleRate} Hz, ${durationSeconds.toFixed(2)} s`,
  );

  return {
    channelCount,
    sampleRate,
    sampleCount,
    loopFlag,
    loopStart,
    durationSeconds,
    pcm16,
  };
}
