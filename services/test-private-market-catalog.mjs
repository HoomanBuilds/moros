import assert from "node:assert/strict";
import {
  PrivateMarketCatalog,
  contractResultValue,
  marketCatalogChanged,
} from "./private-market-catalog.mjs";

let now = Date.parse("2026-08-03T00:00:00.000Z");
let failingMarket = null;
let blockedMarket = null;
let readGate = null;
let releaseCatalogRead = () => {};
let registrationReads = 0;
const registeredMarkets = ["MARKET_A", "MARKET_B"];
const registrations = {
  MARKET_A: { market: "MARKET_A", current_epoch: 1n },
  MARKET_B: { market: "MARKET_B", current_epoch: 0n, finalized: true },
};
const epochs = {
  "MARKET_A:1": {
    phase: { tag: "Collecting" },
    accepted_count: 0,
    last_sequence: 0n,
  },
  "MARKET_A:0": {
    phase: { tag: "Executed" },
    accepted_count: 2,
    last_sequence: 2n,
  },
  "MARKET_B:0": {
    phase: { tag: "Collecting" },
    accepted_count: 1,
    last_sequence: 1n,
  },
};

assert.deepEqual(
  contractResultValue({ result: { value: [1n, 2n, 3n] } }),
  [1n, 2n, 3n],
);
assert.equal(contractResultValue({ result: 4n }), 4n);
assert.throws(
  () => contractResultValue({ result: { error: "NotInitialized" } }),
  /contract read failed/,
);

assert.equal(marketCatalogChanged(undefined, { status: "collecting" }), true);
assert.equal(
  marketCatalogChanged(
    { status: "collecting", epoch: "1", accepted: 0 },
    { status: "collecting", epoch: "1", accepted: 0 },
  ),
  false,
);
assert.equal(
  marketCatalogChanged(
    { status: "collecting", epoch: "1", accepted: 0 },
    { status: "collecting", epoch: "1", accepted: 1 },
  ),
  true,
);
assert.equal(
  marketCatalogChanged(
    { status: "executed", epoch: "1", yesCount: 1, noCount: 1 },
    { status: "opened", epoch: "2" },
  ),
  true,
);

assert.throws(
  () => new PrivateMarketCatalog({
    registry: { list: () => [] },
    vault: {},
    marketClient: async () => ({}),
    readConcurrency: 0,
  }),
  /configuration is incomplete/,
);

const empty = new PrivateMarketCatalog({
  registry: { list: () => [] },
  vault: {},
  marketClient: async () => ({}),
});
const emptySnapshot = await empty.refresh();
assert.equal(emptySnapshot.markets.length, 0);
assert.equal(emptySnapshot.errors.length, 0);

let activeReads = 0;
let maximumActiveReads = 0;
const concurrencyMarkets = Array.from({ length: 5 }, (_, index) => `M${index}`);
const bounded = new PrivateMarketCatalog({
  registry: { list: () => concurrencyMarkets },
  vault: {
    registration: async ({ market }) => ({
      result: { market, current_epoch: 0n },
    }),
    epoch: async () => ({
      result: { phase: "Collecting", last_sequence: 0n },
    }),
  },
  marketClient: async () => {
    activeReads++;
    maximumActiveReads = Math.max(maximumActiveReads, activeReads);
    await new Promise((resolve) => setTimeout(resolve, 2));
    activeReads--;
    return {
      get_state: async () => ({ result: [0n, 0n, 1n] }),
      price_yes: async () => ({ result: 1n }),
      outcome: async () => ({ result: null }),
      market_info: async () => ({
        result: { asset: "XLM", threshold: 1n, expiry: 2n },
      }),
      scenario_state: async () => ({ result: { market_assets: 3n } }),
    };
  },
  readConcurrency: 2,
});
assert.equal((await bounded.refresh()).markets.length, 5);
assert.equal(maximumActiveReads, 2);

const catalog = new PrivateMarketCatalog({
  registry: { list: () => [...registeredMarkets] },
  vault: {
    registration: async ({ market }) => {
      registrationReads++;
      return { result: registrations[market] };
    },
    epoch: async ({ market, epoch_number: epochNumber }) => ({
      result: epochs[`${market}:${epochNumber}`],
    }),
  },
  marketClient: async (market) => {
    if (market === failingMarket) throw new Error("temporary read failure");
    if (market === blockedMarket && readGate) await readGate;
    return {
      get_state: async () => ({ result: [1n, 2n, 3n] }),
      price_yes: async () => ({ result: market === "MARKET_A" ? 4n : 5n }),
      outcome: async () => ({ result: null }),
      market_info: async () => ({
        result: { asset: "XLM", threshold: 6n, expiry: 7n },
      }),
      scenario_state: async () => market === "MARKET_B"
        ? { result: { error: "AlreadyFinalized" } }
        : { result: { market_assets: 8n } },
    };
  },
  now: () => now,
});

assert.equal(catalog.isStale(10_000), true);
const first = await catalog.refresh();
assert.equal(first.markets.length, 2);
assert.equal(first.errors.length, 0);
assert.equal(first.markets[0].epoch.phase, "Collecting");
assert.equal(first.markets[0].previousEpoch.phase, "Executed");
assert.equal(first.markets[1].previousEpoch, null);
assert.equal(first.markets[1].scenario.market_assets, 0n);
assert.equal(catalog.isStale(10_000), false);

const beforeConcurrent = registrationReads;
now += 11_000;
const [sameA, sameB] = await Promise.all([catalog.refresh(), catalog.refresh()]);
assert.equal(sameA, sameB);
assert.equal(registrationReads - beforeConcurrent, 2);

failingMarket = "MARKET_B";
now += 11_000;
const degraded = await catalog.refresh();
assert.equal(degraded.markets.length, 2);
assert.equal(degraded.markets[1].market, "MARKET_B");
assert.equal(degraded.errors.length, 1);
assert.equal(degraded.errors[0].market, "MARKET_B");

failingMarket = null;
registrations.MARKET_C = { market: "MARKET_C", current_epoch: 0n };
epochs["MARKET_C:0"] = {
  phase: { tag: "Collecting" },
  accepted_count: 0,
  last_sequence: 0n,
};
registeredMarkets.push("MARKET_C");
catalog.invalidate();
const inserted = await catalog.refresh();
assert.equal(inserted.markets.length, 3);
assert.equal(inserted.markets[2].market, "MARKET_C");

registrations.MARKET_D = { market: "MARKET_D", current_epoch: 0n };
epochs["MARKET_D:0"] = {
  phase: { tag: "Collecting" },
  accepted_count: 0,
  last_sequence: 0n,
};
blockedMarket = "MARKET_A";
readGate = new Promise((resolve) => {
  releaseCatalogRead = resolve;
});
catalog.invalidate();
const refreshing = catalog.refresh();
await Promise.resolve();
registeredMarkets.push("MARKET_D");
catalog.invalidate();
releaseCatalogRead();
const refreshedAfterInsert = await refreshing;
assert.equal(refreshedAfterInsert.markets.length, 4);
assert.equal(refreshedAfterInsert.markets[3].market, "MARKET_D");

blockedMarket = null;
readGate = null;
registeredMarkets.splice(registeredMarkets.indexOf("MARKET_B"), 1);
catalog.invalidate();
const afterRemoval = await catalog.refresh();
assert.equal(afterRemoval.markets.length, 3);
assert.equal(
  afterRemoval.markets.some((entry) => entry.market === "MARKET_B"),
  false,
);

console.log("private market catalog ok");
