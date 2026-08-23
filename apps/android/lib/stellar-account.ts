const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PUBLIC_KEY_VERSION = 6 << 3;

function decodeBase32(value: string): Uint8Array | null {
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of value) {
    const digit = ALPHABET.indexOf(character);
    if (digit < 0) return null;
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 255);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && buffer !== 0) return null;
  return Uint8Array.from(output);
}

function crc16Xmodem(value: Uint8Array): number {
  let crc = 0;
  for (const byte of value) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

export function isValidStellarAccount(value: string): boolean {
  if (!/^G[A-Z2-7]{55}$/.test(value)) return false;
  const decoded = decodeBase32(value);
  if (!decoded || decoded.length !== 35 || decoded[0] !== PUBLIC_KEY_VERSION) return false;
  const checksum = crc16Xmodem(decoded.slice(0, 33));
  return decoded[33] === (checksum & 255) && decoded[34] === (checksum >> 8);
}

export function shortStellarAccount(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}
