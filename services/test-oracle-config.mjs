import assert from "node:assert/strict";
import {
  FREE_REFLECTOR_ASSETS,
  PYTH_PRO_FEEDS,
  REFLECTOR_CEX_ASSETS,
  REFLECTOR_FIAT_ASSETS,
  resolutionPhase,
  resolvableAssets,
  selectFreeResolver,
} from "./oracle-config.mjs";

assert.equal(new Set(FREE_REFLECTOR_ASSETS).size, FREE_REFLECTOR_ASSETS.length);
assert.deepEqual(FREE_REFLECTOR_ASSETS, [...REFLECTOR_CEX_ASSETS, ...REFLECTOR_FIAT_ASSETS]);
assert.ok(["BTC", "XLM", "EUR", "CHF", "XAU"].every((asset) => resolvableAssets("free").has(asset)));
assert.ok(["BTC", "EUR", "GBP", "XAU"].every((asset) => resolvableAssets("pyth_pro").has(asset)));
assert.equal(resolvableAssets("pyth_pro").has("CHF"), false);
assert.ok(Object.values(PYTH_PRO_FEEDS).every((feedId) => Number.isInteger(feedId) && feedId > 0));
assert.equal(resolutionPhase(999, 1_000, 1_300, 3_600), "open");
assert.equal(resolutionPhase(1_000, 1_000, 1_300, 3_600), "final_batch");
assert.equal(resolutionPhase(1_300, 1_000, 1_300, 3_600), "resolve");
assert.equal(resolutionPhase(4_900, 1_000, 1_300, 3_600), "void");
assert.throws(() => resolutionPhase(1, 2, 1, 300), /invalid resolution timing/);
const deployedResolver = `C${"A".repeat(55)}`;
assert.equal(
  selectFreeResolver({ contracts: { resolver: deployedResolver } }),
  deployedResolver,
);
assert.throws(() => selectFreeResolver(undefined), /invalid/);

console.log("oracle config ok");
