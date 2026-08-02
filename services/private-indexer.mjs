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
  const normalized = {
    ...state,
    outputs: state.outputs.map((output) => ({
      ...output,
      commitment: decimal(output.commitment),
      root: decimal(output.root),
    })),
  };
  if (
    normalized.currentRoot === undefined ||
    (
      normalized.nextLeafIndex !== undefined &&
      Number(normalized.nextLeafIndex) !== normalized.outputs.length
    ) ||
    merkleTree(
      normalized.outputs.map((output) => output.commitment),
      levels,
    ).root !== decimal(normalized.currentRoot)
  ) {
    throw new Error("private index state does not reconstruct its stored root");
  }
  return normalized;
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
    this.syncPending = null;
    this.lastCheckedAt = 0;
  }

  async sync(fromLeafIndex = 0, maximumAgeMs = 0) {
    if (!Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 0) {
      throw new Error("private output sync age is invalid");
    }
    const fresh = maximumAgeMs > 0 &&
      Date.now() - this.lastCheckedAt <= maximumAgeMs;
    if (!fresh) {
      if (!this.syncPending) {
        const operation = this.syncQueue.then(
          () => this.syncCurrent(),
          () => this.syncCurrent(),
        );
        this.syncPending = operation.finally(() => {
          this.syncPending = null;
        });
        this.syncQueue = this.syncPending.catch(() => {});
      }
      await this.syncPending;
    }
    return this.snapshot(fromLeafIndex);
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
    const currentRoot = decimal(info.current_root, "current root");
    if (
      nextLeafIndex === this.state.outputs.length &&
      this.state.currentRoot !== undefined
    ) {
      if (decimal(this.state.currentRoot) !== currentRoot) {
        throw new Error("indexed commitments do not reconstruct the vault root");
      }
      this.lastCheckedAt = Date.now();
      return;
    }
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
    if (tree.root !== currentRoot) {
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
    this.lastCheckedAt = Date.now();
  }

  size() {
    return this.state.outputs.length;
  }

  snapshot(fromLeafIndex = 0) {
    if (
      !Number.isSafeInteger(fromLeafIndex) ||
      fromLeafIndex < 0 ||
      fromLeafIndex > this.state.outputs.length
    ) {
      throw new Error("private output offset is invalid");
    }
    const outputs = this.state.outputs.slice(fromLeafIndex);
    return jsonValue({
      vaultId: this.vaultId,
      levels: this.levels,
      fromLeafIndex,
      baseRoot: fromLeafIndex === 0
        ? undefined
        : this.state.outputs[fromLeafIndex - 1].root,
      nextLeafIndex: this.state.outputs.length,
      currentRoot: this.state.currentRoot,
      commitments: outputs.map((output) => output.commitment),
      outputs,
      updatedAt: this.state.updatedAt,
    });
  }

  output(commitment) {
    const value = decimal(commitment, "output commitment");
    return this.state.outputs.find((output) => output.commitment === value);
  }
}
