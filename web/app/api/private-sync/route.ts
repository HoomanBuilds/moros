import { Keypair } from "@stellar/stellar-sdk";
import { getPrivateSyncAdmin } from "@/lib/private-sync/admin";
import { fromBase64, sha256Hex, utf8 } from "@/lib/private-sync/encoding";
import {
  canonicalJson,
  PRIVATE_SYNC_MAX_PAGES,
  PRIVATE_SYNC_PAGE_BYTES,
  PRIVATE_SYNC_REQUEST_TTL_SECONDS,
  PRIVATE_SYNC_SCHEMA,
  privateSyncMessage,
  type PrivateSyncPage,
  type PrivateSyncPayload,
  type PrivateSyncRequest,
} from "@/lib/private-sync/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPAQUE_ID = /^[A-Za-z0-9_-]{43}$/u;
const REQUEST_NONCE = /^[A-Za-z0-9_-]{32}$/u;
const STELLAR_KEY = /^G[A-Z2-7]{55}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const CIPHERTEXT_LENGTH = Math.ceil((PRIVATE_SYNC_PAGE_BYTES + 16) / 3) * 4;

function response(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

function isPage(value: unknown): value is PrivateSyncPage {
  if (!value || typeof value !== "object") return false;
  const page = value as Record<string, unknown>;
  return typeof page.pageId === "string"
    && OPAQUE_ID.test(page.pageId)
    && typeof page.ciphertext === "string"
    && page.ciphertext.length === CIPHERTEXT_LENGTH
    && typeof page.nonce === "string"
    && page.nonce.length === 16
    && typeof page.ciphertextHash === "string"
    && SHA256.test(page.ciphertextHash);
}

function parsePayload(value: unknown): PrivateSyncPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (typeof payload.bucketId !== "string"
    || !OPAQUE_ID.test(payload.bucketId)
    || payload.schemaVersion !== PRIVATE_SYNC_SCHEMA
    || typeof payload.operation !== "string") {
    return null;
  }
  if (payload.operation === "register") {
    return typeof payload.verificationKey === "string" && STELLAR_KEY.test(payload.verificationKey)
      ? payload as RegisterPayload
      : null;
  }
  if (payload.operation === "read") return payload as ReadPayload;
  if (payload.operation === "write") {
    if (!Number.isSafeInteger(payload.expectedGeneration)
      || Number(payload.expectedGeneration) < 0
      || !Array.isArray(payload.pages)
      || payload.pages.length === 0
      || payload.pages.length > PRIVATE_SYNC_MAX_PAGES
      || !payload.pages.every(isPage)
      || new Set(payload.pages.map((page) => page.pageId)).size !== payload.pages.length) {
      return null;
    }
    return payload as WritePayload;
  }
  return null;
}

type RegisterPayload = Extract<PrivateSyncPayload, { operation: "register" }>;
type ReadPayload = Extract<PrivateSyncPayload, { operation: "read" }>;
type WritePayload = Extract<PrivateSyncPayload, { operation: "write" }>;

function parseRequest(value: unknown): PrivateSyncRequest | null {
  if (!value || typeof value !== "object") return null;
  const request = value as Record<string, unknown>;
  const payload = parsePayload(request.payload);
  if (!payload
    || typeof request.nonce !== "string"
    || !REQUEST_NONCE.test(request.nonce)
    || !Number.isSafeInteger(request.expiresAt)
    || typeof request.signature !== "string"
    || request.signature.length < 80
    || request.signature.length > 128) {
    return null;
  }
  return {
    payload,
    nonce: request.nonce,
    expiresAt: Number(request.expiresAt),
    signature: request.signature,
  };
}

async function verificationKeyFor(
  admin: NonNullable<ReturnType<typeof getPrivateSyncAdmin>>,
  payload: PrivateSyncPayload,
): Promise<string | null> {
  if (payload.operation === "register") return payload.verificationKey;
  const { data, error } = await admin
    .from("private_sync_buckets")
    .select("verification_key, schema_version")
    .eq("bucket_id", payload.bucketId)
    .maybeSingle();
  if (error || !data || data.schema_version !== PRIVATE_SYNC_SCHEMA) return null;
  return data.verification_key;
}

async function verifyRequest(request: PrivateSyncRequest, verificationKey: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  if (request.expiresAt < now || request.expiresAt > now + PRIVATE_SYNC_REQUEST_TTL_SECONDS) {
    return false;
  }
  try {
    const payloadHash = await sha256Hex(utf8(canonicalJson(request.payload)));
    const message = privateSyncMessage(
      request.payload,
      payloadHash,
      request.nonce,
      request.expiresAt,
    );
    return Keypair.fromPublicKey(verificationKey).verify(
      Buffer.from(utf8(message)),
      Buffer.from(fromBase64(request.signature)),
    );
  } catch {
    return false;
  }
}

async function consumeNonce(
  admin: NonNullable<ReturnType<typeof getPrivateSyncAdmin>>,
  request: PrivateSyncRequest,
): Promise<boolean> {
  const { data, error } = await admin.rpc("consume_private_sync_nonce", {
    target_bucket: request.payload.bucketId,
    target_nonce: request.nonce,
    target_expiry: new Date(request.expiresAt * 1000).toISOString(),
  });
  return !error && data === true;
}

async function register(
  admin: NonNullable<ReturnType<typeof getPrivateSyncAdmin>>,
  payload: RegisterPayload,
): Promise<Response> {
  const { error } = await admin.from("private_sync_buckets").insert({
    bucket_id: payload.bucketId,
    verification_key: payload.verificationKey,
    schema_version: payload.schemaVersion,
  });
  if (error && error.code !== "23505") return response({ error: "Private archive registration failed" }, 503);
  const { data, error: readError } = await admin
    .from("private_sync_buckets")
    .select("verification_key, schema_version, current_generation")
    .eq("bucket_id", payload.bucketId)
    .single();
  if (readError
    || !data
    || data.verification_key !== payload.verificationKey
    || data.schema_version !== payload.schemaVersion) {
    return response({ error: "Private archive capability mismatch" }, 409);
  }
  return response({ generation: Number(data.current_generation) });
}

async function read(
  admin: NonNullable<ReturnType<typeof getPrivateSyncAdmin>>,
  payload: ReadPayload,
): Promise<Response> {
  const [{ data: bucket, error: bucketError }, { data: pages, error: pagesError }] = await Promise.all([
    admin
      .from("private_sync_buckets")
      .select("current_generation")
      .eq("bucket_id", payload.bucketId)
      .single(),
    admin
      .from("private_sync_pages")
      .select("page_id, ciphertext, nonce, ciphertext_hash")
      .eq("bucket_id", payload.bucketId),
  ]);
  if (bucketError || pagesError || !bucket) return response({ error: "Private archive read failed" }, 503);
  return response({
    generation: Number(bucket.current_generation),
    pages: (pages ?? []).map((page) => ({
      pageId: page.page_id,
      ciphertext: page.ciphertext,
      nonce: page.nonce,
      ciphertextHash: page.ciphertext_hash,
    })),
  });
}

async function write(
  admin: NonNullable<ReturnType<typeof getPrivateSyncAdmin>>,
  payload: WritePayload,
): Promise<Response> {
  const { data, error } = await admin.rpc("write_private_sync_pages", {
    target_bucket: payload.bucketId,
    expected_generation: payload.expectedGeneration,
    replacement_pages: payload.pages.map((page) => ({
      page_id: page.pageId,
      ciphertext: page.ciphertext,
      nonce: page.nonce,
      ciphertext_hash: page.ciphertextHash,
    })),
  });
  if (error) return response({ error: "Private archive update failed" }, 503);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.applied) {
    return response({
      error: "Private archive changed on another device",
      generation: Number(row?.current_generation ?? 0),
    }, 409);
  }
  return response({ generation: Number(row.current_generation) });
}

export async function POST(request: Request): Promise<Response> {
  const admin = getPrivateSyncAdmin();
  if (!admin) return response({ error: "Private activity sync is not configured" }, 503);
  const parsed = parseRequest(await request.json().catch(() => null));
  if (!parsed) return response({ error: "Invalid private sync request" }, 400);
  const verificationKey = await verificationKeyFor(admin, parsed.payload);
  if (!verificationKey || !await verifyRequest(parsed, verificationKey)) {
    return response({ error: "Invalid private sync capability" }, 401);
  }
  if (parsed.payload.operation === "register") {
    const registration = await register(admin, parsed.payload);
    if (!registration.ok) return registration;
    if (!await consumeNonce(admin, parsed)) {
      return response({ error: "Private sync request was already used" }, 409);
    }
    return registration;
  }
  if (!await consumeNonce(admin, parsed)) return response({ error: "Private sync request was already used" }, 409);
  if (parsed.payload.operation === "read") return read(admin, parsed.payload);
  return write(admin, parsed.payload);
}
