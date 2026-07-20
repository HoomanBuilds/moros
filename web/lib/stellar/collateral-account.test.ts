import assert from "node:assert";
import { collateralStateFromBalances } from "./collateral-account.ts";

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

assert.deepEqual(collateralStateFromBalances(balances, usdc), { hasTrustline: true, balanceAtomic: 123_400_000n });
assert.deepEqual(collateralStateFromBalances(balances, xlm), { hasTrustline: true, balanceAtomic: 45_000_000n });
assert.deepEqual(collateralStateFromBalances([], usdc), { hasTrustline: false, balanceAtomic: 0n });

console.log("collateral accounts ok");
