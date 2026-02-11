/**
 * Minimal Stellar key encoding/decoding — no Stellar SDK needed.
 * Stellar keys are base32-encoded with a version byte and CRC16-XModem checksum.
 *
 * G-address (public key): version 0x30 (6 << 3) + 32 bytes pubkey + 2 bytes CRC16
 * S-address (secret seed): version 0x90 (18 << 3) + 32 bytes seed + 2 bytes CRC16
 */

import nacl from "tweetnacl";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Uint8Array {
  const cleaned = input.replace(/=+$/, "");
  const length = (cleaned.length * 5) >> 3;
  const result = new Uint8Array(length);

  let buffer = 0;
  let bitsLeft = 0;
  let index = 0;

  for (const char of cleaned) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) throw new Error(`Invalid base32 character: ${char}`);
    buffer = (buffer << 5) | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      result[index++] = (buffer >> bitsLeft) & 0xff;
    }
  }

  return result.slice(0, index);
}

function base32Encode(data: Uint8Array): string {
  let result = "";
  let buffer = 0;
  let bitsLeft = 0;

  for (const byte of data) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      result += BASE32_ALPHABET[(buffer >> bitsLeft) & 0x1f];
    }
  }

  if (bitsLeft > 0) {
    result += BASE32_ALPHABET[(buffer << (5 - bitsLeft)) & 0x1f];
  }

  return result;
}

function crc16Xmodem(data: Uint8Array): number {
  let crc = 0x0000;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc;
}

/**
 * Extract the raw 32-byte Ed25519 seed from a Stellar S-address.
 */
export function decodeStellarSecret(secretSeed: string): Uint8Array {
  if (!secretSeed.startsWith("S")) {
    throw new Error("Stellar secret seed must start with 'S'");
  }

  const decoded = base32Decode(secretSeed);
  // decoded = [version (1 byte)] + [seed (32 bytes)] + [checksum (2 bytes)]
  if (decoded.length !== 35) {
    throw new Error(`Invalid secret seed length: ${decoded.length}`);
  }

  const version = decoded[0];
  if (version !== 0x90) {
    // 18 << 3 = 144 = 0x90
    throw new Error(`Invalid version byte for secret seed: 0x${version.toString(16)}`);
  }

  const seed = decoded.slice(1, 33);
  const checksum = (decoded[33] | (decoded[34] << 8)); // little-endian
  const expectedChecksum = crc16Xmodem(decoded.slice(0, 33));

  if (checksum !== expectedChecksum) {
    throw new Error("Secret seed checksum mismatch");
  }

  return seed;
}

/**
 * Encode a raw 32-byte Ed25519 public key as a Stellar G-address.
 */
export function encodeStellarPublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error(`Invalid public key length: ${publicKey.length}`);
  }

  const payload = new Uint8Array(35);
  payload[0] = 0x30; // 6 << 3 = 48 = 0x30
  payload.set(publicKey, 1);

  const checksum = crc16Xmodem(payload.slice(0, 33));
  payload[33] = checksum & 0xff; // little-endian
  payload[34] = (checksum >> 8) & 0xff;

  return base32Encode(payload);
}

export interface StellarKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array; // 64-byte Ed25519 expanded secret key (tweetnacl format)
  address: string; // G-address
}

/**
 * Create a keypair from a Stellar S-address secret seed.
 */
export function keypairFromSecret(secretSeed: string): StellarKeyPair {
  const seed = decodeStellarSecret(secretSeed);
  const kp = nacl.sign.keyPair.fromSeed(seed);
  return {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    address: encodeStellarPublicKey(kp.publicKey),
  };
}

/**
 * Generate a random Stellar keypair.
 */
export function generateKeypair(): StellarKeyPair {
  const kp = nacl.sign.keyPair();
  return {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    address: encodeStellarPublicKey(kp.publicKey),
  };
}

/**
 * Sign a message (Uint8Array) with an Ed25519 secret key.
 * Returns the detached 64-byte signature.
 */
export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return nacl.sign.detached(message, secretKey);
}
