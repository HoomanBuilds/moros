import assert from "node:assert/strict";
import { Networks } from "@stellar/stellar-sdk";
import {
  assertDeploymentNetwork,
  assertRpcNetwork,
  networkConfig,
} from "./network-config.mjs";

const testnet = networkConfig({});
assert.equal(testnet.id, "testnet");
assert.equal(testnet.passphrase, Networks.TESTNET);
assert.equal(testnet.rpcUrl, "https://soroban-testnet.stellar.org");
assert.equal(testnet.deploymentPath, "deployments/private-testnet.json");
assert.equal(testnet.artifactPath, "circuits/private-build/public");
assert.equal(testnet.mainnetReady, false);

const mainnet = networkConfig({
  MOROS_NETWORK: "mainnet",
  MOROS_MAINNET_RPC_URL: "https://rpc.example",
  MOROS_MAINNET_HORIZON_URL: "https://horizon.example",
  MOROS_MAINNET_DEPLOYMENT: "deployments/custom-mainnet.json",
  MOROS_MAINNET_ZK_PUBLIC_DIR: "circuits/custom-mainnet/public",
  MOROS_MAINNET_FUNDER_SK: "mainnet-funder",
  MOROS_MAINNET_PRIVACY_SK: "mainnet-privacy",
  RPC_URL: "https://legacy.example",
});
assert.equal(mainnet.id, "mainnet");
assert.equal(mainnet.passphrase, Networks.PUBLIC);
assert.equal(mainnet.rpcUrl, "https://rpc.example");
assert.equal(mainnet.horizonUrl, "https://horizon.example");
assert.equal(mainnet.deploymentPath, "deployments/custom-mainnet.json");
assert.equal(mainnet.artifactPath, "circuits/custom-mainnet/public");
assert.equal(mainnet.funderSecret, "mainnet-funder");
assert.equal(mainnet.privacySecret, "mainnet-privacy");
assert.equal(mainnet.mainnetReady, true);

assert.throws(
  () => networkConfig({ MOROS_NETWORK: "local" }),
  /must be testnet or mainnet/,
);
assert.throws(
  () => networkConfig({
    MOROS_NETWORK: "mainnet",
    NETWORK_PASSPHRASE: Networks.TESTNET,
  }),
  /passphrase/,
);
assert.equal(
  assertDeploymentNetwork(
    { network: "mainnet", mainnetReady: true },
    mainnet,
  ).network,
  "mainnet",
);
assert.throws(
  () => assertDeploymentNetwork(
    { network: "testnet", mainnetReady: false },
    mainnet,
  ),
  /not ready/,
);
await assertRpcNetwork({
  getNetwork: async () => ({ passphrase: Networks.PUBLIC }),
}, mainnet);
await assert.rejects(
  assertRpcNetwork({
    getNetwork: async () => ({ passphrase: Networks.TESTNET }),
  }, mainnet),
  /not connected/,
);

console.log("network config ok");
