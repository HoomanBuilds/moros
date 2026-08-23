import { base64ToBytes, bytesToBase64, randomBytes } from "./encoding";

export const WALLET_FORMAT = 1;
export const WALLET_KDF_ITERATIONS = 600_000;
export const MINIMUM_PASSWORD_LENGTH = 12;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AAD = new TextEncoder().encode("moros/payment-wallet/v1");

export interface EncryptedWalletRecord {
  format: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  createdAt: number;
  backupVerified: boolean;
  salt: string;
  iv: string;
  ciphertext: string;
}

function validatePassword(password: string): void {
  if (typeof password !== "string" || password.length < MINIMUM_PASSWORD_LENGTH || password.length > 256) {
    throw new Error(`password must contain at least ${MINIMUM_PASSWORD_LENGTH} characters`);
  }
}

function validatePhrase(phrase: string): void {
  const words = phrase.trim().split(/\s+/);
  if (words.length !== 24 || phrase.length > 512) throw new Error("invalid recovery phrase");
}

function validateRecord(value: unknown): EncryptedWalletRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid wallet record");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (keys !== "backupVerified,ciphertext,createdAt,format,iterations,iv,kdf,salt") throw new Error("invalid wallet record");
  if (
    record.format !== WALLET_FORMAT ||
    record.kdf !== "PBKDF2-SHA256" ||
    typeof record.backupVerified !== "boolean" ||
    !Number.isSafeInteger(record.iterations) ||
    Number(record.iterations) < WALLET_KDF_ITERATIONS ||
    !Number.isSafeInteger(record.createdAt) ||
    Number(record.createdAt) < 1
  ) {
    throw new Error("invalid wallet record");
  }
  const salt = base64ToBytes(String(record.salt));
  const iv = base64ToBytes(String(record.iv));
  const ciphertext = base64ToBytes(String(record.ciphertext));
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || ciphertext.length < 32 || ciphertext.length > 1024) {
    throw new Error("invalid wallet record");
  }
  return record as unknown as EncryptedWalletRecord;
}

async function deriveKey(password: string, salt: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  const passwordBytes = new TextEncoder().encode(password);
  try {
    const material = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: WALLET_KDF_ITERATIONS },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      usages,
    );
  } finally {
    passwordBytes.fill(0);
  }
}

export async function encryptRecoveryPhrase(
  phrase: string,
  password: string,
  createdAt = Date.now(),
  backupVerified = false,
): Promise<EncryptedWalletRecord> {
  validatePhrase(phrase);
  validatePassword(password);
  if (!Number.isSafeInteger(createdAt) || createdAt < 1) throw new Error("invalid wallet creation time");
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(password, salt, ["encrypt"]);
  const plaintext = new TextEncoder().encode(phrase.trim());
  try {
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: AAD as BufferSource, tagLength: 128 },
      key,
      plaintext,
    );
    return {
      format: WALLET_FORMAT,
      kdf: "PBKDF2-SHA256",
      iterations: WALLET_KDF_ITERATIONS,
      createdAt,
      backupVerified,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    };
  } finally {
    plaintext.fill(0);
    salt.fill(0);
    iv.fill(0);
  }
}

export async function decryptRecoveryPhrase(value: unknown, password: string): Promise<string> {
  validatePassword(password);
  const record = validateRecord(value);
  const salt = base64ToBytes(record.salt);
  const iv = base64ToBytes(record.iv);
  const ciphertext = base64ToBytes(record.ciphertext);
  try {
    const key = await deriveKey(password, salt, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: AAD as BufferSource, tagLength: 128 },
      key,
      ciphertext as BufferSource,
    );
    const plaintext = new Uint8Array(decrypted);
    try {
      const phrase = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
      validatePhrase(phrase);
      return phrase;
    } finally {
      plaintext.fill(0);
    }
  } catch {
    throw new Error("wallet password is incorrect or recovery data is damaged");
  } finally {
    salt.fill(0);
    iv.fill(0);
    ciphertext.fill(0);
  }
}

export function parseWalletRecord(serialized: string): EncryptedWalletRecord {
  if (serialized.length > 4096) throw new Error("wallet record is too large");
  return validateRecord(JSON.parse(serialized));
}
