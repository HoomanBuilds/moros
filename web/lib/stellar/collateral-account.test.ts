import assert from "node:assert";
import { NotFoundError } from "@stellar/stellar-sdk";
import {
  collateralStateFromBalances,
  isAccountNotFoundError,
  unfundedCollateralAccountState,
} from "./collateral-account.ts";

const usdc = {
  code: "USDC",
  issuer: "GISSUER",
  sac: "CSAC",
  decimals: 7,
  native: false,
};
const xlm = {
  code: "XLM",
  issuer: null,
  sac: "CNATIVE",
  decimals: 7,
  native: true,
};
const balances = [
  { asset_type: "native", balance: "4.5000000" },
  { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "GISSUER", balance: "12.3400000" },
];

assert.deepEqual(collateralStateFromBalances(balances, usdc), {
  exists: true,
  hasTrustline: true,
  balanceAtomic: 123_400_000n,
});
assert.deepEqual(collateralStateFromBalances(balances, xlm), {
  exists: true,
  hasTrustline: true,
  balanceAtomic: 45_000_000n,
});
assert.deepEqual(collateralStateFromBalances([], usdc), {
  exists: true,
  hasTrustline: false,
  balanceAtomic: 0n,
});
assert.deepEqual(unfundedCollateralAccountState(), {
  exists: false,
  hasTrustline: false,
  balanceAtomic: 0n,
});
assert.equal(isAccountNotFoundError(new NotFoundError("Not Found", { status: 404 })), true);
assert.equal(isAccountNotFoundError(new Error("Not Found")), false);

console.log("collateral accounts ok");
