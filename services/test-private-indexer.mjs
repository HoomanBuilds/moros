import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PrivateOutputIndexer } from "./private-indexer.mjs";
import { merkleTree } from "./private-protocol.mjs";

const directory = mkdtempSync(resolve(tmpdir(), "moros-private-indexer-"));
const stateFile = resolve(directory, "outputs.json");
const commitments = [11n, 12n, 13n, 14n];
const root = merkleTree(commitments, 8).root;
const records = commitments.map((commitment, leafIndex) => ({
  commitment,
  leaf_index: leafIndex,
  root,
  action_id: Buffer.alloc(32, leafIndex + 1),
  encrypted_output: Buffer.alloc(128, leafIndex + 2),
}));
let outputReads = 0;
const client = {
  info: async () => ({
    result: {
      levels: 8,
      next_leaf_index: records.length,
      current_root: root,
    },
  }),
  output: async ({ index }) => {
    outputReads++;
    return { result: records[index] };
  },
};

try {
  const indexer = new PrivateOutputIndexer({
    client,
    stateFile,
    vaultId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    levels: 8,
  });
  const first = await indexer.sync();
  assert.equal(outputReads, 4);
  assert.equal(first.currentRoot, root.toString());
  assert.deepEqual(
    first.commitments,
    commitments.map((value) => value.toString()),
  );
  assert.equal(first.outputs.length, 4);
  assert.equal(first.outputs[0].actionId, "01".repeat(32));

  const concurrentStateFile = resolve(directory, "concurrent-outputs.json");
  let concurrentReads = 0;
  const concurrent = new PrivateOutputIndexer({
    client: {
      ...client,
      output: async ({ index }) => {
        concurrentReads++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { result: records[index] };
      },
    },
    stateFile: concurrentStateFile,
    vaultId: "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARQG",
    levels: 8,
  });
  const concurrentSnapshots = await Promise.all([
    concurrent.sync(),
    concurrent.sync(),
    concurrent.sync(),
  ]);
  assert.equal(concurrentReads, 4);
  assert.ok(concurrentSnapshots.every((snapshot) =>
    snapshot.currentRoot === root.toString() &&
    snapshot.outputs.length === 4
  ));
  assert.equal(
    JSON.parse(readFileSync(concurrentStateFile, "utf8")).outputs.length,
    4,
  );

  const resumed = new PrivateOutputIndexer({
    client,
    stateFile,
    vaultId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    levels: 8,
  });
  await resumed.sync();
  assert.equal(outputReads, 4, "resume must not reread indexed outputs");
  assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).outputs.length, 4);

  const broken = new PrivateOutputIndexer({
    client: {
      ...client,
      info: async () => ({
        result: {
          levels: 8,
          next_leaf_index: 4,
          current_root: root + 1n,
        },
      }),
    },
    stateFile,
    vaultId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    levels: 8,
  });
  await assert.rejects(() => broken.sync(), /do not reconstruct/);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

process.stdout.write("private indexer tests passed\n");
