import assert from "node:assert/strict";
import {
  MAINNET_USDC_ISSUER,
  accountBalances,
} from "./mainnet-preflight.mjs";

assert.deepEqual(
  accountBalances({
    balances: [
      { asset_type: "native", balance: "250.5000000" },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: MAINNET_USDC_ISSUER,
        balance: "2.0000000",
      },
    ],
  }),
  {
    xlm: 250.5,
    usdc: 2,
    hasUsdcTrustline: true,
  },
);
assert.deepEqual(
  accountBalances({
    balances: [{ asset_type: "native", balance: "1.0000000" }],
  }),
  {
    xlm: 1,
    usdc: 0,
    hasUsdcTrustline: false,
  },
);

console.log("mainnet preflight helpers ok");
