import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const fixture = JSON.parse(read("fixtures/baseline/platform-hardening.json"));

assert.equal(fixture.network, "testnet");
assert.equal(fixture.collateral.asset, "Circle USDC");
assert.equal(fixture.collateral.decimals, 7);
assert.match(fixture.collateral.sac, /^C[A-Z2-7]{55}$/);

const market = read("contracts/lmsr-market/src/lib.rs");
assert.match(market, /pub fn fund\(env: Env, from: Address, amount: i128\)/);
assert.match(market, /if from != admin/);
assert.match(market, /sponsor_refund: funding/);

const pool = read("contracts/shielded-pool/contract/src/lib.rs");
assert.match(pool, /pub owner: Address/);
assert.match(pool, /batch_len != BATCH_N/);
assert.match(pool, /set\(&PRICE_KEY, &price\)/);
assert.match(pool, /if proof_fee_bps != fee_bps as i128/);
assert.match(pool, /tok\.transfer\(&me, &treasury, &fee\)/);

const backup = read("web/supabase/migrations/20260720070000_private_position_backups.sql");
for (const column of fixture.plaintextBackupColumns) {
  assert.match(backup, new RegExp(`\\b${column}\\b`));
}

console.log("legacy baseline ok");
