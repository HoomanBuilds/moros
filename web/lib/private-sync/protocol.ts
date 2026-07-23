export const PRIVATE_SYNC_SCHEMA = 1;
export const PRIVATE_SYNC_CIPHER = "AES-256-GCM";
export const PRIVATE_SYNC_PAGE_BYTES = 65_536;
export const PRIVATE_SYNC_MAX_PAGES = 32;
export const PRIVATE_SYNC_REQUEST_TTL_SECONDS = 300;

export type PrivateSyncPage = {
  pageId: string;
  ciphertext: string;
  nonce: string;
  ciphertextHash: string;
};

export type RegisterPayload = {
  operation: "register";
  bucketId: string;
  schemaVersion: number;
  verificationKey: string;
};

export type ReadPayload = {
  operation: "read";
  bucketId: string;
  schemaVersion: number;
};

export type WritePayload = {
  operation: "write";
  bucketId: string;
  schemaVersion: number;
  expectedGeneration: number;
  pages: PrivateSyncPage[];
};

export type PrivateSyncPayload = RegisterPayload | ReadPayload | WritePayload;

export type PrivateSyncRequest = {
  payload: PrivateSyncPayload;
  nonce: string;
  expiresAt: number;
  signature: string;
};

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) result[key] = sortedValue(source[key]);
  return result;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortedValue(value));
}

export function privateSyncMessage(
  payload: PrivateSyncPayload,
  payloadHash: string,
  nonce: string,
  expiresAt: number,
): string {
  return [
    "Moros private activity sync",
    `Operation: ${payload.operation}`,
    `Bucket: ${payload.bucketId}`,
    `Schema: ${payload.schemaVersion}`,
    `Payload-SHA256: ${payloadHash}`,
    `Nonce: ${nonce}`,
    `Expires-At: ${expiresAt}`,
  ].join("\n");
}
