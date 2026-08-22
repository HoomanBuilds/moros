import assert from "node:assert/strict";
import { StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import {
  PaymentRelayService,
  decodePaymentRelayRequest,
  encodeRelayQuote,
  relayQuoteMessage,
  relayWithFailover,
} from "./payment-relay.mjs";

function symbol(value) {
  return nativeToScVal(value, { type: "symbol" });
}

function map(entries) {
  return xdr.ScVal.scvMap(
    Object.entries(entries)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => new xdr.ScMapEntry({ key: symbol(key), val: value })),
  );
}

function vector(values) {
  return xdr.ScVal.scvVec(values);
}

function encoded(value) {
  return value.toXDR("base64");
}

function bytes(value) {
  return nativeToScVal(value, { type: "bytes" });
}

function paymentTransition(action, proofFill = 7) {
  const outputs = action === 1 ? 4 : 3;
  return map({
    attachment: bytes(action === 1 ? Buffer.alloc(128, 8) : Buffer.alloc(0)),
    encrypted_outputs: vector(
      Array.from({ length: outputs }, (_, index) => bytes(Buffer.alloc(480, index + 1))),
    ),
    proof: bytes(Buffer.alloc(256, proofFill)),
    statement: map({
      action: nativeToScVal(action, { type: "u32" }),
      attachment_hash: nativeToScVal(action === 1 ? 18n : 0n, { type: "u256" }),
      circuit: nativeToScVal(action === 1 ? 1 : 4, { type: "u32" }),
      context_digest: nativeToScVal(12n, { type: "u256" }),
      input_nullifiers: vector([nativeToScVal(13n, { type: "u256" })]),
      membership_root: nativeToScVal(14n, { type: "u256" }),
      output_commitments: vector(
        Array.from({ length: outputs }, (_, index) => nativeToScVal(BigInt(20 + index), { type: "u256" })),
      ),
      output_envelope_hashes: vector(
        Array.from({ length: outputs }, (_, index) => nativeToScVal(BigInt(30 + index), { type: "u256" })),
      ),
      public_amount: nativeToScVal(action === 1 ? 0n : -5n, { type: "i128" }),
    }),
  });
}

const vault = StrKey.encodeContract(Buffer.alloc(32, 1));
const token = StrKey.encodeContract(Buffer.alloc(32, 2));
const actionId = Buffer.alloc(32, 3);
const now = 1_780_000_000;
let submits = 0;
const relay = new PaymentRelayService({
  vault,
  token,
  networkDomain: Buffer.alloc(32, 4),
  signingSeed: Buffer.alloc(32, 5),
  paymentIdentity: {
    spendPublicKey: 6n,
    viewingPublicKeyX: 7n,
    viewingPublicKeyY: 8n,
  },
  fee: 0n,
  now: () => now,
  random: () => Buffer.alloc(32, 9),
  submit: async ({ contract, method }) => {
    submits++;
    await Promise.resolve();
    return { contract, method, hash: "abc" };
  },
});

const quote = relay.issueQuote({ actionId, actionExpiry: now + 180 });
assert.equal(quote.expiry, BigInt(now + 120));
assert.equal(quote.fee, 0n);
assert.equal(quote.signature.length, 64);
assert.equal(relayQuoteMessage(quote).length > 200, true);

function transferBody({ transition = paymentTransition(1), contract = vault, relayQuote = quote } = {}) {
  return {
    contract,
    method: "transfer",
    args: [
      encoded(bytes(actionId)),
      encoded(nativeToScVal(BigInt(now + 180), { type: "u64" })),
      encoded(nativeToScVal(0n, { type: "u64" })),
      encoded(encodeRelayQuote(relayQuote)),
      encoded(transition),
    ],
  };
}

const decoded = decodePaymentRelayRequest(transferBody(), relay.config, now);
assert.equal(decoded.method, "transfer");
assert.equal(decoded.actionId, actionId.toString("hex"));
assert.equal(decoded.args.length, 5);

const [first, second] = await Promise.all([
  relay.relay(transferBody()),
  relay.relay(transferBody()),
]);
assert.deepEqual(first, second);
assert.equal(submits, 1);
await assert.rejects(
  relay.relay(transferBody({ transition: paymentTransition(1, 10) })),
  /action id already used/,
);

assert.throws(
  () => decodePaymentRelayRequest(transferBody({ contract: token }), relay.config, now),
  /unsupported payment relay request/,
);
assert.throws(
  () => decodePaymentRelayRequest({ ...transferBody(), method: "deposit" }, relay.config, now),
  /unsupported payment relay request/,
);
assert.throws(
  () => decodePaymentRelayRequest({ ...transferBody(), args: transferBody().args.slice(0, 4) }, relay.config, now),
  /unsupported payment relay request/,
);
assert.throws(
  () => decodePaymentRelayRequest({ ...transferBody(), args: ["bad", ...transferBody().args.slice(1)] }, relay.config, now),
  /invalid relay argument/,
);
assert.throws(
  () => decodePaymentRelayRequest(transferBody(), relay.config, now + 121),
  /invalid relay quote/,
);
assert.throws(
  () => decodePaymentRelayRequest(transferBody({ transition: paymentTransition(2) }), relay.config, now),
  /payment action does not match/,
);

const tamperedQuote = { ...quote, signature: Buffer.from(quote.signature) };
tamperedQuote.signature[0] ^= 1;
assert.throws(
  () => decodePaymentRelayRequest(transferBody({ relayQuote: tamperedQuote }), relay.config, now),
  /invalid relay quote signature/,
);

const withdrawAction = Buffer.alloc(32, 11);
const withdrawQuote = relay.issueQuote({ actionId: withdrawAction, actionExpiry: now + 180 });
const withdrawBody = {
  contract: vault,
  method: "withdraw",
  args: [
    encoded(nativeToScVal(StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 12)), { type: "address" })),
    encoded(bytes(withdrawAction)),
    encoded(nativeToScVal(BigInt(now + 180), { type: "u64" })),
    encoded(nativeToScVal(false)),
    encoded(nativeToScVal(0n, { type: "u64" })),
    encoded(encodeRelayQuote(withdrawQuote)),
    encoded(paymentTransition(2)),
  ],
};
assert.equal(decodePaymentRelayRequest(withdrawBody, relay.config, now).method, "withdraw");
const emergencyBody = structuredClone(withdrawBody);
emergencyBody.args[3] = encoded(nativeToScVal(true));
assert.throws(
  () => decodePaymentRelayRequest(emergencyBody, relay.config, now),
  /emergency withdrawals must be submitted by the user/,
);

const calls = [];
const failoverResult = await relayWithFailover({
  endpoints: ["https://relay-one.example", "https://relay-two.example"],
  body: { action: "opaque" },
  attempts: 1,
  fetchImpl: async (endpoint) => {
    calls.push(endpoint);
    if (endpoint.includes("one")) return { ok: false, status: 503 };
    return { ok: true, status: 200, json: async () => ({ hash: "xyz" }) };
  },
});
assert.deepEqual(failoverResult, { hash: "xyz" });
assert.equal(calls.length, 2);
await assert.rejects(
  relayWithFailover({
    endpoints: ["https://relay.example"],
    body: {},
    fetchImpl: async () => ({ ok: false, status: 400 }),
  }),
  /rejected request with 400/,
);

process.stdout.write("payment relay tests passed\n");
