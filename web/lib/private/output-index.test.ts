import assert from "node:assert/strict";
import {
  waitForPrivateOutput,
} from "./output-index.ts";
import type { PrivateTreeSnapshot } from "./client.ts";

function snapshot(commitments: string[]): PrivateTreeSnapshot {
  return {
    vaultId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    levels: 20,
    nextLeafIndex: commitments.length,
    currentRoot: "1",
    commitments,
    outputs: commitments.map((commitment, leafIndex) => ({
      commitment,
      leafIndex,
      root: "1",
      actionId: "00".repeat(32),
      encryptedOutput: "00",
    })),
    updatedAt: new Date(0).toISOString(),
  };
}

async function main() {
  const reads = [snapshot(["1"]), snapshot(["1", "2"])];
  let waits = 0;
  const found = await waitForPrivateOutput(2n, {
    read: async () => reads.shift() ?? snapshot([]),
    sleep: async () => {
      waits++;
    },
    maximumAttempts: 2,
  });
  assert.equal(found.nextLeafIndex, 2);
  assert.equal(waits, 1);

  await assert.rejects(
    waitForPrivateOutput(3n, {
      read: async () => snapshot(["1", "2"]),
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
