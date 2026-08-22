import assert from "node:assert/strict";
import {
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  bytesToHex,
} from "../src/encoding.mjs";

for (let length = 1; length <= 64; length++) {
  const value = Uint8Array.from({ length }, (_, index) => (index * 17 + length) % 256);
  assert.equal(bytesToHex(value), Buffer.from(value).toString("hex"));
  assert.equal(bytesToBase64(value), Buffer.from(value).toString("base64"));
  const encoded = bytesToBase64Url(value);
  assert.equal(encoded, Buffer.from(value).toString("base64url"));
  assert.deepEqual(base64UrlToBytes(encoded), value);
}
assert.throws(() => base64UrlToBytes("not+url"), /invalid base64url/);
assert.throws(() => base64UrlToBytes("A"), /invalid base64url/);

process.stdout.write("payment encoding tests passed\n");
