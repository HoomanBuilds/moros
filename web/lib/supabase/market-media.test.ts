import assert from "node:assert/strict";
import {
  MARKET_BANNER_MAX_BYTES,
  marketBannerPath,
  validateMarketBanner,
} from "./market-media";

assert.equal(validateMarketBanner({ type: "image/png", size: 100 }), null);
assert.match(validateMarketBanner({ type: "image/gif", size: 100 }) ?? "", /JPEG/);
assert.match(validateMarketBanner({ type: "image/png", size: 0 }) ?? "", /empty/);
assert.match(validateMarketBanner({ type: "image/png", size: MARKET_BANNER_MAX_BYTES + 1 }) ?? "", /5 MB/);
assert.equal(
  marketBannerPath("GABC", "market/id", "image/webp", "image id"),
  "GABC/marketid/imageid.webp",
);
assert.equal(marketBannerPath("GABC", "///", "image/png", "id"), null);

console.log("market media ok");
