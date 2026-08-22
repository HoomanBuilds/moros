import assert from "node:assert/strict";
import { PaymentOperationJournal } from "../src/journal.mjs";

let now = 100;
const saved = [];
const actionId = "11".repeat(32);
const journal = new PaymentOperationJournal({
  now: () => now++,
  save: async (operations) => saved.push(operations),
});
assert.equal((await journal.create({ actionId, kind: "transfer" })).state, "draft");
await journal.transition(actionId, "proving");
await journal.transition(actionId, "ready");
const submitting = await journal.transition(actionId, "submitting");
assert.equal(submitting.attempts, 1);
assert.equal((await journal.recoverInterrupted())[0].state, "ready");
assert.equal(journal.get(actionId).errorCode, "submission_interrupted");
await journal.transition(actionId, "submitting");
await journal.transition(actionId, "submitted", { transactionHash: "aa".repeat(32) });
await journal.transition(actionId, "confirmed", { ledger: 123 });
assert.equal(journal.get(actionId).state, "confirmed");
assert.equal(journal.get(actionId).attempts, 2);
assert.equal(saved.length > 5, true);

await assert.rejects(journal.create({ actionId, kind: "transfer" }), /already exists/);
await assert.rejects(journal.transition(actionId, "ready"), /invalid payment operation transition/);
await assert.rejects(
  new PaymentOperationJournal().create({ actionId: "00".repeat(32), kind: "transfer" }),
  /invalid payment action id/,
);
assert.throws(
  () => new PaymentOperationJournal({ operations: [{ actionId, kind: "transfer", state: "unknown" }] }),
  /invalid payment operation journal/,
);

const concurrent = new PaymentOperationJournal();
const duplicateId = "22".repeat(32);
const concurrentResults = await Promise.allSettled([
  concurrent.create({ actionId: duplicateId, kind: "transfer" }),
  concurrent.create({ actionId: duplicateId, kind: "transfer" }),
]);
assert.equal(concurrentResults.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(concurrentResults.filter((result) => result.status === "rejected").length, 1);

const rollbackId = "33".repeat(32);
const rollback = new PaymentOperationJournal({
  save: async () => { throw new Error("storage unavailable"); },
});
await assert.rejects(rollback.create({ actionId: rollbackId, kind: "withdraw" }), /storage unavailable/);
assert.equal(rollback.get(rollbackId), null);

process.stdout.write("payment operation journal tests passed\n");
