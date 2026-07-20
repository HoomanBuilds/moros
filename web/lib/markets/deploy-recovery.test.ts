import assert from "node:assert";
import {
  clearPendingDeployment,
  getPendingDeployment,
  type PendingDeployment,
} from "./deploy.ts";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});

const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const deployment: PendingDeployment = {
  version: 3,
  address,
  asset: "BTC",
  strikeUsd: 100_000,
  expiryUnix: 2_000_000_000,
  resolverType: "price",
  resolverId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  metadata: { title: "Will BTC close above the strike?", category: "Crypto price" },
  marketWasmHash: "a".repeat(64),
  poolWasmHash: "b".repeat(64),
  marketId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  funded: true,
};

localStorage.setItem(`moros.pending-market.v3.${address}`, JSON.stringify(deployment));
assert.deepEqual(getPendingDeployment(address), deployment);
assert.equal(getPendingDeployment("GOTHER"), null);

localStorage.setItem(`moros.pending-market.v3.${address}`, "not-json");
assert.equal(getPendingDeployment(address), null);

localStorage.setItem(`moros.pending-market.v3.${address}`, JSON.stringify(deployment));
clearPendingDeployment(address);
assert.equal(getPendingDeployment(address), null);

console.log("deployment recovery ok");
