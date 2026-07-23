import { Keypair } from "@stellar/stellar-sdk";
import type { Position } from "@/lib/positions/book";
import {
  PRIVATE_SYNC_CIPHER,
  PRIVATE_SYNC_PAGE_BYTES,
  PRIVATE_SYNC_SCHEMA,
  type PrivateSyncPage,
} from "./protocol";
import {
  fromBase64,
  randomBase64Url,
  sha256,
  sha256Hex,
  toArrayBuffer,
  toBase64,
  toBase64Url,
  utf8,
} from "./encoding";

const decoder = new TextDecoder();
const LENGTH_BYTES = 4;

export type PrivateArchiveKeys = {
  address: string;
  encryptionKey: CryptoKey;
  pageIdKey: CryptoKey;
  signingKey: Keypair;
  bucketId: string;
  verificationKey: string;
  context: string;
  noteSpendSecret: bigint;
  noteViewingSecret: bigint;
};

function privateScalar(bytes: Uint8Array): bigint {
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const value = BigInt(`0x${hex}`) % ((1n << 248n) - 1n);
  return value + 1n;
}

function signatureMaterial(signature: string): Uint8Array {
  try {
    const decoded = fromBase64(signature);
    if (decoded.length >= 32) return decoded;
  } catch {
    // Some test wallets return an opaque deterministic string instead of base64.
  }
  return utf8(signature);
}

async function deriveBits(
  signature: string,
  context: string,
  address: string,
): Promise<Uint8Array> {
  const source = await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(signatureMaterial(signature)),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const salt = await sha256(utf8(`Moros private sync salt\n${address}\n${context}`));
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(utf8("Moros private activity archive keys")),
    },
    source,
    1_280,
  );
  return new Uint8Array(bits);
}

export async function derivePrivateArchiveKeys(
  address: string,
  network: string,
  vault: string,
  signature: string,
): Promise<PrivateArchiveKeys> {
  const context = `${network}:${vault}:${PRIVATE_SYNC_SCHEMA}`;
  const material = await deriveBits(signature, context, address);
  const encryptionKey = await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(material.slice(0, 32)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
  const pageIdKey = await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(material.slice(32, 64)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signingKey = Keypair.fromRawEd25519Seed(material.slice(64, 96) as Buffer);
  const bucketId = toBase64Url(await sha256(material.slice(32, 64)));
  return {
    address,
    encryptionKey,
    pageIdKey,
    signingKey,
    bucketId,
    verificationKey: signingKey.publicKey(),
    context,
    noteSpendSecret: privateScalar(material.slice(96, 128)),
    noteViewingSecret: privateScalar(material.slice(128, 160)),
  };
}

async function pageId(keys: PrivateArchiveKeys, index: number): Promise<string> {
  const digest = await globalThis.crypto.subtle.sign(
    "HMAC",
    keys.pageIdKey,
    toArrayBuffer(utf8(`Moros private sync page:${index}`)),
  );
  return toBase64Url(new Uint8Array(digest));
}

function paddedPage(positions: Position[], index: number): Uint8Array {
  const plaintext = utf8(JSON.stringify({ index, positions }));
  if (plaintext.length + LENGTH_BYTES > PRIVATE_SYNC_PAGE_BYTES) {
    throw new Error("Private activity page is too large");
  }
  const page = globalThis.crypto.getRandomValues(new Uint8Array(PRIVATE_SYNC_PAGE_BYTES));
  new DataView(page.buffer).setUint32(0, plaintext.length, false);
  page.set(plaintext, LENGTH_BYTES);
  return page;
}

function pageAad(keys: PrivateArchiveKeys, id: string): Uint8Array {
  return utf8(`${keys.context}:${keys.bucketId}:${id}:${PRIVATE_SYNC_CIPHER}`);
}

export async function encryptArchivePage(
  keys: PrivateArchiveKeys,
  positions: Position[],
  index: number,
): Promise<PrivateSyncPage> {
  const id = await pageId(keys, index);
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(pageAad(keys, id)),
    },
    keys.encryptionKey,
    toArrayBuffer(paddedPage(positions, index)),
  ));
  return {
    pageId: id,
    ciphertext: toBase64(ciphertext),
    nonce: toBase64(nonce),
    ciphertextHash: await sha256Hex(ciphertext),
  };
}

export async function decryptArchivePage(
  keys: PrivateArchiveKeys,
  page: PrivateSyncPage,
): Promise<{ index: number; positions: Position[] }> {
  const ciphertext = fromBase64(page.ciphertext);
  if (await sha256Hex(ciphertext) !== page.ciphertextHash) {
    throw new Error("Private activity page hash mismatch");
  }
  const plaintext = new Uint8Array(await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(fromBase64(page.nonce)),
      additionalData: toArrayBuffer(pageAad(keys, page.pageId)),
    },
    keys.encryptionKey,
    toArrayBuffer(ciphertext),
  ));
  if (plaintext.length !== PRIVATE_SYNC_PAGE_BYTES) {
    throw new Error("Private activity page has an invalid size");
  }
  const length = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength)
    .getUint32(0, false);
  if (length === 0 || length > PRIVATE_SYNC_PAGE_BYTES - LENGTH_BYTES) {
    throw new Error("Private activity page has an invalid payload");
  }
  const parsed = JSON.parse(decoder.decode(plaintext.slice(LENGTH_BYTES, LENGTH_BYTES + length))) as {
    index?: unknown;
    positions?: unknown;
  };
  if (!Number.isInteger(parsed.index) || Number(parsed.index) < 0 || !Array.isArray(parsed.positions)) {
    throw new Error("Private activity page has an invalid payload");
  }
  return { index: Number(parsed.index), positions: parsed.positions as Position[] };
}

export async function splitArchivePages(
  keys: PrivateArchiveKeys,
  positions: Position[],
): Promise<PrivateSyncPage[]> {
  const pages: Position[][] = [];
  let current: Position[] = [];
  for (const position of positions) {
    const candidate = [...current, position];
    if (utf8(JSON.stringify({ index: pages.length, positions: candidate })).length + LENGTH_BYTES <= PRIVATE_SYNC_PAGE_BYTES) {
      current = candidate;
      continue;
    }
    if (current.length === 0) throw new Error("A private activity record is too large");
    pages.push(current);
    current = [position];
  }
  if (current.length > 0 || pages.length === 0) pages.push(current);
  return Promise.all(pages.map((records, index) => encryptArchivePage(keys, records, index)));
}

export async function joinArchivePages(
  keys: PrivateArchiveKeys,
  pages: PrivateSyncPage[],
): Promise<Position[]> {
  const decrypted = await Promise.all(pages.map((page) => decryptArchivePage(keys, page)));
  decrypted.sort((left, right) => left.index - right.index);
  decrypted.forEach((page, index) => {
    if (page.index !== index) throw new Error("Private activity archive is missing a page");
  });
  return decrypted.flatMap((page) => page.positions);
}

export function newRequestNonce(): string {
  return randomBase64Url(24);
}
