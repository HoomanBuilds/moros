import assert from "node:assert/strict";
import { marketFromPrivateCatalog } from "@/lib/stellar/use-market";
import { NETWORK } from "@/lib/network";
import type { PrivateMarketCatalogEntry } from "@/lib/private/client";

const market = `C${"A".repeat(55)}`;
const entry: PrivateMarketCatalogEntry = {
  market,
  checkedAt: "2026-08-03T00:00:00.000Z",
  state: ["0", "0", "429496729600"],
  priceYes: "2147483648",
  outcome: null,
  info: {
    asset: "XLM",
    threshold: "18900000000000",
    expiry: "2000000000",
    finalize_after: "2000000600",
  },
  scenario: { market_assets: "200000000" },
  registration: {
    market,
    current_epoch: "1",
    lot_size: "4294967296",
    fee_bps: 50,
    maximum_batch_size: 8,
    minimum_side_count: 0,
  },
  epoch: {
    accepted_count: 0,
    last_sequence: "0",
    phase: "Collecting",
  },
  previousEpoch: {
    accepted_count: 4,
    last_sequence: "4",
    phase: "Executed",
  },
};

const data = marketFromPrivateCatalog(entry, NETWORK.collateral, {
  liquidityVaultId: `C${"B".repeat(55)}`,
  title: "Cached XLM market",
  resolverType: "price",
});

assert.equal(data.question, "Cached XLM market");
assert.equal(data.probYes, 0.5);
assert.equal(data.poolSize, 20);
assert.equal(data.orderCount, 4);
assert.equal(data.feeBps, 50);
assert.equal(data.lotSize, 1);
assert.equal(data.maximumBatchSize, 8);
assert.equal(data.minimumSideCount, 0);

const resolved = marketFromPrivateCatalog(
  { ...entry, outcome: "Yes" },
  NETWORK.collateral,
  { resolverType: "price" },
);
assert.equal(resolved.outcome, "YES");
assert.equal(resolved.acceptingOrders, false);
assert.equal(resolved.resolutionLabel, "resolved");

const voided = marketFromPrivateCatalog(
  { ...entry, outcome: { tag: "Void" } },
  NETWORK.collateral,
  { resolverType: "price" },
);
assert.equal(voided.outcome, "VOID");
assert.equal(voided.resolutionLabel, "voided and refundable");

const expired = marketFromPrivateCatalog(
  { ...entry, info: { ...entry.info, expiry: "1", finalize_after: "2" } },
  NETWORK.collateral,
  { resolverType: "price" },
);
assert.equal(expired.outcome, "LIVE");
assert.equal(expired.acceptingOrders, false);
assert.equal(expired.phase, "CLOSED");

const currentEpochOrders = marketFromPrivateCatalog(
  {
    ...entry,
    registration: { ...entry.registration, current_epoch: "2" },
    epoch: {
      accepted_count: 2,
      last_sequence: "6",
      phase: "Collecting",
    },
  },
  NETWORK.collateral,
  { resolverType: "price" },
);
assert.equal(currentEpochOrders.orderCount, 6);

assert.throws(
  () => marketFromPrivateCatalog(entry, NETWORK.collateral, {
    resolverType: "event",
  }),
  /direct rule verification/u,
);

console.log("private market catalog mapping ok");
