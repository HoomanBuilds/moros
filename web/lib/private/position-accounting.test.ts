import assert from "node:assert/strict";
import { calculateExecutedPositionAmounts } from "./position-accounting.ts";

assert.deepEqual(calculateExecutedPositionAmounts({
  positionBudget: 310n,
  quantity: 3n,
  chargePerUnit: 60n,
  feePerUnit: 5n,
  payoutPerUnit: 100n,
  winner: true,
  voided: false,
}), {
  changeAmount: 115n,
  terminalAmount: 300n,
});

assert.deepEqual(calculateExecutedPositionAmounts({
  positionBudget: 310n,
  quantity: 3n,
  chargePerUnit: 60n,
  feePerUnit: 5n,
  payoutPerUnit: 100n,
  winner: false,
  voided: true,
}), {
  changeAmount: 115n,
  terminalAmount: 195n,
});

assert.equal(calculateExecutedPositionAmounts({
  positionBudget: 310n,
  quantity: 3n,
  chargePerUnit: 60n,
  feePerUnit: 5n,
  payoutPerUnit: 100n,
  winner: false,
  voided: false,
}).terminalAmount, 0n);

for (const quantity of [0n, 1_001n]) {
  assert.throws(() => calculateExecutedPositionAmounts({
    positionBudget: 100n,
    quantity,
    chargePerUnit: 50n,
    feePerUnit: 1n,
    payoutPerUnit: 100n,
    winner: true,
    voided: false,
  }), /quantity is invalid/);
}

assert.throws(() => calculateExecutedPositionAmounts({
  positionBudget: 194n,
  quantity: 3n,
  chargePerUnit: 60n,
  feePerUnit: 5n,
  payoutPerUnit: 100n,
  winner: true,
  voided: false,
}), /budget is below/);

process.stdout.write("private position accounting ok\n");
