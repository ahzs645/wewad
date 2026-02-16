export function createWavBuffer(audio) {
  if (!audio?.pcm16?.length || !Number.isFinite(audio.sampleRate) || audio.sampleRate <= 0) {
    return null;
  }

  const channelCount = Math.max(1, audio.channelCount ?? audio.pcm16.length);
  const frameCount = Math.min(...audio.pcm16.map((channelData) => channelData.length));
  if (!Number.isFinite(frameCount) || frameCount <= 0) {
    return null;
  }

  const blockAlign = channelCount * 2;
  const byteRate = audio.sampleRate * blockAlign;
  const dataSize = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  let writeOffset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const channelData = audio.pcm16[channel] ?? audio.pcm16[audio.pcm16.length - 1];
      const sample = channelData?.[frame] ?? 0;
      view.setInt16(writeOffset, sample, true);
      writeOffset += 2;
    }
  }

  return buffer;
}
