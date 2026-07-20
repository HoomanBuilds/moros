import assert from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LMSR_B, MARKET_SUBSIDY, REDEEM_VK } from "./deploy-constants.ts";

const shareScale = 1n << 32n;
const collateralScale = 10_000_000n;
const expectedSubsidy = BigInt(Math.ceil(20 * Math.log(2) * Number(collateralScale)));

assert.equal(BigInt(LMSR_B), 20n * shareScale);
assert.equal(BigInt(MARKET_SUBSIDY), expectedSubsidy);
assert.ok(BigInt(MARKET_SUBSIDY) < 20n * collateralScale);

const repo = resolve(process.cwd(), "..");
assert.equal(
  readFileSync(resolve(repo, "web/public/zk/position_redeem_vk.json"), "utf8"),
  readFileSync(resolve(repo, "contracts/shielded-pool/circuits/build/position_redeem_vk.json"), "utf8"),
);
assert.match(REDEEM_VK, /^[0-9a-f]+$/);
assert.equal(REDEEM_VK.length, 3464);
assert.equal(
  createHash("sha256").update(Buffer.from(REDEEM_VK, "hex")).digest("hex"),
  "27b7f5fb681e899b71599546605b271f02579c920c52fada8f8f425185a83129",
);

console.log("deployment economics and redemption key ok");
