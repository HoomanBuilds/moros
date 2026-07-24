import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  decimal,
  invocationResultValue,
  jsonValue,
  merkleTree,
} from "./private-protocol.mjs";

function outputValue(value) {
  return {
    commitment: decimal(value.commitment, "output commitment"),
    leafIndex: Number(value.leaf_index),
    root: decimal(value.root, "output root"),
    actionId: Buffer.from(value.action_id).toString("hex"),
    encryptedOutput: Buffer.from(value.encrypted_output).toString("hex"),
  };
}

function readState(path, vaultId, levels) {
  if (!existsSync(path)) {
    return { format: 1, vaultId, levels, outputs: [] };
  }
  const state = JSON.parse(readFileSync(path, "utf8"));
  if (
    state.format !== 1 ||
    state.vaultId !== vaultId ||
    state.levels !== levels ||
    !Array.isArray(state.outputs)
  ) {
    throw new Error("private index state does not match this vault");
  }
  return {
    ...state,
    outputs: state.outputs.map((output) => ({
      ...output,
      commitment: decimal(output.commitment),
      root: decimal(output.root),
    })),
  };
}

function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify(jsonValue(state), null, 2)}\n`,
  );
  renameSync(temporary, path);
}

export class PrivateOutputIndexer {
  constructor({ client, stateFile, vaultId, levels }) {
    if (!client || !stateFile || !vaultId) {
      throw new Error("private output indexer configuration is incomplete");
    }
    this.client = client;
    this.stateFile = stateFile;
    this.vaultId = vaultId;
    this.levels = levels;
    this.state = readState(stateFile, vaultId, levels);
    this.syncQueue = Promise.resolve();
  }

  sync() {
    const operation = this.syncQueue.then(
      () => this.syncCurrent(),
      () => this.syncCurrent(),
    );
    this.syncQueue = operation.catch(() => {});
    return operation;
  }

  async syncCurrent() {
    const info = invocationResultValue(await this.client.info());
    if (
      Number(info.levels) !== this.levels ||
      Number(info.next_leaf_index) < this.state.outputs.length
    ) {
      throw new Error("vault tree state is incompatible with the local index");
    }
    const nextLeafIndex = Number(info.next_leaf_index);
    const outputs = [...this.state.outputs];
    for (
      let leafIndex = outputs.length;
      leafIndex < nextLeafIndex;
      leafIndex++
    ) {
      const value = invocationResultValue(
        await this.client.output({ index: leafIndex }),
      );
      if (!value) {
        throw new Error(`vault output ${leafIndex} is unavailable`);
      }
      const output = outputValue(value);
      if (output.leafIndex !== leafIndex) {
        throw new Error(`vault output ${leafIndex} has the wrong index`);
      }
      outputs.push(output);
    }
    const tree = merkleTree(
      outputs.map((output) => output.commitment),
      this.levels,
    );
    if (tree.root !== decimal(info.current_root, "current root")) {
      throw new Error("indexed commitments do not reconstruct the vault root");
    }
    this.state = {
      ...this.state,
      outputs,
      currentRoot: tree.root,
      nextLeafIndex,
      updatedAt: new Date().toISOString(),
    };
    saveState(this.stateFile, this.state);
    return this.snapshot();
  }

  snapshot() {
    return jsonValue({
      vaultId: this.vaultId,
      levels: this.levels,
      nextLeafIndex: this.state.outputs.length,
      currentRoot: this.state.currentRoot,
      commitments: this.state.outputs.map((output) => output.commitment),
      outputs: this.state.outputs,
      updatedAt: this.state.updatedAt,
    });
  }
}
