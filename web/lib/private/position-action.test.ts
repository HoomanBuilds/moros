import assert from "node:assert/strict";
import { privatePositionContractMethod } from "./position-action.ts";

assert.equal(
  privatePositionContractMethod("recover-change", false),
  "recover_execution_change",
);
assert.equal(privatePositionContractMethod("claim", false), "claim_position");
assert.equal(privatePositionContractMethod("refund", true), "refund_order");
assert.equal(privatePositionContractMethod("refund", false), "claim_position");

console.log("private position action tests passed");
