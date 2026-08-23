import assert from "node:assert/strict";
import { normalizeProductUrl } from "./product-urls";

assert.equal(normalizeProductUrl("https://predict.moros.fun/", "https://fallback.example"), "https://predict.moros.fun");
assert.equal(normalizeProductUrl("http://localhost:3000/", "https://fallback.example"), "http://localhost:3000");
assert.equal(normalizeProductUrl("https://predict.moros.fun/app?tab=live#market", "https://fallback.example"), "https://predict.moros.fun");
assert.equal(normalizeProductUrl("http://unsafe.example", "https://fallback.example"), "https://fallback.example");
assert.equal(normalizeProductUrl("ftp://localhost/app", "https://fallback.example"), "https://fallback.example");
assert.equal(normalizeProductUrl(undefined, "https://fallback.example"), "https://fallback.example");

console.log("prediction product URL tests passed");
