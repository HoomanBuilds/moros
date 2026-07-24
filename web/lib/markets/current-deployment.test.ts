import assert from "node:assert/strict";
import { StrKey } from "@stellar/stellar-sdk";
import { isCurrentDeploymentMarket } from "./current-deployment";

const contract = (byte: number) =>
  StrKey.encodeContract(Buffer.alloc(32, byte));
const deployment = {
  factory: contract(1),
  sharedVault: contract(2),
};
const current = {
  poolId: deployment.sharedVault,
  proposalId: "a".repeat(64),
  factoryId: deployment.factory,
  liquidityVaultId: contract(3),
  marketState: "active",
};

assert.equal(isCurrentDeploymentMarket(current, deployment), true);
assert.equal(isCurrentDeploymentMarket({ ...current, marketState: "funding" }, deployment), false);
assert.equal(isCurrentDeploymentMarket({ ...current, factoryId: contract(4) }, deployment), false);
assert.equal(isCurrentDeploymentMarket({ ...current, poolId: contract(5) }, deployment), false);
assert.equal(isCurrentDeploymentMarket({ ...current, proposalId: undefined }, deployment), false);
assert.equal(isCurrentDeploymentMarket({ ...current, liquidityVaultId: undefined }, deployment), false);

process.stdout.write("current deployment market filter ok\n");
