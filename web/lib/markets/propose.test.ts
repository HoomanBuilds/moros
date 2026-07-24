import assert from "node:assert/strict";
import {
  clearPendingProposal,
  getPendingProposal,
  proposalTiming,
} from "./propose";
import type { PrivateDeploymentConfig } from "@/lib/private/client";

const config = {
  marketPolicy: {
    minimumFundingWindow: 3_600,
    minimumOpenWindow: 3_600,
    maximumMarketDuration: 90 * 24 * 60 * 60,
  },
} as PrivateDeploymentConfig;
const now = 1_000_000;

const week = proposalTiming(now + 7 * 24 * 60 * 60, config, now);
assert.equal(week.fundingDeadline, now + 86_400);
assert.equal(
  week.activationCutoff,
  now + 7 * 24 * 60 * 60 - 3_600,
);

const short = proposalTiming(now + 7_560, config, now);
assert.equal(short.fundingDeadline, now + 3_660);
assert.equal(short.activationCutoff, now + 3_960);

assert.throws(
  () => proposalTiming(now + 7_000, config, now),
  /too soon/,
);
assert.throws(
  () => proposalTiming(now + 91 * 24 * 60 * 60, config, now),
  /too soon or too far/,
);

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});
const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const factory = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const otherFactory = "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARQG";
const pending = { address, factoryId: factory };
storage.set(
  `moros.pending-proposal.${factory}.${address}`,
  JSON.stringify(pending),
);
storage.set(
  `moros.pending-proposal.${otherFactory}.${address}`,
  JSON.stringify({ ...pending, factoryId: otherFactory }),
);
assert.equal(getPendingProposal(address, factory)?.factoryId, factory);
assert.equal(getPendingProposal(address, "missing"), null);
clearPendingProposal(address, factory);
assert.equal(getPendingProposal(address, factory), null);

process.stdout.write("market proposal tests passed\n");
