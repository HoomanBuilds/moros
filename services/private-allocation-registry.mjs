import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { jsonValue } from "./private-protocol.mjs";

const CONTRACT_ID = /^C[A-Z2-7]{55}$/;
const DECIMAL = /^[0-9]+$/;

function valid(record) {
  return record &&
    CONTRACT_ID.test(record.market) &&
    DECIMAL.test(String(record.epoch)) &&
    DECIMAL.test(String(record.positionCommitment)) &&
    Array.isArray(record.envelope) &&
    record.envelope.length === 20 &&
    record.envelope.every((value) => DECIMAL.test(String(value)));
}

function key(record) {
  return `${record.market}:${record.epoch}:${record.positionCommitment}`;
}

function save(path, records) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ format: 1, records: jsonValue(records) }, null, 2)}\n`,
  );
  renameSync(temporary, path);
}

export class PrivateAllocationRegistry {
  constructor({ stateFile }) {
    if (!stateFile) {
      throw new Error("private allocation registry configuration is incomplete");
    }
    this.stateFile = stateFile;
    this.records = new Map();
    if (!existsSync(stateFile)) return;
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    if (
      state.format !== 1 ||
      !Array.isArray(state.records) ||
      state.records.some((record) => !valid(record))
    ) {
      throw new Error("private allocation registry state is invalid");
    }
    for (const record of state.records) {
      this.records.set(key(record), record);
    }
  }

  putMany(records) {
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error("private allocation package list is empty");
    }
    if (records.some((record) => !valid(jsonValue(record)))) {
      throw new Error("private allocation package is invalid");
    }
    for (const record of records.map(jsonValue)) {
      const id = key(record);
      const existing = this.records.get(id);
      if (
        existing &&
        JSON.stringify(existing.envelope) !== JSON.stringify(record.envelope)
      ) {
        throw new Error("private allocation package changed after publication");
      }
      this.records.set(id, record);
    }
    save(this.stateFile, [...this.records.values()]);
  }

  get(market, epoch, positionCommitment) {
    const query = { market, epoch: String(epoch), positionCommitment: String(positionCommitment) };
    if (!valid({ ...query, envelope: Array(20).fill("0") })) {
      throw new Error("invalid private allocation lookup");
    }
    const record = this.records.get(key(query));
    return record ? structuredClone(record) : undefined;
  }
}
