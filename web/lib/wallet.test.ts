import assert from "node:assert";
import {
  configureWalletKitAdapter,
  getKit,
  truncate,
} from "./wallet";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";

assert.equal(truncate("GABCDEFGHIJKLMNOP1234567890"), "GABCDE...567890");
assert.equal(truncate(""), "");
const adapter = {} as typeof StellarWalletsKit;
configureWalletKitAdapter(adapter);
assert.equal(getKit(), adapter);
console.log("wallet ok");
