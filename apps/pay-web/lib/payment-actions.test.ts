import assert from "node:assert/strict";
import { mock } from "node:test";
import { contract, rpc } from "@stellar/stellar-sdk";
import { preparePaymentFees, transferPrivateUsdc } from "./payment-actions";
import { testDeployment } from "./test-deployment";

const deployment = { ...testDeployment(), maximumRelayFeeAtomic: "10000" };
let relayFee = "10000";
let protocolFee = 20000n;
let now = 1_800_000_000_000;
let expiry = now / 1000 + 60;
const calls: string[] = [];
mock.method(Date, "now", () => now);
mock.method(rpc.Server.prototype, "getContractWasmByContractId", async () => new Uint8Array());
mock.method(contract.Client, "fromWasm", async () => ({
  info: async () => ({ result: { paused: false, fee: { protocol_fee: protocolFee }, network_domain: new Uint8Array(32) } }),
}));
mock.method(globalThis, "fetch", async (url: string) => {
  calls.push(url);
  assert.match(url, /\/v1\/relay\/quote$/);
  return new Response(JSON.stringify({ fee: relayFee, expiry, paymentIdentity: { spendPublicKey: "1", viewingPublicKeyX: "2", viewingPublicKeyY: "3" } }), { status: 200, headers: { "content-type": "application/json" } });
});
const input = {
  deployment, senderCode: "", recipientCode: "", amountAtomic: 1n, memo: "",
  prepareSpend: async (): Promise<never> => { throw new Error("must not reach notes"); },
};
try {
  const quote = await preparePaymentFees(deployment);
  assert.equal(quote.relayFee + quote.protocolFee, 30000n);
  assert.equal(quote.expiresAt, expiry);
  now += 61000;
  await assert.rejects(() => transferPrivateUsdc({ ...input, fees: quote }), /expired/);
  expiry = now / 1000 + 60;
  relayFee = "10001";
  await assert.rejects(() => preparePaymentFees(deployment), /exceeds/);
  relayFee = "10000";
  protocolFee = -1n;
  await assert.rejects(() => preparePaymentFees(deployment), /invalid fee/);
  protocolFee = 20000n;
  await assert.rejects(() => preparePaymentFees(deployment, now / 1000), /expired/);
  const context = await preparePaymentFees(deployment);
  context.protocolFee = 0n;
  await assert.rejects(() => transferPrivateUsdc({ ...input, fees: context }), /quote changed/);
  const fabricated = { relayFee: 0n, protocolFee: 0n, expiresAt: expiry };
  await assert.rejects(() => transferPrivateUsdc({ ...input, fees: fabricated }), /new fee quote/);
  assert.ok(calls.length > 0);
  console.log("Payment fee limits, expiry, context binding and tamper checks passed without submissions.");
} finally {
  mock.restoreAll();
}
