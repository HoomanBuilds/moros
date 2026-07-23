import assert from "node:assert/strict";
import {
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

process.stdout.write("market proposal tests passed\n");
