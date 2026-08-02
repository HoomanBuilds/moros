import assert from "node:assert/strict";
import {
  getPrivateOutputStatus,
  getPrivateTree,
  mergePrivateTreeResponse,
  type IndexedPrivateOutput,
  type PrivateTreeSnapshot,
} from "./client.ts";

const vaultId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function output(commitment: string, leafIndex: number, root: string): IndexedPrivateOutput {
  return {
    commitment,
    leafIndex,
    root,
    actionId: leafIndex.toString(16).padStart(64, "0"),
    encryptedOutput: "01",
  };
}

async function main() {
const initial = mergePrivateTreeResponse(null, {
  vaultId,
  levels: 20,
  fromLeafIndex: 0,
  nextLeafIndex: 2,
  currentRoot: "12",
  commitments: ["11", "12"],
  outputs: [output("11", 0, "12"), output("12", 1, "12")],
  updatedAt: new Date(0).toISOString(),
});
assert.equal(initial.nextLeafIndex, 2);

const merged = mergePrivateTreeResponse(initial, {
  vaultId,
  levels: 20,
  fromLeafIndex: 2,
  baseRoot: "12",
  nextLeafIndex: 4,
  currentRoot: "34",
  commitments: ["13", "14"],
  outputs: [output("13", 2, "34"), output("14", 3, "34")],
  updatedAt: new Date(1).toISOString(),
});
assert.deepEqual(merged.commitments, ["11", "12", "13", "14"]);
assert.equal(merged.currentRoot, "34");

assert.throws(
  () => mergePrivateTreeResponse(initial, {
    ...merged,
    fromLeafIndex: 2,
    baseRoot: "99",
    commitments: ["13", "14"],
    outputs: [output("13", 2, "34"), output("14", 3, "34")],
  }),
  /does not continue/u,
);

const oldServerResponse = {
  ...initial,
} satisfies PrivateTreeSnapshot;
assert.deepEqual(
  mergePrivateTreeResponse(null, oldServerResponse).commitments,
  ["11", "12"],
);

const reset = mergePrivateTreeResponse(null, {
  vaultId,
  levels: 20,
  fromLeafIndex: 0,
  nextLeafIndex: 1,
  currentRoot: "21",
  commitments: ["21"],
  outputs: [output("21", 0, "21")],
  updatedAt: new Date(2).toISOString(),
});
const requests: string[] = [];
const responses = [
  new Response(JSON.stringify(initial), { status: 200 }),
  new Response(JSON.stringify({ error: "offset is invalid" }), { status: 400 }),
  new Response(JSON.stringify(reset), { status: 200 }),
];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  requests.push(String(input));
  const response = responses.shift();
  if (!response) throw new Error("unexpected private tree request");
  return response;
};
assert.equal((await getPrivateTree()).nextLeafIndex, 2);
assert.equal((await getPrivateTree()).currentRoot, "21");
assert.ok(requests[0].includes("from=0"));
assert.ok(requests[1].includes("from=2"));
assert.ok(requests[2].includes("from=0"));

globalThis.fetch = async () => new Response(JSON.stringify({
  indexed: true,
  output: output("22", 0, "22"),
  nextLeafIndex: 1,
  currentRoot: "22",
}), { status: 200 });
await assert.rejects(
  getPrivateOutputStatus(21n),
  /status is incompatible/u,
);
globalThis.fetch = originalFetch;

console.log("private tree delta cache ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
