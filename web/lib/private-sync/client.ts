"use client";

import type { PrivateArchiveKeys } from "./crypto";
import { newRequestNonce } from "./crypto";
import { sha256Hex, toBase64, utf8 } from "./encoding";
import {
  canonicalJson,
  PRIVATE_SYNC_REQUEST_TTL_SECONDS,
  PRIVATE_SYNC_SCHEMA,
  privateSyncMessage,
  type PrivateSyncPage,
  type PrivateSyncPayload,
  type PrivateSyncRequest,
} from "./protocol";

export type PrivateSyncSnapshot = {
  generation: number;
  pages: PrivateSyncPage[];
};

async function signedRequest(
  keys: PrivateArchiveKeys,
  payload: PrivateSyncPayload,
): Promise<PrivateSyncRequest> {
  const nonce = newRequestNonce();
  const expiresAt = Math.floor(Date.now() / 1000) + PRIVATE_SYNC_REQUEST_TTL_SECONDS;
  const payloadHash = await sha256Hex(utf8(canonicalJson(payload)));
  const message = privateSyncMessage(payload, payloadHash, nonce, expiresAt);
  const signature = keys.signingKey.sign(utf8(message) as Buffer);
  return { payload, nonce, expiresAt, signature: toBase64(signature) };
}

async function send(
  keys: PrivateArchiveKeys,
  payload: PrivateSyncPayload,
): Promise<Record<string, unknown>> {
  const response = await fetch("/api/private-sync", {
    method: "POST",
    cache: "no-store",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(await signedRequest(keys, payload)),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = typeof body?.error === "string" ? body.error : "Private activity sync failed";
    const conflict = new Error(error) as Error & { generation?: number };
    if (response.status === 409 && Number.isInteger(body?.generation)) {
      conflict.generation = Number(body.generation);
    }
    throw conflict;
  }
  return body as Record<string, unknown>;
}

export async function registerPrivateArchive(keys: PrivateArchiveKeys): Promise<number> {
  const body = await send(keys, {
    operation: "register",
    bucketId: keys.bucketId,
    schemaVersion: PRIVATE_SYNC_SCHEMA,
    verificationKey: keys.verificationKey,
  });
  if (!Number.isInteger(body.generation)) throw new Error("Private archive registration was invalid");
  return Number(body.generation);
}

export async function readPrivateArchive(keys: PrivateArchiveKeys): Promise<PrivateSyncSnapshot> {
  const body = await send(keys, {
    operation: "read",
    bucketId: keys.bucketId,
    schemaVersion: PRIVATE_SYNC_SCHEMA,
  });
  if (!Number.isInteger(body.generation) || !Array.isArray(body.pages)) {
    throw new Error("Private archive response was invalid");
  }
  return {
    generation: Number(body.generation),
    pages: body.pages as PrivateSyncPage[],
  };
}

export async function writePrivateArchive(
  keys: PrivateArchiveKeys,
  expectedGeneration: number,
  pages: PrivateSyncPage[],
): Promise<number> {
  const body = await send(keys, {
    operation: "write",
    bucketId: keys.bucketId,
    schemaVersion: PRIVATE_SYNC_SCHEMA,
    expectedGeneration,
    pages,
  });
  if (!Number.isInteger(body.generation)) throw new Error("Private archive update was invalid");
  return Number(body.generation);
}
