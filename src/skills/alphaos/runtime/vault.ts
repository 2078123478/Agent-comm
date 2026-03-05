import crypto from "node:crypto";
import { StateStore } from "./state-store";

const AES_ALGO = "aes-256-gcm";
const PBKDF2_DIGEST = "sha256";
const KEY_LEN = 32;
const NONCE_LEN = 12;
const SALT_LEN = 16;
const DEFAULT_ITERATIONS = 310_000;

function deriveKey(password: string, salt: Buffer, iterations: number): Buffer {
  return crypto.pbkdf2Sync(password, salt, iterations, KEY_LEN, PBKDF2_DIGEST);
}

function encrypt(plaintext: string, password: string, iterations: number): { cipherText: string; nonce: string; salt: string } {
  const nonce = crypto.randomBytes(NONCE_LEN);
  const salt = crypto.randomBytes(SALT_LEN);
  const key = deriveKey(password, salt, iterations);
  const cipher = crypto.createCipheriv(AES_ALGO, key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([encrypted, tag]);
  key.fill(0);
  return {
    cipherText: payload.toString("base64"),
    nonce: nonce.toString("base64"),
    salt: salt.toString("base64"),
  };
}

function decrypt(cipherText: string, nonceB64: string, saltB64: string, password: string, iterations: number): string {
  const payload = Buffer.from(cipherText, "base64");
  if (payload.length < 17) {
    throw new Error("Invalid cipher payload");
  }

  const encrypted = payload.subarray(0, payload.length - 16);
  const tag = payload.subarray(payload.length - 16);
  const nonce = Buffer.from(nonceB64, "base64");
  const salt = Buffer.from(saltB64, "base64");

  const key = deriveKey(password, salt, iterations);
  const decipher = crypto.createDecipheriv(AES_ALGO, key, nonce);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  key.fill(0);
  return decrypted;
}

export class VaultService {
  constructor(private readonly store: StateStore, private readonly iterations = DEFAULT_ITERATIONS) {}

  setSecret(alias: string, plaintext: string, masterPassword: string): void {
    if (!alias.trim()) {
      throw new Error("Alias must not be empty");
    }
    const encrypted = encrypt(plaintext, masterPassword, this.iterations);
    this.store.upsertVaultItem({
      keyAlias: alias,
      cipherText: encrypted.cipherText,
      nonce: encrypted.nonce,
      salt: encrypted.salt,
      kdfIter: this.iterations,
    });
  }

  getSecret(alias: string, masterPassword: string): string {
    const row = this.store.getVaultItem(alias);
    if (!row) {
      throw new Error(`Secret not found: ${alias}`);
    }
    return decrypt(row.cipherText, row.nonce, row.salt, masterPassword, row.kdfIter);
  }
}
