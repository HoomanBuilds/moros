import assert from "node:assert/strict";
import {
  EVENT_CATEGORIES,
  FREE_RESOLVABLE_ASSETS,
  MARKET_CATEGORIES,
  PYTH_PRO_RESOLVABLE_ASSETS,
  assetsForCategory,
  eventGuidance,
  isPriceCategory,
} from "./categories";

assert.equal(new Set(FREE_RESOLVABLE_ASSETS).size, FREE_RESOLVABLE_ASSETS.length);
assert.equal(new Set(MARKET_CATEGORIES).size, MARKET_CATEGORIES.length);
assert.equal(isPriceCategory("Crypto price"), true);
assert.equal(isPriceCategory("Sports"), false);
assert.deepEqual(assetsForCategory("Gold price"), ["XAU"]);
assert.ok(assetsForCategory("FX").includes("EUR"));
assert.deepEqual(assetsForCategory("Sports"), []);
assert.ok(assetsForCategory("FX", "pyth_pro").includes("GBP"));
assert.equal(assetsForCategory("FX", "pyth_pro").includes("CHF"), false);
assert.ok(PYTH_PRO_RESOLVABLE_ASSETS.every((asset) => FREE_RESOLVABLE_ASSETS.includes(asset)));
assert.ok(EVENT_CATEGORIES.every((category) => eventGuidance(category).source.startsWith("https://")));

console.log("market categories ok");
