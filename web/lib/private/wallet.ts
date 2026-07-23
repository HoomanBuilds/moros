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
  merkleTree,
  noteDomain,
  noteNullifier,
  spendPublicKey,
  type OwnedPrivateNote,
  type PrivateTree,
} from "./primitives";

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
): Promise<bigint[]> {
  const spentDomains: bigint[] = [];
  for (const domain of nullifierDomains(note.purpose)) {
    const spent = await readPrivateContract<boolean>(
      config.contracts.sharedVault,
      address,
      "is_spent",
      { nullifier: noteNullifier(note, note.spendSecret, domain) },
    );
    if (spent) spentDomains.push(domain);
  }
  return spentDomains;
}

async function filterUnspent(
  config: PrivateDeploymentConfig,
  address: string,
  notes: OwnedIndexedNote[],
): Promise<OwnedIndexedNote[]> {
  const result: OwnedIndexedNote[] = [];
  for (let start = 0; start < notes.length; start += 8) {
    const batch = notes.slice(start, start + 8);
    const spent = await Promise.all(
      batch.map((note) => spentNullifierDomains(config, address, note)),
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
  const tree = merkleTree(
    treeSnapshot.commitments.map(BigInt),
    treeSnapshot.levels,
  );
  if (
    tree.root !== BigInt(treeSnapshot.currentRoot) ||
    tree.count !== treeSnapshot.nextLeafIndex
  ) {
    throw new Error("Private tree failed local verification");
  }
  const domain = await privateNoteDomain(config);
  const ownerSpendPublicKey = spendPublicKey(keys.noteSpendSecret);
  const recovered: OwnedIndexedNote[] = [];
  for (const output of treeSnapshot.outputs) {
    const note = decryptOutputNote(
      envelopeToFields(output.encryptedOutput),
      keys.noteViewingSecret,
      domain,
      BigInt(output.commitment),
      ownerSpendPublicKey,
    );
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
  const notes = await filterUnspent(config, address, recovered);
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
