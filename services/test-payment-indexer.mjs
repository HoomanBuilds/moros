import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FilePaymentIndexStore,
  MemoryPaymentIndexStore,
  PaymentEventIndexer,
  auditPaymentIndex,
} from "./payment-indexer.mjs";

const network = "stellar:pubnet";
const vault = "CA_PAYMENT_VAULT";
const actionId = "11".repeat(32);

function baseEvent(eventIndex, topic) {
  return {
    cursor: `cursor-${eventIndex}`,
    ledger: 101,
    txIndex: 0,
    eventIndex,
    txHash: "22".repeat(32),
    contractId: vault,
    topic,
    actionId,
  };
}

function outputEvent(index) {
  return {
    ...baseEvent(index, "payment_output"),
    outputIndex: index,
    leafIndex: index,
    commitment: String(100 + index),
    encryptedOutput: Buffer.alloc(480, index + 1),
  };
}

const attachmentEvent = {
  ...baseEvent(4, "payment_attachment"),
  attachmentHash: "200",
  encryptedAttachment: Buffer.alloc(128, 8),
};
const actionEvent = {
  ...baseEvent(5, "payment_action"),
  action: 1,
  firstLeafIndex: 0,
  outputCount: 4,
  newRoot: "300",
  publicAmount: "0",
};

function pagedSource(events = [outputEvent(0), outputEvent(1), outputEvent(2), outputEvent(3), attachmentEvent, actionEvent]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async getEvents({ cursor }) {
      calls++;
      if (!cursor) {
        return {
          events: events.slice(0, 3),
          hasMore: events.length > 3,
          nextCursor: events.length > 3 ? "page-two" : null,
          latestLedger: 105,
        };
      }
      return {
        events: events.slice(3),
        hasMore: false,
        nextCursor: null,
        latestLedger: 105,
      };
    },
  };
}

const store = new MemoryPaymentIndexStore();
const source = pagedSource();
const indexer = new PaymentEventIndexer({
  source,
  store,
  network,
  vault,
  startLedger: 100,
  pageSize: 3,
});
const [summaryOne, summaryTwo] = await Promise.all([indexer.sync(), indexer.sync()]);
assert.deepEqual(summaryOne, summaryTwo);
assert.equal(source.calls, 2);
assert.equal(summaryOne.latestScannedLedger, 105);
assert.equal(summaryOne.nextLeafIndex, 4);
assert.equal(summaryOne.currentRoot, "300");
assert.equal(summaryOne.actions, 1);

const firstPage = indexer.outputs({ limit: 2 });
assert.equal(firstPage.outputs.length, 2);
assert.equal(firstPage.nextLeafIndex, 2);
assert.equal(firstPage.hasMore, true);
const finalPage = indexer.outputs({ fromLeafIndex: 2, limit: 2 });
assert.equal(finalPage.outputs.length, 2);
assert.equal(finalPage.hasMore, false);
assert.equal(indexer.attachment(actionId).attachmentHash, "200");
assert.equal(indexer.action(actionId).outputCount, 4);
assert.equal("paymentCode" in firstPage, false);

const restartedSource = {
  async getEvents({ startLedger, cursor }) {
    assert.equal(startLedger, 106);
    assert.equal(cursor, null);
    return { events: [], hasMore: false, nextCursor: null, latestLedger: 106 };
  },
};
const restarted = new PaymentEventIndexer({
  source: restartedSource,
  store,
  network,
  vault,
  startLedger: 100,
});
assert.equal((await restarted.sync()).latestScannedLedger, 106);
assert.equal(restarted.outputs().outputs.length, 4);

const duplicateState = new MemoryPaymentIndexStore();
const duplicateIndexer = new PaymentEventIndexer({
  source: pagedSource([]),
  store: duplicateState,
  network,
  vault,
  startLedger: 100,
});
duplicateIndexer.applyEvent(outputEvent(0));
duplicateIndexer.applyEvent(outputEvent(0));
assert.equal(duplicateIndexer.outputs().outputs.length, 1);
assert.throws(
  () => duplicateIndexer.applyEvent({ ...outputEvent(0), commitment: "999" }),
  /conflicting duplicate payment event/,
);

async function rejectsEvents(events, message) {
  const invalid = new PaymentEventIndexer({
    source: pagedSource(events),
    store: new MemoryPaymentIndexStore(),
    network,
    vault,
    startLedger: 100,
    pageSize: Math.max(3, events.length),
  });
  await assert.rejects(invalid.sync(), message);
}

await rejectsEvents([{ ...outputEvent(0), contractId: "CA_WRONG" }], /wrong vault/);
await rejectsEvents([{ ...outputEvent(0), leafIndex: 1 }], /leaf gap/);
await rejectsEvents([
  outputEvent(0),
  outputEvent(1),
  outputEvent(2),
  outputEvent(3),
  actionEvent,
], /incomplete payment action events/);
await rejectsEvents([outputEvent(1), outputEvent(0)], /payment output leaf gap/);
await rejectsEvents([{ ...outputEvent(0), encryptedOutput: Buffer.alloc(479) }], /payment envelope/);

const failedIndexer = new PaymentEventIndexer({
  source: pagedSource([{ ...outputEvent(0), leafIndex: 1 }]),
  store: new MemoryPaymentIndexStore(),
  network,
  vault,
  startLedger: 100,
});
await assert.rejects(failedIndexer.sync(), /leaf gap/);
assert.match(failedIndexer.summary().error, /leaf gap/);

const auditLeft = new PaymentEventIndexer({
  source: pagedSource(),
  store: new MemoryPaymentIndexStore(),
  network,
  vault,
  startLedger: 100,
  pageSize: 3,
});
const auditRight = new PaymentEventIndexer({
  source: pagedSource(),
  store: new MemoryPaymentIndexStore(),
  network,
  vault,
  startLedger: 100,
  pageSize: 3,
});
assert.equal((await auditPaymentIndex({ primary: auditLeft, independent: auditRight })).length, 64);

const temporary = mkdtempSync(join(tmpdir(), "moros-payment-index-"));
try {
  const fileStore = new FilePaymentIndexStore(join(temporary, "state.json"));
  const fileIndexer = new PaymentEventIndexer({
    source: pagedSource(),
    store: fileStore,
    network,
    vault,
    startLedger: 100,
    pageSize: 3,
  });
  await fileIndexer.sync();
  const fileRestart = new PaymentEventIndexer({
    source: restartedSource,
    store: fileStore,
    network,
    vault,
    startLedger: 100,
  });
  assert.equal(fileRestart.outputs().outputs.length, 4);
} finally {
  rmSync(temporary, { recursive: true });
}

process.stdout.write("payment indexer tests passed\n");
