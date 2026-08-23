import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { initSync, recovery_phrase_from_entropy } from "@moros/payments-crypto-web";
import * as snarkjs from "snarkjs";
import { derivePaymentIdentity } from "../lib/payment-identity";
import {
  PAYMENT_PUBLIC_SIGNALS,
  contextFields,
  createPaymentOutput,
  outputWitness,
  paymentIdentityFromCode,
  paymentNoteDomain,
  publicFields,
} from "../lib/payment-protocol";
import { testDeployment } from "../lib/test-deployment";

Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
initSync({
  module: readFileSync(resolve("../../packages/payments-crypto-web/moros_payments_core_bg.wasm")),
});

const deployment = testDeployment();
const phrase = recovery_phrase_from_entropy(new Uint8Array(32).fill(23));
const recipient = await derivePaymentIdentity(phrase, deployment);
const publicIdentity = paymentIdentityFromCode(recipient.paymentCode);
const amount = 1_000_000n;
const context = await contextFields({
  deployment,
  networkDomain: new Uint8Array(32).fill(1),
  verifierDomain: new Uint8Array(32).fill(2),
  action: 0,
  actionId: new Uint8Array(32).fill(3),
  expiry: 1_800_000_000,
  publicAccount: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey(),
  publicAmount: amount,
  outputCount: 2,
  feeEpoch: 0n,
  relayFee: 0n,
  protocolFee: 0n,
  relayIdentity: publicIdentity,
  protocolIdentity: publicIdentity,
  attachmentHash: 0n,
  relayQuoteDigest: 0n,
});
const domain = paymentNoteDomain(context);
const outputs = [
  await createPaymentOutput({ recipientCode: recipient.paymentCode, outputIndex: 0, noteDomain: domain, amount }),
  await createPaymentOutput({ recipientCode: recipient.paymentCode, outputIndex: 1, noteDomain: domain, amount: 0n }),
];
const fields = publicFields({
  action: 0,
  context,
  membershipRoot: 0n,
  nullifiers: [],
  outputs,
  attachmentHash: 0n,
  publicAmount: amount,
});
const artifactRoot = resolve("public/zk/payments");
const result = await snarkjs.groth16.fullProve(
  { ...fields, contextFields: context, ...outputWitness(outputs) },
  resolve(artifactRoot, "deposit.wasm"),
  resolve(artifactRoot, "deposit.zkey"),
);
const verificationKey = JSON.parse(readFileSync(resolve(artifactRoot, "deposit.vk.json"), "utf8"));
assert.equal(await snarkjs.groth16.verify(verificationKey, result.publicSignals, result.proof), true);
assert.deepEqual(
  result.publicSignals.map((value) => BigInt(value).toString()),
  PAYMENT_PUBLIC_SIGNALS.map((name) => fields[name].toString()),
);

console.log("browser payment proof fixture passed");
