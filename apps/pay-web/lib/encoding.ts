export function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  if (typeof value !== "string" || value.length === 0) throw new Error("invalid encoded value");
  const binary = atob(value);
  const output = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytesToBase64(output) !== value) throw new Error("invalid encoded value");
  return output;
}

export function randomBytes(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 1 || length > 1024) {
    throw new Error("invalid random byte length");
  }
  return crypto.getRandomValues(new Uint8Array(length));
}
