import assert from "node:assert/strict";
import { createAsyncValueCache } from "./unlock-cache.ts";

async function main() {
  const cache = createAsyncValueCache<string, { secret: string }>();
  let calls = 0;
  let release: ((value: { secret: string }) => void) | undefined;
  const create = () => {
    calls += 1;
    return new Promise<{ secret: string }>((resolve) => {
      release = resolve;
    });
  };

  const first = cache.getOrCreate("wallet", create);
  const second = cache.getOrCreate("wallet", create);
  const third = cache.getOrCreate("wallet", create);
  await Promise.resolve();

  assert.equal(calls, 1);
  release?.({ secret: "shared" });
  const results = await Promise.all([first, second, third]);
  assert.deepEqual(results, [
    { secret: "shared" },
    { secret: "shared" },
    { secret: "shared" },
  ]);

  assert.deepEqual(
    await cache.getOrCreate("wallet", async () => {
      calls += 1;
      return { secret: "unexpected" };
    }),
    { secret: "shared" },
  );
  assert.equal(calls, 1);

  const retryCache = createAsyncValueCache<string, string>();
  let attempts = 0;
  await assert.rejects(
    retryCache.getOrCreate("wallet", async () => {
      attempts += 1;
      throw new Error("rejected");
    }),
    /rejected/,
  );
  assert.equal(
    await retryCache.getOrCreate("wallet", async () => {
      attempts += 1;
      return "unlocked";
    }),
    "unlocked",
  );
  assert.equal(attempts, 2);

  console.log("private wallet unlock cache ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
