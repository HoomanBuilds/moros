"use client";

import { getKit } from "@/lib/wallet";
import { NETWORK } from "@/lib/network";
import { getPrivateConfig } from "@/lib/private/client";
import {
  readPrivateArchive,
  registerPrivateArchive,
  writePrivateArchive,
} from "@/lib/private-sync/client";
import {
  derivePrivateArchiveKeys,
  joinArchivePages,
  splitArchivePages,
  type PrivateArchiveKeys,
} from "@/lib/private-sync/crypto";
import { resolveArchiveVault } from "./backup-vault";
import { backupMessage, decryptPosition, encryptPosition } from "./crypto";
import {
  configurePositionBook,
  listPositions,
  mergePositions,
  updatePosition,
  type Position,
} from "./book";
import { createAsyncValueCache } from "./unlock-cache";

const unlockedKeys = createAsyncValueCache<string, PrivateArchiveKeys>();

async function archiveVault(): Promise<string> {
  const vault = resolveArchiveVault(
    undefined,
    (await getPrivateConfig()).contracts.sharedVault,
  );
  configurePositionBook(vault);
  return vault;
}

export async function unlockPositionBackup(address: string): Promise<PrivateArchiveKeys> {
  const vault = await archiveVault();
  const cacheKey = `${address}:${NETWORK.id}:${vault}`;
  return unlockedKeys.getOrCreate(cacheKey, async () => {
    const message = backupMessage(address, NETWORK.id, vault);
    const { signedMessage } = await getKit().signMessage(message, { address });
    return derivePrivateArchiveKeys(address, NETWORK.id, vault, signedMessage);
  });
}

export async function preparePositionBackup(address: string): Promise<PrivateArchiveKeys> {
  const keys = await unlockPositionBackup(address);
  await registerPrivateArchive(keys);
  return keys;
}

function assertOwner(position: Position, keys: PrivateArchiveKeys) {
  if (position.address !== keys.address) throw new Error("Private activity key does not match this wallet");
}

async function synchronize(
  address: string,
  keys: PrivateArchiveKeys,
  includeLocal: boolean,
): Promise<Position[]> {
  if (keys.address !== address) throw new Error("Private activity key does not match this wallet");
  await registerPrivateArchive(keys);
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await readPrivateArchive(keys);
    const remote = snapshot.pages.length === 0 ? [] : await joinArchivePages(keys, snapshot.pages);
    if (!includeLocal) return remote;
    mergePositions(address, remote);
    const positions = listPositions(address);
    const pages = await splitArchivePages(keys, positions);
    try {
      await writePrivateArchive(keys, snapshot.generation, pages);
      return positions;
    } catch (error) {
      if (attempt === 2 || !(error instanceof Error && "generation" in error)) throw error;
    }
  }
  throw new Error("Private activity archive could not be synchronized");
}

export async function savePositionBackup(
  position: Position,
  keys: PrivateArchiveKeys,
): Promise<void> {
  assertOwner(position, keys);
  mergePositions(position.address, [position]);
  await synchronize(position.address, keys, true);
  updatePosition(position.address, position.commitment, {
    backupStatus: "synced",
    backupError: undefined,
  });
}

export async function restorePositionBackups(
  address: string,
  keys?: PrivateArchiveKeys,
): Promise<number> {
  const archiveKeys = keys ?? await unlockPositionBackup(address);
  const positions = await synchronize(address, archiveKeys, false);
  return mergePositions(address, positions);
}

export async function exportEncryptedPositionFile(
  address: string,
  keys: PrivateArchiveKeys,
): Promise<string> {
  if (keys.address !== address) throw new Error("Private activity key does not match this wallet");
  const records = await Promise.all(
    listPositions(address).map((position) => encryptPosition(position, keys.encryptionKey)),
  );
  return JSON.stringify({
    format: "moros-private-positions",
    network: NETWORK.id,
    archiveContext: keys.context,
    address,
    exportedAt: new Date().toISOString(),
    records,
  }, null, 2);
}

export async function importEncryptedPositionFile(
  contents: string,
  address: string,
  keys: PrivateArchiveKeys,
): Promise<number> {
  if (keys.address !== address) throw new Error("Private activity key does not match this wallet");
  const parsed = JSON.parse(contents) as {
    format?: unknown;
    network?: unknown;
    archiveContext?: unknown;
    address?: unknown;
    records?: unknown;
  };
  if (parsed.format !== "moros-private-positions"
    || parsed.network !== NETWORK.id
    || parsed.archiveContext !== keys.context
    || parsed.address !== address
    || !Array.isArray(parsed.records)) {
    throw new Error("This recovery file does not match the connected wallet and private vault");
  }
  const positions: Position[] = [];
  for (const record of parsed.records) {
    if (!record || typeof record !== "object") {
      throw new Error("Recovery file contains an invalid record");
    }
    const row = record as Record<string, unknown>;
    if (typeof row.ciphertext !== "string" || typeof row.iv !== "string") {
      throw new Error("Recovery file contains an invalid record");
    }
    positions.push(await decryptPosition(
      row.ciphertext,
      row.iv,
      keys.encryptionKey,
    ));
  }
  return mergePositions(address, positions);
}
