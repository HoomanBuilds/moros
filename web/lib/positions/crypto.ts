import type { Position } from "./book";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function backupMessage(address: string, network: string): string {
  return [
    "Moros private position recovery",
    `Network: ${network}`,
    `Wallet: ${address}`,
    "Purpose: encrypt and recover private position notes",
    "This signature does not submit a transaction or authorize spending.",
  ].join("\n");
}

export async function deriveBackupKey(address: string, network: string, signature: string): Promise<CryptoKey> {
  const material = await globalThis.crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(encoder.encode(`${backupMessage(address, network)}\nSignature: ${signature}`)),
  );
  return globalThis.crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptPosition(position: Position, key: CryptoKey): Promise<{ ciphertext: string; iv: string }> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(encoder.encode(JSON.stringify(position))),
  );
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv) };
}

export async function decryptPosition(ciphertext: string, iv: string, key: CryptoKey): Promise<Position> {
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(fromBase64(iv)) },
    key,
    toArrayBuffer(fromBase64(ciphertext)),
  );
  return JSON.parse(decoder.decode(plaintext)) as Position;
}
