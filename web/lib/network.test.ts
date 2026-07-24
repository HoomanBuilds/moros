import assert from "node:assert";
import { NETWORK, collateralFromRecord } from "./network.ts";

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

console.log("network collateral ok");
