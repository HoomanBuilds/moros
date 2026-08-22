import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAYMENT_CIRCUITS,
  PAYMENT_CONTEXT_FIELDS,
  PAYMENT_PUBLIC_SIGNALS,
} from "./artifacts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(here, "../../contracts/payment-circuits");

assert.equal(PAYMENT_CIRCUITS.length, 7);
assert.deepEqual(PAYMENT_CIRCUITS.map(({ code }) => code), [0, 1, 2, 3, 4, 5, 6]);
assert.equal(PAYMENT_PUBLIC_SIGNALS.length, 20);
assert.equal(new Set(PAYMENT_PUBLIC_SIGNALS).size, PAYMENT_PUBLIC_SIGNALS.length);
assert.equal(PAYMENT_CONTEXT_FIELDS.length, 32);
assert.equal(new Set(PAYMENT_CONTEXT_FIELDS).size, PAYMENT_CONTEXT_FIELDS.length);

for (const circuit of PAYMENT_CIRCUITS) {
  const source = readFileSync(resolve(sourceRoot, `${circuit.name}.circom`), "utf8");
  for (const signal of PAYMENT_PUBLIC_SIGNALS) {
    assert.match(source, new RegExp(`\\b${signal}\\b`, "u"));
  }
  assert.match(source, /component main \{ public \[/u);
}

const actionSource = readFileSync(resolve(sourceRoot, "payment_action.circom"), "utf8");
assert.match(actionSource, /Num2Bits\(120\)/u);
assert.match(actionSource, /totalInput === totalOutput/u);
assert.match(actionSource, /totalInput === totalOutput \+ publicAmountMagnitude/u);
assert.match(actionSource, /outputCount === 3 \* normal/u);
assert.match(actionSource, /contextFields\[20\] \* outAmount\[index\] === 0/u);

console.log("private payment circuit schemas ok");
