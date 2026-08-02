import assert from "node:assert/strict";
import { readOrderedRecords } from "./order-records";

async function main() {
  let secondStarted = false;
  const records = await readOrderedRecords({
    firstSequence: 1n,
    lastSequence: 2n,
    maximumRecords: 8,
    unavailableMessage: "records unavailable",
    read: async (sequence) => {
      if (sequence === 1n) {
        await new Promise<void>((resolve) => {
          setImmediate(() => {
            assert.equal(secondStarted, true);
            resolve();
          });
        });
      } else {
        secondStarted = true;
      }
      return { sequence };
    },
  });
  assert.deepEqual(records, [{ sequence: 1n }, { sequence: 2n }]);

  await assert.rejects(
    readOrderedRecords({
      firstSequence: 1n,
      lastSequence: 2n,
      maximumRecords: 8,
      unavailableMessage: "records unavailable",
      read: async (sequence) => sequence === 2n
        ? undefined
        : { sequence },
    }),
    /records unavailable/u,
  );
  await assert.rejects(
    readOrderedRecords({
      firstSequence: 1n,
      lastSequence: 2n,
      maximumRecords: 8,
      unavailableMessage: "records unavailable",
      read: async (sequence) => ({ sequence: sequence + 1n }),
    }),
    /records unavailable/u,
  );
  await assert.rejects(
    readOrderedRecords({
      firstSequence: 1n,
      lastSequence: 9n,
      maximumRecords: 8,
      unavailableMessage: "records unavailable",
      read: async (sequence) => ({ sequence }),
    }),
    /batch limit/u,
  );

  console.log("private order record reads ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
