import assert from "node:assert/strict";
import { parsePaymentDeployment, paymentDeployment } from "./deployment";
import { testDeployment } from "./test-deployment";

assert.deepEqual(parsePaymentDeployment(undefined), {
  ready: false,
  reason: "The private payment network is not configured on this build.",
});

const deployment = testDeployment();
const valid = parsePaymentDeployment(JSON.stringify(deployment));
assert.equal(valid.ready, true);
if (valid.ready) {
  assert.equal(valid.deployment.network, "stellar:testnet");
  assert.equal(valid.deployment.circuits.length, 7);
}

assert.equal(parsePaymentDeployment("{").ready, false);
assert.equal(parsePaymentDeployment(JSON.stringify({ ...deployment, network: "stellar:pubnet" })).ready, false);
assert.equal(parsePaymentDeployment(JSON.stringify({ ...deployment, extra: true })).ready, false);
assert.equal(parsePaymentDeployment(JSON.stringify({ ...deployment, rpcUrls: ["http://rpc.example.com"] })).ready, false);
assert.equal(paymentDeployment.ready, true);
if (paymentDeployment.ready) {
  assert.equal(paymentDeployment.deployment.environment, "mainnet");
  assert.equal(paymentDeployment.deployment.network, "stellar:pubnet");
  assert.equal(paymentDeployment.deployment.vault, "CCKD5AHU2JGUR7RWMI5CT3UVOOCPDTQYK43DI24GKRKKUWZ3N22UOAIR");
}

console.log("payment deployment tests passed");
