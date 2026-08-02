import assert from "node:assert/strict";
import {
  waitForPrivateOutput,
} from "./output-index.ts";
import type { PrivateOutputStatus } from "./client.ts";

function status(indexed: boolean): PrivateOutputStatus {
  return {
    indexed,
    nextLeafIndex: indexed ? 2 : 1,
    currentRoot: "1",
  };
}

async function main() {
  const reads = [status(false), status(true)];
  let waits = 0;
  const found = await waitForPrivateOutput(2n, {
    read: async () => reads.shift() ?? status(false),
    sleep: async () => {
      waits++;
    },
    maximumAttempts: 2,
  });
  assert.equal(found.indexed, true);
  assert.equal(waits, 1);

  await assert.rejects(
    waitForPrivateOutput(3n, {
      read: async () => status(false),
      sleep: async () => {},
      maximumAttempts: 2,
    }),
    /not indexed yet/u,
  );
  await assert.rejects(waitForPrivateOutput(0n), /commitment is invalid/u);
  await assert.rejects(
    waitForPrivateOutput(1n, { maximumAttempts: 0 }),
    /attempts must be positive/u,
  );

  console.log("private output indexing wait ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
