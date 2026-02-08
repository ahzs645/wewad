export const WII_COMMON_KEYS = [
  "ebe42a225e8593e448d9c5457381aaf7",
  "63b82bb4f4614e2e13f2fefbba4c9b7e",
  "30bfc76e7c19afbb23163330ced7c28d",
];

export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function concatBytes(left, right) {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

function xorBytes(left, right) {
  const out = new Uint8Array(left.length);
  for (let i = 0; i < left.length; i += 1) {
    out[i] = left[i] ^ right[i];
  }
  return out;
}

export function hasSubtleCrypto() {
  return Boolean(globalThis.crypto?.subtle);
}

export async function importAesCbcKey(rawKeyBytes) {
  return globalThis.crypto.subtle.importKey("raw", rawKeyBytes, { name: "AES-CBC" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptAesBlockNoPadding(key, inputBlock) {
  const iv = new Uint8Array(16);
  const encrypted = await globalThis.crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, inputBlock);
  return new Uint8Array(encrypted).slice(0, 16);
}

export async function decryptAesCbcNoPadding(key, ciphertextBytes, ivBytes) {
  if (ciphertextBytes.length === 0) {
    return new Uint8Array();
  }

  if (ciphertextBytes.length % 16 !== 0) {
    throw new Error(`AES-CBC ciphertext length must be a multiple of 16 (got ${ciphertextBytes.length})`);
  }

  // WebCrypto AES-CBC only supports PKCS#7 padding. We append one synthetic
  // block that decrypts to a full padding block, then trim it away.
  const padBlock = new Uint8Array(16);
  padBlock.fill(16);
  const lastCipherBlock = ciphertextBytes.slice(ciphertextBytes.length - 16);
  const syntheticInput = xorBytes(lastCipherBlock, padBlock);
  const syntheticCipherBlock = await encryptAesBlockNoPadding(key, syntheticInput);
  const extendedCiphertext = concatBytes(ciphertextBytes, syntheticCipherBlock);

  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: "AES-CBC", iv: ivBytes },
    key,
    extendedCiphertext,
  );

  return new Uint8Array(plaintext);
}
