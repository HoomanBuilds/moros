import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const CONTRACT_ID = /^C[A-Z2-7]{55}$/;

function save(path, markets) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ format: 1, markets }, null, 2)}\n`,
  );
  renameSync(temporary, path);
}

export class PrivateMarketRegistry {
  constructor({ stateFile, verify }) {
    if (!stateFile || !verify) {
      throw new Error("private market registry configuration is incomplete");
    }
    this.stateFile = stateFile;
    this.verify = verify;
    this.markets = [];
    if (existsSync(stateFile)) {
      const value = JSON.parse(readFileSync(stateFile, "utf8"));
      if (
        value.format !== 1 ||
        !Array.isArray(value.markets) ||
        value.markets.some((market) => !CONTRACT_ID.test(market))
      ) {
        throw new Error("private market registry state is invalid");
      }
      this.markets = [...new Set(value.markets)];
    }
  }

  list() {
    return [...this.markets];
  }

  has(market) {
    return this.markets.includes(market);
  }

  async registerWithStatus(market) {
    if (typeof market !== "string" || !CONTRACT_ID.test(market)) {
      throw new Error("invalid market contract ID");
    }
    await this.verify(market);
    let added = false;
    if (!this.markets.includes(market)) {
      this.markets.push(market);
      this.markets.sort();
      save(this.stateFile, this.markets);
      added = true;
    }
    return { market, added };
  }

  async register(market) {
    return (await this.registerWithStatus(market)).market;
  }
}
