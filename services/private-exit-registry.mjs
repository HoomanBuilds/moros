import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const CONTRACT_ID = /^C[A-Z2-7]{55}$/;
const EXIT_ID = /^[0-9a-f]{64}$/;
const MAX_EXITS = 10_000;

function valid(entry) {
  return entry &&
    CONTRACT_ID.test(entry.market) &&
    CONTRACT_ID.test(entry.liquidityVault) &&
    EXIT_ID.test(entry.exitId);
}

function save(path, exits) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ format: 1, exits }, null, 2)}\n`,
  );
  renameSync(temporary, path);
}

export class PrivateExitRegistry {
  constructor({ stateFile, verify }) {
    if (!stateFile || !verify) {
      throw new Error("private exit registry configuration is incomplete");
    }
    this.stateFile = stateFile;
    this.verify = verify;
    this.exits = [];
    if (existsSync(stateFile)) {
      const value = JSON.parse(readFileSync(stateFile, "utf8"));
      if (
        value.format !== 1 ||
        !Array.isArray(value.exits) ||
        value.exits.length > MAX_EXITS ||
        value.exits.some((entry) => !valid(entry))
      ) {
        throw new Error("private exit registry state is invalid");
      }
      this.exits = value.exits.filter((entry, index, entries) =>
        entries.findIndex((candidate) =>
          candidate.liquidityVault === entry.liquidityVault &&
          candidate.exitId === entry.exitId
        ) === index
      );
    }
  }

  list() {
    return this.exits.map((entry) => ({ ...entry }));
  }

  async register(entry) {
    if (!valid(entry)) throw new Error("invalid private liquidity exit");
    const verified = await this.verify({ ...entry });
    if (
      !valid(verified) ||
      verified.market !== entry.market ||
      verified.liquidityVault !== entry.liquidityVault ||
      verified.exitId !== entry.exitId
    ) {
      throw new Error("private liquidity exit verification failed");
    }
    const existing = this.exits.find((candidate) =>
      candidate.liquidityVault === entry.liquidityVault &&
      candidate.exitId === entry.exitId
    );
    if (existing) {
      if (
        existing.market !== entry.market ||
        existing.liquidityVault !== entry.liquidityVault
      ) {
        throw new Error("private liquidity exit addresses changed");
      }
      return { ...existing };
    }
    if (this.exits.length >= MAX_EXITS) {
      throw new Error("private liquidity exit registry is full");
    }
    this.exits.push(verified);
    this.exits.sort((left, right) =>
      left.liquidityVault.localeCompare(right.liquidityVault) ||
      left.exitId.localeCompare(right.exitId)
    );
    save(this.stateFile, this.exits);
    return { ...verified };
  }
}
