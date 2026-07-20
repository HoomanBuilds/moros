"use client";

import { getKit } from "@/lib/wallet";
import { NETWORK } from "@/lib/network";
import { getBrowserClient } from "@/lib/supabase/client";
import { signInWithWallet } from "@/lib/supabase/auth";
import { backupMessage, decryptPosition, deriveBackupKey, encryptPosition } from "./crypto";
import { listPositions, mergePositions, updatePosition, type Position } from "./book";

const unlockedKeys = new Map<string, CryptoKey>();

async function ensureWalletSession(address: string) {
  const client = getBrowserClient();
  if (!client) throw new Error("Encrypted position backup is not configured");
  const { data } = await client.auth.getSession();
  if (data.session?.user.app_metadata?.wallet === address) return client;
  const result = await signInWithWallet(address);
  if (!result.ok) throw new Error(result.error);
  return client;
}

export async function unlockPositionBackup(address: string): Promise<CryptoKey> {
  const existing = unlockedKeys.get(address);
  if (existing) return existing;
  const message = backupMessage(address, NETWORK.id);
  const { signedMessage } = await getKit().signMessage(message, { address });
  const key = await deriveBackupKey(address, NETWORK.id, signedMessage);
  unlockedKeys.set(address, key);
  return key;
}

export async function preparePositionBackup(address: string): Promise<CryptoKey> {
  await ensureWalletSession(address);
  return unlockPositionBackup(address);
}

export async function savePositionBackup(position: Position, key: CryptoKey): Promise<void> {
  const client = await ensureWalletSession(position.address);
  if (!position.pool) throw new Error("Position pool is missing");
  const encrypted = await encryptPosition(position, key);
  const { error } = await client.from("private_positions").upsert({
    wallet: position.address,
    commitment: position.commitment,
    market_id: position.market,
    pool_id: position.pool,
    tx_hash: position.txHash,
    placed_at: new Date(position.placedAt).toISOString(),
    ciphertext: encrypted.ciphertext,
    encryption_iv: encrypted.iv,
    updated_at: new Date().toISOString(),
  }, { onConflict: "wallet,commitment" });
  if (error) throw new Error(error.message);
  updatePosition(position.address, position.commitment, {
    backupStatus: "synced",
    backupError: undefined,
  });
}

export async function restorePositionBackups(address: string, key?: CryptoKey): Promise<number> {
  const client = await ensureWalletSession(address);
  const backupKey = key ?? await unlockPositionBackup(address);
  const { data, error } = await client
    .from("private_positions")
    .select("ciphertext, encryption_iv")
    .eq("wallet", address)
    .order("placed_at", { ascending: false });
  if (error) throw new Error(error.message);
  const positions: Position[] = [];
  for (const row of data ?? []) {
    positions.push(await decryptPosition(row.ciphertext, row.encryption_iv, backupKey));
  }
  return mergePositions(address, positions);
}

export async function exportEncryptedPositionFile(address: string, key: CryptoKey): Promise<string> {
  const records = await Promise.all(listPositions(address).map((position) => encryptPosition(position, key)));
  return JSON.stringify({
    format: "moros-private-positions",
    network: NETWORK.id,
    address,
    exportedAt: new Date().toISOString(),
    records,
  }, null, 2);
}

export async function importEncryptedPositionFile(contents: string, address: string, key: CryptoKey): Promise<number> {
  const parsed = JSON.parse(contents) as {
    format?: unknown;
    network?: unknown;
    address?: unknown;
    records?: unknown;
  };
  if (parsed.format !== "moros-private-positions" || parsed.network !== NETWORK.id || parsed.address !== address || !Array.isArray(parsed.records)) {
    throw new Error("This recovery file does not match the connected wallet and network");
  }
  const positions: Position[] = [];
  for (const record of parsed.records) {
    if (!record || typeof record !== "object") throw new Error("Recovery file contains an invalid record");
    const row = record as Record<string, unknown>;
    if (typeof row.ciphertext !== "string" || typeof row.iv !== "string") throw new Error("Recovery file contains an invalid record");
    positions.push(await decryptPosition(row.ciphertext, row.iv, key));
  }
  return mergePositions(address, positions);
}
