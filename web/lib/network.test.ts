import assert from "node:assert";
import { NETWORK, collateralFromRecord } from "./network.ts";

assert.equal(NETWORK.collateral.code, "USDC");
assert.equal(NETWORK.collateral.decimals, 7);
assert.equal(NETWORK.collateral.native, false);
assert.equal(NETWORK.collateral.sac.length, 56);
assert.equal(NETWORK.collateral.issuer?.length, 56);
assert.equal(collateralFromRecord().code, "XLM");
assert.equal(collateralFromRecord({
  collateralCode: "USDC",
  collateralIssuer: NETWORK.collateral.issuer,
  collateralSac: NETWORK.collateral.sac,
  collateralDecimals: 7,
}), NETWORK.collateral);
assert.equal(collateralFromRecord({ collateralCode: "FAKE", collateralSac: "CFAKE" }).code, "XLM");

console.log("network collateral ok");
