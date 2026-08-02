import assert from "node:assert/strict";
import type {
  PrivateDeploymentConfig,
  PrivateTreeSnapshot,
} from "./client.ts";
import { merkleTree } from "./primitives.ts";
import { verifiedPrivateTree } from "./verified-tree.ts";

const vaultId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const commitments = [11n, 12n];
const root = merkleTree(commitments, 3).root.toString();
const config = {
  contracts: { sharedVault: vaultId },
  privacy: { treeLevels: 3 },
} as PrivateDeploymentConfig;
const snapshot = {
  vaultId,
  levels: 3,
  nextLeafIndex: 2,
  currentRoot: root,
  commitments: commitments.map(String),
  outputs: [],
  updatedAt: new Date(0).toISOString(),
} as PrivateTreeSnapshot;

const first = verifiedPrivateTree(config, snapshot);
assert.equal(verifiedPrivateTree(config, snapshot), first);
assert.throws(
  () => verifiedPrivateTree(config, { ...snapshot, commitments: ["11", "13"] }),
  /failed local verification/u,
);

console.log("private verified tree cache ok");
