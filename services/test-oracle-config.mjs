import assert from "node:assert/strict";
import {
  FREE_REFLECTOR_ASSETS,
  PYTH_PRO_FEEDS,
  REFLECTOR_CEX_ASSETS,
  REFLECTOR_FIAT_ASSETS,
  resolvableAssets,
} from "./oracle-config.mjs";

assert.equal(new Set(FREE_REFLECTOR_ASSETS).size, FREE_REFLECTOR_ASSETS.length);
assert.deepEqual(FREE_REFLECTOR_ASSETS, [...REFLECTOR_CEX_ASSETS, ...REFLECTOR_FIAT_ASSETS]);
assert.ok(["BTC", "XLM", "EUR", "CHF", "XAU"].every((asset) => resolvableAssets("free").has(asset)));
assert.ok(["BTC", "EUR", "GBP", "XAU"].every((asset) => resolvableAssets("pyth_pro").has(asset)));
assert.equal(resolvableAssets("pyth_pro").has("CHF"), false);
assert.ok(Object.values(PYTH_PRO_FEEDS).every((feedId) => Number.isInteger(feedId) && feedId > 0));

console.log("oracle config ok");
