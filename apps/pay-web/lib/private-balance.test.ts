import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { StrKey } from "@stellar/stellar-sdk";
import type { PaymentDeployment } from "@moros/payments-client";
import {
  fieldToBytes,
  paymentNoteDomain,
  scanPrivatePaymentBalance,
} from "./private-balance";

function contract(fill: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, fill));
}

function decimal(value: Uint8Array): string {
  return BigInt(`0x${Buffer.from(value).toString("hex")}`).toString();
}

const deployment = {
  format: 1,
  environment: "testnet",
  network: "stellar:testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
  rpcUrls: ["https://rpc.example"],
  apiUrls: ["https://api.example"],
  horizonUrl: "https://horizon.example",
  vault: contract(1),
  verifier: contract(2),
  usdcContract: contract(3),
  usdcIssuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  usdcCode: "USDC",
  treeLevels: 20,
  rootHistorySize: 32,
  startLedger: 1,
  maximumRelayFeeAtomic: "0",
  circuits: [],
} as unknown as PaymentDeployment;

const core = await import("@moros/payments-crypto-web");
core.initSync({
  module: readFileSync(new URL(
    "../../../packages/payments-crypto-web/moros_payments_core_bg.wasm",
    import.meta.url,
  )),
});

const entropy = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const phrase = core.recovery_phrase_from_entropy(entropy);
const identity = core.payment_identity_from_phrase(
  phrase,
  1,
  StrKey.decodeContract(deployment.vault),
  0n,
);
const domain = await paymentNoteDomain(deployment);
const littleEndianSecret = new Uint8Array(32);
littleEndianSecret[0] = 5;
const output = core.create_payment_output(
  identity.payment_code,
  0,
  fieldToBytes(domain),
  "123456789",
  fieldToBytes(7n),
  fieldToBytes(0n),
  new Uint8Array(64),
  fieldToBytes(9n),
  littleEndianSecret,
  fieldToBytes(11n),
);

const indexedOutput = {
  outputIndex: 0,
  leafIndex: 0,
  commitment: decimal(output.commitment),
  encryptedOutput: Buffer.from(output.envelope).toString("hex"),
  actionId: "ab".repeat(32),
};

function client(value = indexedOutput) {
  return {
    async outputs({ fromLeafIndex = 0 } = {}) {
      const outputs = fromLeafIndex === 0 ? [value] : [];
      return {
        network: deployment.network,
        vault: deployment.vault,
        fromLeafIndex,
        nextLeafIndex: fromLeafIndex + outputs.length,
        hasMore: false,
        outputs,
      };
    },
  };
}

const unspent = await scanPrivatePaymentBalance({
  phrase,
  deployment,
  client: client(),
  readSpent: async () => false,
});
assert.equal(unspent.spendableAtomic, 123456789n);
assert.equal(unspent.ownedNotes, 1);
assert.equal(unspent.spendableNotes, 1);

const spent = await scanPrivatePaymentBalance({
  phrase,
  deployment,
  client: client(),
  readSpent: async () => true,
});
assert.equal(spent.spendableAtomic, 0n);
assert.equal(spent.ownedNotes, 1);
assert.equal(spent.spendableNotes, 0);

const otherPhrase = core.recovery_phrase_from_entropy(Uint8Array.from({ length: 32 }, () => 44));
const unowned = await scanPrivatePaymentBalance({
  phrase: otherPhrase,
  deployment,
  client: client(),
  readSpent: async () => false,
});
assert.equal(unowned.spendableAtomic, 0n);
assert.equal(unowned.ownedNotes, 0);

output.free();
identity.free();

process.stdout.write("private payment balance tests passed\n");
