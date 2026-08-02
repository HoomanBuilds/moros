import type {
  PrivateDeploymentConfig,
  PrivateTreeSnapshot,
} from "./client";
import { merkleTree, type PrivateTree } from "./primitives";

const verifiedTrees = new WeakMap<PrivateTreeSnapshot, PrivateTree>();

export function verifiedPrivateTree(
  config: PrivateDeploymentConfig,
  snapshot: PrivateTreeSnapshot,
): PrivateTree {
  if (
    snapshot.vaultId !== config.contracts.sharedVault ||
    snapshot.levels !== config.privacy.treeLevels
  ) {
    throw new Error("Private tree does not match the configured vault");
  }
  const cached = verifiedTrees.get(snapshot);
  if (cached) return cached;
  const tree = merkleTree(snapshot.commitments.map(BigInt), snapshot.levels);
  if (
    tree.root !== BigInt(snapshot.currentRoot) ||
    tree.count !== snapshot.nextLeafIndex
  ) {
    throw new Error("Private tree failed local verification");
  }
  verifiedTrees.set(snapshot, tree);
  return tree;
}
