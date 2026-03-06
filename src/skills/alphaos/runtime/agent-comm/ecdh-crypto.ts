import crypto from "node:crypto";
import { getSharedSecret } from "@noble/secp256k1";
import type { Hex } from "viem";

const AES_ALGO = "aes-256-gcm";
const DERIVED_KEY_LENGTH = 32;
const SHARED_KEY_LENGTH = 32;
const SCRYPT_SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function toHex(bytes: Uint8Array): Hex {
  return `0x${Buffer.from(bytes).toString("hex")}` as Hex;
}

function fromHex(value: string, label: string): Buffer {
  const normalized = stripHexPrefix(value);
  if (normalized.length === 0 || normalized.length % 2 !== 0) {
    throw new Error(`Invalid ${label}: expected even-length hex`);
  }
  if (!/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error(`Invalid ${label}: expected hex characters only`);
  }
  return Buffer.from(normalized, "hex");
}

function deriveCipherKey(sharedKey: string, salt: Buffer): Buffer {
  return crypto.scryptSync(fromHex(sharedKey, "shared key"), salt, DERIVED_KEY_LENGTH) as Buffer;
}

export function deriveSharedKey(privateKey: string, peerPublicKey: string): Hex {
  const normalizedPrivateKey = stripHexPrefix(privateKey);
  const normalizedPeerPublicKey = stripHexPrefix(peerPublicKey);
  const sharedPoint = getSharedSecret(normalizedPrivateKey, normalizedPeerPublicKey, true);
  const sharedKey = sharedPoint.subarray(1);
  if (sharedKey.length !== SHARED_KEY_LENGTH) {
    throw new Error("Invalid shared key length");
  }
  return toHex(sharedKey);
}

export function encrypt(plaintext: string, sharedKey: string): Hex {
  const salt = crypto.randomBytes(SCRYPT_SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveCipherKey(sharedKey, salt);
  const cipher = crypto.createCipheriv(AES_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([salt, iv, authTag, encrypted]);
  key.fill(0);
  return toHex(payload);
}

export function decrypt(ciphertext: string, sharedKey: string): string {
  const payload = fromHex(ciphertext, "ciphertext");
  const minPayloadLength = SCRYPT_SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;
  if (payload.length <= minPayloadLength) {
    throw new Error("Invalid ciphertext payload");
  }

  const salt = payload.subarray(0, SCRYPT_SALT_LENGTH);
  const iv = payload.subarray(SCRYPT_SALT_LENGTH, SCRYPT_SALT_LENGTH + IV_LENGTH);
  const authTag = payload.subarray(
    SCRYPT_SALT_LENGTH + IV_LENGTH,
    SCRYPT_SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
  );
  const encrypted = payload.subarray(minPayloadLength);
  const key = deriveCipherKey(sharedKey, salt);
  try {
    const decipher = crypto.createDecipheriv(AES_ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } finally {
    key.fill(0);
  }
}
