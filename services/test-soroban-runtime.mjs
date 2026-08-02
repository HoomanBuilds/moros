import assert from "node:assert/strict";
import { waitForSubmittedTransaction } from "./soroban-runtime.mjs";

const statuses = ["NOT_FOUND", "SUCCESS"];
const delays = [];
const confirmed = await waitForSubmittedTransaction({
  server: {
    getTransaction: async () => ({ status: statuses.shift() }),
  },
  hash: "abc",
  pollIntervalMs: 250,
  maximumWaitMs: 500,
  sleep: async (milliseconds) => delays.push(milliseconds),
});
assert.equal(confirmed.hash, "abc");
assert.deepEqual(delays, [250]);

await assert.rejects(
  waitForSubmittedTransaction({
    server: { getTransaction: async () => ({ status: "FAILED" }) },
    hash: "def",
    pollIntervalMs: 250,
    maximumWaitMs: 500,
    sleep: async () => {},
  }),
  /transaction def failed/u,
);

await assert.rejects(
  waitForSubmittedTransaction({
    server: { getTransaction: async () => ({ status: "NOT_FOUND" }) },
    hash: "ghi",
    pollIntervalMs: 250,
    maximumWaitMs: 500,
    sleep: async () => {},
  }),
  /transaction ghi timed out/u,
);

console.log("soroban confirmation polling ok");
