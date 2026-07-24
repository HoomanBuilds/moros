import assert from "node:assert/strict";
import { Networks } from "@stellar/stellar-sdk";
import {
  assertDeploymentNetwork,
  assertRpcNetwork,
  networkConfig,
  selectRpcUrl,
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
  MOROS_MAINNET_RPC_FALLBACK_URL: "https://fallback.example",
  MOROS_MAINNET_HORIZON_URL: "https://horizon.example",
  MOROS_MAINNET_DEPLOYMENT: "deployments/custom-mainnet.json",
  MOROS_MAINNET_ZK_PUBLIC_DIR: "circuits/custom-mainnet/public",
  MOROS_MAINNET_DEPLOYER_SK: "mainnet-deployer",
  MOROS_MAINNET_FUNDER_SK: "mainnet-funder",
  MOROS_MAINNET_ROUNDING_FUNDER_SK: "mainnet-rounding",
  MOROS_MAINNET_PRIVACY_SK: "mainnet-privacy",
  RPC_URL: "https://legacy.example",
  DEPLOYER_SK: "legacy-deployer",
  FUNDER_SK: "legacy-funder",
});
assert.equal(mainnet.id, "mainnet");
assert.equal(mainnet.passphrase, Networks.PUBLIC);
assert.equal(mainnet.rpcUrl, "https://rpc.example");
assert.deepEqual(mainnet.rpcUrls, [
  "https://rpc.example",
  "https://fallback.example",
  "https://mainnet.sorobanrpc.com",
]);
assert.equal(mainnet.horizonUrl, "https://horizon.example");
assert.equal(mainnet.deploymentPath, "deployments/custom-mainnet.json");
assert.equal(mainnet.artifactPath, "circuits/custom-mainnet/public");
assert.equal(mainnet.deployerSecret, "mainnet-deployer");
assert.equal(mainnet.funderSecret, "mainnet-funder");
assert.equal(mainnet.roundingFunderSecret, "mainnet-rounding");
assert.equal(mainnet.privacySecret, "mainnet-privacy");
assert.equal(mainnet.mainnetReady, true);
assert.equal(
  networkConfig({
    MOROS_NETWORK: "mainnet",
    RPC_URL: "https://legacy.example",
    DEPLOYER_SK: "legacy-deployer",
    FUNDER_SK: "legacy-funder",
  }).rpcUrl,
  "https://mainnet.sorobanrpc.com",
);
assert.equal(
  networkConfig({
    MOROS_NETWORK: "mainnet",
    DEPLOYER_SK: "legacy-deployer",
  }).deployerSecret,
  "",
);

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
assert.equal(
  await selectRpcUrl(
    {
      ...mainnet,
      rpcUrls: ["https://primary.example", "https://fallback.example"],
    },
    (url) => ({
      getNetwork: async () => {
        if (url.includes("primary")) throw new Error("unavailable");
        return { passphrase: Networks.PUBLIC };
      },
    }),
  ),
  "https://fallback.example",
);
await assert.rejects(
  selectRpcUrl(
    {
      ...mainnet,
      rpcUrls: ["https://bad.example"],
    },
    () => ({
      getNetwork: async () => {
        throw new Error("unavailable");
      },
    }),
  ),
  /no healthy mainnet RPC/,
);

console.log("network config ok");
