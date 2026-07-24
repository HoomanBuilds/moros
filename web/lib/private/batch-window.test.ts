import assert from "node:assert/strict";
import { waitForPrivateBatch, type PrivateBatchWindow } from "./batch-window.ts";

const registration = {
  finalized: false,
  current_epoch: 2n,
  maximum_batch_size: 8,
};
const closed: PrivateBatchWindow = {
  registration,
  epoch: {
    epoch: 2n,
    phase: "Sealed",
    accepted_count: 0,
    cutoff: 100n,
  },
};
const collecting: PrivateBatchWindow = {
  registration: { ...registration, current_epoch: 3n },
  epoch: {
    epoch: 3n,
    phase: ["Collecting"],
    accepted_count: 0,
    cutoff: 200n,
  },
};
const nearCutoff: PrivateBatchWindow = {
  registration: { ...registration, current_epoch: 3n },
  epoch: {
    epoch: 3n,
    phase: ["Collecting"],
    accepted_count: 0,
    cutoff: 175n,
  },
};

async function main() {
  const snapshots = [closed, nearCutoff, collecting];
  let waits = 0;
  const opened = await waitForPrivateBatch({
    read: async () => snapshots.shift() ?? collecting,
    onWait: () => {
      waits += 1;
    },
    sleep: async () => {},
    nowSeconds: () => 150n,
    maximumAttempts: 3,
  });
  assert.equal(opened.epoch.epoch, 3n);
  assert.equal(waits, 2);

  await assert.rejects(
    waitForPrivateBatch({
      read: async () => ({
        registration: { ...registration, finalized: true },
      }),
      sleep: async () => {},
      maximumAttempts: 1,
    }),
    /not accepting orders/,
  );

  await assert.rejects(
    waitForPrivateBatch({
      read: async () => closed,
      sleep: async () => {},
      maximumAttempts: 2,
    }),
    /did not open in time/,
  );

  console.log("private batch window ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
