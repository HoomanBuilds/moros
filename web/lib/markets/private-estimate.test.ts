import assert from "node:assert/strict";
import { estimatePrivateProfit } from "./private-estimate";

assert.deepEqual(
  estimatePrivateProfit({
    quantity: 1,
    lotSize: 0.25,
    sideProbability: 0.5,
    yesProbability: 0.5,
    feeBps: 200,
  }),
  {
    grossProfit: 0.125,
    fee: 0.00125,
    netProfit: 0.12375,
  },
);

const yes = estimatePrivateProfit({
  quantity: 4,
  lotSize: 0.25,
  sideProbability: 0.7,
  yesProbability: 0.7,
  feeBps: 200,
});
const no = estimatePrivateProfit({
  quantity: 4,
  lotSize: 0.25,
  sideProbability: 0.3,
  yesProbability: 0.7,
  feeBps: 200,
});
assert.equal(yes?.fee, no?.fee);
assert.ok(Math.abs((yes?.grossProfit ?? 0) - 0.3) < 1e-12);
assert.ok(Math.abs((no?.grossProfit ?? 0) - 0.7) < 1e-12);

for (const invalid of [
  { quantity: 0, lotSize: 0.25, sideProbability: 0.5 },
  { quantity: 1, lotSize: 0, sideProbability: 0.5 },
  { quantity: 1, lotSize: 0.25, sideProbability: -0.1 },
  { quantity: 1, lotSize: 0.25, sideProbability: 1.1 },
]) {
  assert.equal(estimatePrivateProfit({
    ...invalid,
    yesProbability: 0.5,
    feeBps: 200,
  }), null);
}

process.stdout.write("private profit estimate ok\n");
