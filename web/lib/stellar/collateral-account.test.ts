import assert from "node:assert";
import { NotFoundError } from "@stellar/stellar-sdk";
import {
  collateralStateFromBalances,
  collateralTrustlineErrorMessage,
  isAccountNotFoundError,
  trustlineReserveShortfall,
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
  nativeBalanceAtomic: 45_000_000n,
  trustlineReserveShortfallAtomic: 0n,
});
assert.deepEqual(collateralStateFromBalances(balances, xlm), {
  exists: true,
  hasTrustline: true,
  balanceAtomic: 45_000_000n,
  nativeBalanceAtomic: 45_000_000n,
  trustlineReserveShortfallAtomic: 0n,
});
assert.deepEqual(collateralStateFromBalances([], usdc), {
  exists: true,
  hasTrustline: false,
  balanceAtomic: 0n,
  nativeBalanceAtomic: 0n,
  trustlineReserveShortfallAtomic: 0n,
});
assert.deepEqual(unfundedCollateralAccountState(), {
  exists: false,
  hasTrustline: false,
  balanceAtomic: 0n,
  nativeBalanceAtomic: 0n,
  trustlineReserveShortfallAtomic: 0n,
});
assert.equal(isAccountNotFoundError(new NotFoundError("Not Found", { status: 404 })), true);
assert.equal(isAccountNotFoundError(new Error("Not Found")), false);
assert.equal(trustlineReserveShortfall({
  nativeBalanceAtomic: 10_143_995n,
  subentryCount: 0,
  numSponsoring: 0,
  numSponsored: 0,
  baseReserveAtomic: 5_000_000n,
  feeAtomic: 100n,
}), 4_856_105n);
assert.equal(trustlineReserveShortfall({
  nativeBalanceAtomic: 15_000_100n,
  subentryCount: 0,
  numSponsoring: 0,
  numSponsored: 0,
  baseReserveAtomic: 5_000_000n,
  feeAtomic: 100n,
}), 0n);
assert.equal(trustlineReserveShortfall({
  nativeBalanceAtomic: 20_000_100n,
  subentryCount: 2,
  numSponsoring: 1,
  numSponsored: 2,
  baseReserveAtomic: 5_000_000n,
  feeAtomic: 100n,
}), 0n);
assert.equal(collateralTrustlineErrorMessage({
  response: {
    data: {
      extras: {
        result_codes: {
          transaction: "tx_failed",
          operations: ["op_low_reserve"],
        },
      },
    },
  },
}, "USDC"), "Add more XLM for the Stellar reserve before enabling USDC");
assert.equal(collateralTrustlineErrorMessage(new Error("Request failed"), "USDC"), null);

console.log("collateral accounts ok");
