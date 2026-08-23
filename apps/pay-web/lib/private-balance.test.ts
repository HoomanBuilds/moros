import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { StrKey } from "@stellar/stellar-sdk";
import type { PaymentDeployment } from "@moros/payments-client";
import {
  fieldToBytes,
  createPrivateBalanceSession,
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

const secondOutput = core.create_payment_output(
  identity.payment_code,
  0,
  fieldToBytes(domain),
  "200000000",
  fieldToBytes(8n),
  fieldToBytes(0n),
  new Uint8Array(64),
  fieldToBytes(10n),
  littleEndianSecret,
  fieldToBytes(12n),
);
const indexedSecond = {
  outputIndex: 0,
  leafIndex: 1,
  commitment: decimal(secondOutput.commitment),
  encryptedOutput: Buffer.from(secondOutput.envelope).toString("hex"),
  actionId: "cd".repeat(32),
};
const available = [indexedOutput];
const spentNullifiers = new Set<string>();
const checkedNullifiers: bigint[] = [];
const incrementalClient = {
  async outputs({ fromLeafIndex = 0, limit = 100 } = {}) {
    const outputs = available.slice(fromLeafIndex, fromLeafIndex + limit);
    return {
      network: deployment.network,
      vault: deployment.vault,
      fromLeafIndex,
      nextLeafIndex: fromLeafIndex + outputs.length,
      hasMore: fromLeafIndex + outputs.length < available.length,
      outputs,
    };
  },
};
const session = await createPrivateBalanceSession({
  phrase,
  deployment,
  client: incrementalClient,
  readSpent: async (nullifier) => {
    checkedNullifiers.push(nullifier);
    return spentNullifiers.has(nullifier.toString());
  },
});
const firstScan = await session.refresh();
assert.equal(firstScan.scannedOutputs, 1);
assert.equal(firstScan.spendableAtomic, 123456789n);
spentNullifiers.add(checkedNullifiers[0].toString());
available.push(indexedSecond);
const secondScan = await session.refresh();
assert.equal(secondScan.scannedOutputs, 2);
assert.equal(secondScan.ownedNotes, 2);
assert.equal(secondScan.spendableNotes, 1);
assert.equal(secondScan.spendableAtomic, 200000000n);
session.dispose();

const childIdentity = core.payment_identity_from_phrase(
  phrase,
  1,
  StrKey.decodeContract(deployment.vault),
  1n,
);
const childOutput = core.create_payment_output(
  childIdentity.payment_code,
  0,
  fieldToBytes(domain),
  "300000000",
  fieldToBytes(13n),
  fieldToBytes(0n),
  new Uint8Array(64),
  fieldToBytes(14n),
  littleEndianSecret,
  fieldToBytes(15n),
);
const childSession = await createPrivateBalanceSession({
  phrase,
  deployment,
  client: client({
    outputIndex: 0,
    leafIndex: 0,
    commitment: decimal(childOutput.commitment),
    encryptedOutput: Buffer.from(childOutput.envelope).toString("hex"),
    actionId: "ef".repeat(32),
  }),
  readSpent: async () => false,
});
assert.equal((await childSession.refresh()).ownedNotes, 0);
await childSession.expand(1);
const expanded = await childSession.refresh();
assert.equal(expanded.ownedNotes, 1);
assert.equal(expanded.spendableAtomic, 300000000n);
childSession.dispose();

childOutput.free();
childIdentity.free();
secondOutput.free();
output.free();
identity.free();

process.stdout.write("private payment balance tests passed\n");
