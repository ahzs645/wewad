import {
  WII_COMMON_KEYS,
  decryptAesCbcNoPadding,
  hasSubtleCrypto,
  hexToBytes,
  importAesCbcKey,
  withLogger,
} from "../shared/index";

export async function decryptWadContents(wad, loggerInput) {
  const logger = withLogger(loggerInput);

  if (!hasSubtleCrypto()) {
    logger.warn("WebCrypto API not available; cannot decrypt encrypted WAD contents in this environment");
    return null;
  }

  const commonKeyIndex = wad.ticket.commonKeyIndex;
  const commonKeyHex = WII_COMMON_KEYS[commonKeyIndex];
  if (!commonKeyHex) {
    logger.warn(`Unsupported common key index ${commonKeyIndex}`);
    return null;
  }

  const commonKeyBytes = hexToBytes(commonKeyHex);
  const commonKey = await importAesCbcKey(commonKeyBytes);

  const titleIv = new Uint8Array(16);
  titleIv.set(wad.ticket.titleIdBytes, 0);

  const decryptedTitleKey = await decryptAesCbcNoPadding(commonKey, wad.ticket.encryptedTitleKey, titleIv);
  const titleKeyBytes = decryptedTitleKey.slice(0, 16);
  const titleKey = await importAesCbcKey(titleKeyBytes);

  logger.info(`Decrypted title key using common key index ${commonKeyIndex}`);

  const decryptedContents = {};
  for (const record of wad.contentRecords) {
    const iv = new Uint8Array(16);
    iv[0] = (record.index >> 8) & 0xff;
    iv[1] = record.index & 0xff;

    const encryptedBytes = new Uint8Array(wad.sourceBuffer, record.offset, record.encryptedSize);
    const decryptedBytes = await decryptAesCbcNoPadding(titleKey, encryptedBytes, iv);
    decryptedContents[record.name] = decryptedBytes.slice(0, record.size).buffer;
  }

  return decryptedContents;
}
