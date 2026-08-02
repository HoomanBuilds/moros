"use client";

import { unlockPositionBackup } from "@/lib/positions/backup";
import type { PrivateArchiveKeys } from "@/lib/private-sync/crypto";
import {
  getPrivateConfig,
  getPrivateTree,
  type PrivateDeploymentConfig,
  type PrivateTreeSnapshot,
} from "./client";
import { readPrivateContract } from "./contract";
import {
  addressLimbs,
  bytes32Limbs,
  decryptOutputNote,
  envelopeToFields,
  hexToBytes,
  noteDomain,
  noteNullifier,
  spendPublicKey,
  type OwnedPrivateNote,
  type PrivateNote,
  type PrivateTree,
} from "./primitives";
import { verifiedPrivateTree } from "./verified-tree";

export type OwnedIndexedNote = OwnedPrivateNote & {
  leafIndex: number;
  actionId: string;
  createdRoot: bigint;
  spentDomains: bigint[];
};

export type PrivateWalletSnapshot = {
  config: PrivateDeploymentConfig;
  keys: PrivateArchiveKeys;
  treeSnapshot: PrivateTreeSnapshot;
  tree: PrivateTree;
  notes: OwnedIndexedNote[];
  balance: bigint;
};

const knownSpentNullifiers = new Set<string>();
const knownUnspentNullifiers = new Map<string, Set<string>>();
const recoveredOutputCaches = new Map<
  string,
  Map<string, PrivateNote | null>
>();

function recoveredOutputCache(
  keys: PrivateArchiveKeys,
): Map<string, PrivateNote | null> {
  const key = `${keys.context}:${keys.bucketId}`;
  const existing = recoveredOutputCaches.get(key);
  if (existing) {
    recoveredOutputCaches.delete(key);
    recoveredOutputCaches.set(key, existing);
    return existing;
  }
  const created = new Map<string, PrivateNote | null>();
  recoveredOutputCaches.set(key, created);
  while (recoveredOutputCaches.size > 4) {
    const oldest = recoveredOutputCaches.keys().next().value;
    if (typeof oldest !== "string") break;
    recoveredOutputCaches.delete(oldest);
  }
  return created;
}

async function privateNoteDomain(
  config: PrivateDeploymentConfig,
): Promise<bigint> {
  const fields = [
    1n,
    ...bytes32Limbs(hexToBytes(config.networkDomain)),
    ...await addressLimbs(config.contracts.sharedVault),
    ...await addressLimbs(config.collateral.contract),
    ...bytes32Limbs(hexToBytes(config.verifierDomain)),
  ];
  return noteDomain(fields);
}

function nullifierDomains(purpose: bigint): bigint[] {
  if ([0n, 1n, 6n, 7n].includes(purpose)) return [1n];
  if (purpose === 3n) return [2n];
  if (purpose === 2n) return [3n, 4n];
  if (purpose === 4n || purpose === 9n) return [5n];
  return [];
}

async function spentNullifierDomains(
  config: PrivateDeploymentConfig,
  address: string,
  note: OwnedIndexedNote,
  currentRoot: string,
): Promise<bigint[]> {
  let unspentAtRoot = knownUnspentNullifiers.get(currentRoot);
  if (!unspentAtRoot) {
    unspentAtRoot = new Set();
    knownUnspentNullifiers.set(currentRoot, unspentAtRoot);
    while (knownUnspentNullifiers.size > 2) {
      const oldest = knownUnspentNullifiers.keys().next().value;
      if (typeof oldest !== "string") break;
      knownUnspentNullifiers.delete(oldest);
    }
  }
  const checks = nullifierDomains(note.purpose).map(async (domain) => {
    const nullifier = noteNullifier(note, note.spendSecret, domain);
    const key = `${config.contracts.sharedVault}:${nullifier}`;
    if (knownSpentNullifiers.has(key)) return domain;
    if (unspentAtRoot.has(key)) return null;
    const spent = await readPrivateContract<boolean>(
      config.contracts.sharedVault,
      address,
      "is_spent",
      { nullifier },
      { priority: "interactive" },
    );
    if (!spent) {
      unspentAtRoot.add(key);
      return null;
    }
    knownSpentNullifiers.add(key);
    unspentAtRoot.delete(key);
    return domain;
  });
  return (await Promise.all(checks)).filter(
    (domain): domain is bigint => domain !== null,
  );
}

async function filterUnspent(
  config: PrivateDeploymentConfig,
  address: string,
  notes: OwnedIndexedNote[],
  currentRoot: string,
): Promise<OwnedIndexedNote[]> {
  const result: OwnedIndexedNote[] = [];
  for (let start = 0; start < notes.length; start += 8) {
    const batch = notes.slice(start, start + 8);
    const spent = await Promise.all(
      batch.map((note) =>
        spentNullifierDomains(config, address, note, currentRoot)
      ),
    );
    batch.forEach((note, index) => {
      const domains = nullifierDomains(note.purpose);
      if (
        domains.length === 0 ||
        spent[index].length < domains.length
      ) {
        result.push({ ...note, spentDomains: spent[index] });
      }
    });
  }
  return result;
}

export async function openPrivateWallet(
  address: string,
): Promise<PrivateWalletSnapshot> {
  const [config, keys, treeSnapshot] = await Promise.all([
    getPrivateConfig(),
    unlockPositionBackup(address),
    getPrivateTree(),
  ]);
  if (
    treeSnapshot.vaultId !== config.contracts.sharedVault ||
    treeSnapshot.levels !== config.privacy.treeLevels
  ) {
    throw new Error("Private tree does not match the configured vault");
  }
  const tree = verifiedPrivateTree(config, treeSnapshot);
  const domain = await privateNoteDomain(config);
  const ownerSpendPublicKey = spendPublicKey(keys.noteSpendSecret);
  const recoveryCache = recoveredOutputCache(keys);
  const recovered: OwnedIndexedNote[] = [];
  for (const output of treeSnapshot.outputs) {
    let note = recoveryCache.get(output.commitment);
    if (note === undefined && !recoveryCache.has(output.commitment)) {
      note = decryptOutputNote(
        envelopeToFields(output.encryptedOutput),
        keys.noteViewingSecret,
        domain,
        BigInt(output.commitment),
        ownerSpendPublicKey,
      );
      recoveryCache.set(output.commitment, note);
    }
    if (!note) continue;
    recovered.push({
      ...note,
      spendSecret: keys.noteSpendSecret,
      viewingSecret: keys.noteViewingSecret,
      leafIndex: output.leafIndex,
      actionId: output.actionId,
      createdRoot: BigInt(output.root),
      spentDomains: [],
    });
  }
  const notes = await filterUnspent(
    config,
    address,
    recovered,
    treeSnapshot.currentRoot,
  );
  return {
    config,
    keys,
    treeSnapshot,
    tree,
    notes,
    balance: notes
      .filter((note) => [1n, 6n, 7n].includes(note.purpose))
      .reduce((total, note) => total + note.amount, 0n),
  };
}
