import assert from "node:assert/strict";
import { PaymentOutputScanner } from "../src/discovery.mjs";

const deployment = { network: "stellar:testnet", vault: "CA_VAULT" };
const pages = [
  {
    network: deployment.network,
    vault: deployment.vault,
    fromLeafIndex: 0,
    nextLeafIndex: 2,
    hasMore: true,
    outputs: [
      { leafIndex: 0, commitment: "10", encryptedOutput: "a" },
      { leafIndex: 1, commitment: "11", encryptedOutput: "b" },
    ],
  },
  {
    network: deployment.network,
    vault: deployment.vault,
    fromLeafIndex: 2,
    nextLeafIndex: 3,
    hasMore: false,
    outputs: [{ leafIndex: 2, commitment: "12", encryptedOutput: "c" }],
  },
];
let calls = 0;
const checkpoints = [];
const scanner = new PaymentOutputScanner({
  deployment,
  checkpoint: 0,
  saveCheckpoint: async (value) => checkpoints.push(value),
  client: {
    async outputs({ fromLeafIndex }) {
      assert.equal(fromLeafIndex, pages[calls].fromLeafIndex);
      return pages[calls++];
    },
  },
});
const [left, right] = await Promise.all([
  scanner.scan({ decrypt: async (output) => output.leafIndex === 1 ? { amount: "5" } : null, pageSize: 2 }),
  scanner.scan({ decrypt: async () => null, pageSize: 2 }),
]);
assert.deepEqual(left, right);
assert.equal(left.scanned, 3);
assert.equal(left.checkpoint, 3);
assert.equal(left.notes.length, 1);
assert.deepEqual(checkpoints, [2, 3]);
assert.equal(calls, 2);

const wrong = new PaymentOutputScanner({
  deployment,
  client: {
    outputs: async () => ({ ...pages[0], vault: "CA_WRONG" }),
  },
});
await assert.rejects(wrong.scan({ decrypt: async () => null }), /does not match/);

let saved = 0;
const decryptFailure = new PaymentOutputScanner({
  deployment,
  saveCheckpoint: async () => saved++,
  client: { outputs: async () => pages[0] },
});
await assert.rejects(
  decryptFailure.scan({ decrypt: async () => { throw new Error("decrypt failed"); } }),
  /decrypt failed/,
);
assert.equal(decryptFailure.checkpoint, 0);
assert.equal(saved, 0);

const gap = new PaymentOutputScanner({
  deployment,
  client: {
    outputs: async () => ({ ...pages[0], outputs: [{ ...pages[0].outputs[0], leafIndex: 1 }], nextLeafIndex: 1 }),
  },
});
await assert.rejects(gap.scan({ decrypt: async () => null }), /contains a gap/);

process.stdout.write("payment output discovery tests passed\n");
