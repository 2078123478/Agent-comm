import { getPublicKey as getSecpPublicKey, utils } from "@noble/secp256k1";
import { getAddress as getChecksumAddress, keccak256, type Hex } from "viem";

const PRIVATE_KEY_LENGTH = 32;

function toHex(bytes: Uint8Array): Hex {
  return `0x${Buffer.from(bytes).toString("hex")}` as Hex;
}

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function toFixedSizeBuffer(hex: string, size: number, label: string): Buffer {
  const normalized = stripHexPrefix(hex);
  if (normalized.length !== size * 2) {
    throw new Error(`Invalid ${label}: expected ${size} bytes`);
  }
  if (!/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error(`Invalid ${label}: expected hex`);
  }
  return Buffer.from(normalized, "hex");
}

export interface ShadowWallet {
  readonly privateKey: Hex;
  getPublicKey(): Hex;
  getAddress(): Hex;
}

export function getPublicKey(privateKey: string): Hex {
  const normalizedPrivateKey = toFixedSizeBuffer(privateKey, PRIVATE_KEY_LENGTH, "private key");
  return toHex(getSecpPublicKey(normalizedPrivateKey, true));
}

export function getAddress(privateKey: string): Hex {
  const normalizedPrivateKey = toFixedSizeBuffer(privateKey, PRIVATE_KEY_LENGTH, "private key");
  const uncompressed = Buffer.from(getSecpPublicKey(normalizedPrivateKey, false));
  const publicKeyHash = keccak256(`0x${uncompressed.subarray(1).toString("hex")}` as Hex);
  return getChecksumAddress(`0x${publicKeyHash.slice(-40)}` as Hex);
}

class Secp256k1ShadowWallet implements ShadowWallet {
  readonly privateKey: Hex;

  constructor(privateKey: Uint8Array) {
    this.privateKey = toHex(privateKey);
  }

  getPublicKey(): Hex {
    return getPublicKey(this.privateKey);
  }

  getAddress(): Hex {
    return getAddress(this.privateKey);
  }
}

export function generateShadowWallet(): ShadowWallet {
  return new Secp256k1ShadowWallet(utils.randomPrivateKey());
}

export function restoreShadowWallet(privateKey: string): ShadowWallet {
  return new Secp256k1ShadowWallet(toFixedSizeBuffer(privateKey, PRIVATE_KEY_LENGTH, "private key"));
}
