import assert from "node:assert";
import { probFromFixed, fixedToNumber, formatCountdown, outcomeLabel, marketQuestion } from "./derive.ts";

const SCALE = 4294967296n;
assert.equal(Math.round(probFromFixed(SCALE / 2n) * 100), 50);
assert.equal(Math.round(probFromFixed((SCALE * 2254768441n) / SCALE) * 1000), 525);
assert.equal(fixedToNumber(30n * SCALE), 30);
assert.equal(outcomeLabel(null), "LIVE");
assert.equal(outcomeLabel("Yes"), "YES");
assert.equal(outcomeLabel({ tag: "No" }), "NO");
assert.equal(outcomeLabel(["Yes"]), "YES");
assert.equal(outcomeLabel(["No"]), "NO");
assert.equal(formatCountdown(0), "resolved");
assert.ok(formatCountdown(90000).includes("d"));
assert.ok(marketQuestion({ asset: "XLM", threshold: 25000000000000n, expiry: 2000000000n }).length > 0);
console.log("derive ok");
