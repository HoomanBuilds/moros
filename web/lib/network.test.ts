import assert from "node:assert";
import {
  NETWORK,
  collateralFromRecord,
  networkConfig,
} from "./network.ts";

assert.equal(NETWORK.collateral.code, "USDC");
assert.equal(NETWORK.collateral.decimals, 7);
assert.equal(NETWORK.collateral.native, false);
assert.equal(NETWORK.collateral.sac.length, 56);
assert.equal(NETWORK.collateral.issuer?.length, 56);
if (NETWORK.id === "testnet") {
  assert.equal(
    NETWORK.collateral.sac,
    "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  );
  assert.equal(
    NETWORK.collateral.issuer,
    "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  );
}
assert.equal(collateralFromRecord(), null);
assert.equal(collateralFromRecord({
  collateralCode: "USDC",
  collateralIssuer: NETWORK.collateral.issuer,
  collateralSac: NETWORK.collateral.sac,
  collateralDecimals: 7,
}), NETWORK.collateral);
assert.equal(collateralFromRecord({ collateralCode: "FAKE", collateralSac: "CFAKE" }), null);
const mainnet = networkConfig({
  NEXT_PUBLIC_STELLAR_NETWORK: "mainnet",
  NEXT_PUBLIC_MAINNET_STELLAR_RPC_URL: "https://rpc.example",
  NEXT_PUBLIC_MAINNET_STELLAR_HORIZON_URL: "https://horizon.example",
  NEXT_PUBLIC_MAINNET_PRIVATE_SERVICE_URL: "https://private.example",
  NEXT_PUBLIC_STELLAR_RPC_URL: "https://legacy.example",
});
assert.equal(mainnet.id, "mainnet");
assert.equal(mainnet.rpcUrl, "https://rpc.example");
assert.equal(mainnet.horizonUrl, "https://horizon.example");
assert.equal(mainnet.privateServiceUrl, "https://private.example");
assert.equal(
  mainnet.collateral.sac,
  "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
);
assert.throws(
  () => networkConfig({ NEXT_PUBLIC_STELLAR_NETWORK: "local" }),
  /must be testnet or mainnet/,
);
const mainnetWithoutScopedValues = networkConfig({
  NEXT_PUBLIC_STELLAR_NETWORK: "mainnet",
  NEXT_PUBLIC_STELLAR_RPC_URL: "https://testnet-rpc.example",
  NEXT_PUBLIC_PRIVATE_SERVICE_URL: "https://testnet-private.example",
});
assert.equal(
  mainnetWithoutScopedValues.rpcUrl,
  "https://mainnet.sorobanrpc.com",
);
assert.equal(mainnetWithoutScopedValues.privateServiceUrl, "");

console.log("network collateral ok");
