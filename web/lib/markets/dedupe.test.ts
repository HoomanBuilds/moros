import assert from "node:assert";
import { dedupeMarkets, type MarketEntry } from "./dedupe.ts";

const seed: MarketEntry = { marketId: "A", poolId: "pa", asset: "XLM", kind: "shielded", flagship: true };
const remote: MarketEntry = { marketId: "B", poolId: "pb", asset: "ETH", kind: "shielded" };
const dupOfA: MarketEntry = { marketId: "A", poolId: "pa2", asset: "XLM", kind: "shielded" };
const local: MarketEntry = { marketId: "C", poolId: "pc", asset: "BTC", kind: "shielded" };
const blank = { marketId: "", poolId: "px", asset: "SOL", kind: "shielded" } as MarketEntry;

const merged = dedupeMarkets([seed, remote, dupOfA, local, blank]);

assert.equal(merged.length, 3);
assert.deepEqual(merged.map((m) => m.marketId), ["A", "B", "C"]);
assert.equal(merged[0].poolId, "pa");
assert.equal(merged[0].flagship, true);
assert.ok(!merged.some((m) => m.marketId === ""));
assert.equal(dedupeMarkets([]).length, 0);

console.log("dedupe ok");
