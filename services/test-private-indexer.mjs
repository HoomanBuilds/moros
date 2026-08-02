import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
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
  assert.equal(first.fromLeafIndex, 0);
  assert.equal(first.baseRoot, undefined);
  const delta = indexer.snapshot(2);
  assert.equal(delta.fromLeafIndex, 2);
  assert.equal(delta.baseRoot, root.toString());
  assert.deepEqual(delta.commitments, ["13", "14"]);
  assert.deepEqual(delta.outputs.map((output) => output.leafIndex), [2, 3]);
  assert.equal(indexer.output("13")?.leafIndex, 2);
  assert.equal(indexer.output("99"), undefined);
  assert.equal(indexer.size(), 4);
  assert.throws(() => indexer.snapshot(5), /offset is invalid/u);
  const firstState = readFileSync(stateFile, "utf8");
  const unchanged = await indexer.sync();
  assert.equal(unchanged.updatedAt, first.updatedAt);
  assert.equal(readFileSync(stateFile, "utf8"), firstState);
  await assert.rejects(() => indexer.sync(0, -1), /sync age is invalid/u);

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

  const corruptedStateFile = resolve(directory, "corrupted-outputs.json");
  const corruptedState = JSON.parse(firstState);
  corruptedState.outputs[0].commitment = "99";
  writeFileSync(corruptedStateFile, JSON.stringify(corruptedState));
  assert.throws(
    () => new PrivateOutputIndexer({
      client,
      stateFile: corruptedStateFile,
      vaultId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      levels: 8,
    }),
    /does not reconstruct its stored root/u,
  );

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
