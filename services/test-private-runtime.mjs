import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { StrKey } from "@stellar/stellar-sdk";
import { parseRange } from "./private-artifacts.mjs";
import { PrivateMarketRegistry } from "./private-market-registry.mjs";

assert.deepEqual(
  parseRange(undefined, 100),
  { start: 0, end: 99, partial: false },
);
assert.deepEqual(
  parseRange("bytes=10-19", 100),
  { start: 10, end: 19, partial: true },
);
assert.deepEqual(
  parseRange("bytes=90-", 100),
  { start: 90, end: 99, partial: true },
);
assert.deepEqual(
  parseRange("bytes=-10", 100),
  { start: 90, end: 99, partial: true },
);
assert.throws(() => parseRange("bytes=100-101", 100), /outside/);
assert.throws(() => parseRange("items=1-2", 100), /invalid/);

const directory = mkdtempSync(resolve(tmpdir(), "moros-private-markets-"));
const stateFile = resolve(directory, "markets.json");
const market = StrKey.encodeContract(Buffer.alloc(32, 4));
const verified = [];

try {
  const registry = new PrivateMarketRegistry({
    stateFile,
    verify: async (value) => verified.push(value),
  });
  await registry.register(market);
  await registry.register(market);
  assert.deepEqual(registry.list(), [market]);
  assert.deepEqual(verified, [market, market]);

  const resumed = new PrivateMarketRegistry({
    stateFile,
    verify: async () => {},
  });
  assert.deepEqual(resumed.list(), [market]);
  await assert.rejects(() => resumed.register("bad"), /invalid/);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

process.stdout.write("private runtime tests passed\n");
