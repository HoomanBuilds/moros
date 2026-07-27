import assert from "node:assert/strict";
import {
  RpcReadScheduler,
  isRpcRateLimitError,
} from "./rpc-read.ts";

async function main() {
  assert.equal(isRpcRateLimitError({ response: { status: 429 } }), true);
  assert.equal(isRpcRateLimitError(new Error("rate limit exceeded")), true);
  assert.equal(isRpcRateLimitError(new Error("network unavailable")), false);

  let active = 0;
  let maximumActive = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scheduler = new RpcReadScheduler(2, async () => {});
  const queued = Array.from({ length: 5 }, (_, index) =>
    scheduler.schedule(async () => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await gate;
      active--;
      return index;
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(maximumActive, 2);
  release();
  assert.deepEqual(await Promise.all(queued), [0, 1, 2, 3, 4]);

  const delays: number[] = [];
  let attempts = 0;
  const retrying = new RpcReadScheduler(1, async (milliseconds) => {
    delays.push(milliseconds);
  });
  const result = await retrying.schedule(async () => {
    attempts++;
    if (attempts < 3) {
      throw Object.assign(new Error("Request failed with status code 429"), {
        response: { status: 429 },
      });
    }
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [1_000, 2_000]);

  let nonRateAttempts = 0;
  await assert.rejects(
    () => retrying.schedule(async () => {
      nonRateAttempts++;
      throw new Error("invalid request");
    }),
    /invalid request/u,
  );
  assert.equal(nonRateAttempts, 1);

  console.log("rpc read scheduler ok");
}

main().catch((error) => {
  process.nextTick(() => {
    throw error;
  });
});
