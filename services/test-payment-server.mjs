import assert from "node:assert/strict";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { StellarPaymentEventSource, normalizePaymentRpcEvent } from "./payment-server.mjs";

const vault = "CCC5ZSQ46ACU2R2HY7IBDUY6TJNNYLUCRNOU3CV75ZNRQT2JBJ2KRRP5";
const actionId = Buffer.alloc(32, 7);
const ledger = 100;
const transactionIndex = 2;

function event(topic, value, eventIndex = 0) {
  return {
    contractId: vault,
    topic: [nativeToScVal(topic, { type: "symbol" }), nativeToScVal(actionId, { type: "bytes" })],
    value: nativeToScVal(value),
    id: `${BigInt(ledger) * (1n << 32n) + (BigInt(transactionIndex) << 12n)}-${eventIndex}`,
    pagingToken: `cursor-${eventIndex}`,
    ledger,
    transactionIndex,
    operationIndex: 0,
    txHash: "11".repeat(32),
  };
}

const output = normalizePaymentRpcEvent(event(
  "payment_output",
  [0, 3, 44n, Buffer.alloc(480, 9)],
), vault);
assert.equal(output.outputIndex, 0);
assert.equal(output.leafIndex, 3);
assert.equal(output.commitment, "44");
assert.equal(output.encryptedOutput, "09".repeat(480));
assert.equal(output.txIndex, transactionIndex);

const mainnetOutput = normalizePaymentRpcEvent({
  ...event("payment_output", [0, 0, 44n, Buffer.alloc(480, 9)], 1),
  id: "0275321869125038080-0000000001",
  ledger: 64_103_368,
  transactionIndex: 387,
}, vault);
assert.equal(mainnetOutput.txIndex, 387);
assert.equal(mainnetOutput.eventIndex, 1);

const attachment = normalizePaymentRpcEvent(event(
  "payment_attachment",
  [55n, Buffer.alloc(128, 10)],
  1,
), vault);
assert.equal(attachment.attachmentHash, "55");
assert.equal(attachment.encryptedAttachment, "0a".repeat(128));

const action = normalizePaymentRpcEvent(event(
  "payment_action",
  [["Transfer"], 3, 4, 66n, 0n],
  2,
), vault);
assert.equal(action.action, 1);
assert.equal(action.firstLeafIndex, 3);
assert.equal(action.outputCount, 4);
assert.equal(action.newRoot, "66");

const requests = [];
const source = new StellarPaymentEventSource({
  vault,
  server: {
    getLatestLedger: async () => ({ sequence: 123 }),
    getEvents: async (request) => {
      requests.push(request);
      return { events: [event("payment_output", [0, 3, 44n, Buffer.alloc(480, 9)])] };
    },
  },
});
const first = await source.getEvents({ startLedger: 90, cursor: null, limit: 50 });
assert.equal(first.latestLedger, 123);
assert.equal(first.events.length, 1);
assert.equal(requests[0].startLedger, 90);
assert.equal(first.nextCursor, "cursor-0");

await source.getEvents({ startLedger: 90, cursor: "cursor-0", limit: 50 });
assert.equal(requests[1].cursor, "cursor-0");
assert.equal("startLedger" in requests[1], false);

console.log("payment server tests passed");
