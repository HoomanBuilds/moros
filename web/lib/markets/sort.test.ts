import assert from "node:assert/strict";
import type { MarketRow } from "./catalog.ts";
import { sortRows } from "./sort.ts";

function row(
  id: string,
  live: boolean,
  secondsLeft: number,
  poolSize: number,
): MarketRow {
  return {
    id,
    href: `/app/market/${id}`,
    asset: "XLM",
    resolverType: "price",
    question: id,
    strike: "1",
    strikeNum: 1,
    probYes: 0.5,
    yesCents: 50,
    outcome: live ? "LIVE" : "VOID",
    live,
    resolutionLabel: live ? "1h" : "voided",
    secondsLeft,
    poolSize,
    collateralCode: "USDC",
    orders: 0,
    flagship: false,
  };
}

const closed = row("closed", false, 0, 100);
const liveSoon = row("live-soon", true, 60, 10);
const liveLater = row("live-later", true, 600, 20);

assert.deepEqual(
  sortRows([closed, liveLater, liveSoon], "ending").map(({ id }) => id),
  ["live-soon", "live-later", "closed"],
);
assert.deepEqual(
  sortRows([closed, liveSoon, liveLater], "pool").map(({ id }) => id),
  ["live-later", "live-soon", "closed"],
);

console.log("market sorting ok");
