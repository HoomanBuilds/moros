import assert from "node:assert/strict";
import { normalizeProductUrl, productUrls } from "./product-urls";

assert.equal(normalizeProductUrl("https://pay.moros.fun/", "https://fallback.example"), "https://pay.moros.fun");
assert.equal(normalizeProductUrl("http://127.0.0.1:3010/", "https://fallback.example"), "http://127.0.0.1:3010");
assert.equal(normalizeProductUrl("https://pay.moros.fun/app/send?draft=1#confirm", "https://fallback.example"), "https://pay.moros.fun");
assert.equal(normalizeProductUrl("http://unsafe.example", "https://fallback.example"), "https://fallback.example");
assert.equal(normalizeProductUrl("ftp://localhost/app", "https://fallback.example"), "https://fallback.example");
assert.equal(normalizeProductUrl("not a URL", "https://fallback.example"), "https://fallback.example");
assert.equal(productUrls.brand, "https://moros.fun");
assert.equal(productUrls.pay, "https://pay.moros.fun");
assert.equal(productUrls.predict, "https://predict.moros.fun");

console.log("payment product URL tests passed");
