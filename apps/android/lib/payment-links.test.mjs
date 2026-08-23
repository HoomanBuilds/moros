import assert from "node:assert/strict";

const { parsePaymentTarget } = await import(new URL("./payment-links.ts", import.meta.url).href);
const code = `moros_pay_${"A".repeat(24)}`;
const payload = "request_payload_123";

assert.deepEqual(parsePaymentTarget(code), { kind: "code", payload: code });
assert.deepEqual(parsePaymentTarget(`https://pay.moros.fun/pay#${payload}`), { kind: "request", payload });
assert.deepEqual(parsePaymentTarget(`moros://pay?request=${payload}`), { kind: "request", payload });
assert.throws(() => parsePaymentTarget(`https://predict.moros.fun/pay#${payload}`));
assert.throws(() => parsePaymentTarget(`http://pay.moros.fun/pay#${payload}`));

console.log("payment link tests passed");
