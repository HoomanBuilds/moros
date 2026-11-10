import assert from "node:assert/strict";
import { allowedWebOrigins, responseCorsHeaders } from "./http-cors.mjs";
const origins = allowedWebOrigins();
for (const origin of ["https://moros.fun", "https://www.moros.fun", "https://pay.moros.fun"]) {
  assert.equal(origins.has(origin), true);
  assert.equal(responseCorsHeaders({ headers: { origin } }, origins)["access-control-allow-origin"], origin);
}
assert.deepEqual(responseCorsHeaders({ headers: { origin: "https://untrusted.example" } }, origins), {});
assert.deepEqual(responseCorsHeaders({ headers: {} }, origins), {});
assert.deepEqual([...allowedWebOrigins("https://example.com/,https://example.com/path")], ["https://example.com"]);
assert.throws(() => allowedWebOrigins("not a URL"));
console.log("HTTP CORS tests passed");
