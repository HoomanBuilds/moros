import assert from "node:assert/strict";
import { nativeToScVal } from "@stellar/stellar-sdk";
import {
  FixedWindowRateLimiter,
  decodeRelayRequest,
} from "./private-relayer.mjs";

const argument = nativeToScVal(5n, { type: "u64" }).toXDR("base64");
const request = decodeRelayRequest({
  method: "private_transfer",
  args: [argument, argument, argument],
});
assert.equal(request.method, "private_transfer");
assert.equal(request.args.length, 3);
assert.throws(
  () => decodeRelayRequest({ method: "deposit", args: [] }),
  /unsupported/,
);
assert.throws(
  () => decodeRelayRequest({
    method: "private_transfer",
    args: [argument],
  }),
  /unsupported/,
);
assert.throws(
  () => decodeRelayRequest({
    method: "private_transfer",
    args: ["bad", argument, argument],
  }),
  /invalid relay argument/,
);

const limiter = new FixedWindowRateLimiter({ limit: 2, windowMs: 1_000 });
assert.equal(limiter.take("client", 1_000).allowed, true);
assert.equal(limiter.take("client", 1_001).allowed, true);
assert.equal(limiter.take("client", 1_002).allowed, false);
assert.equal(limiter.take("client", 2_000).allowed, true);

process.stdout.write("private relayer tests passed\n");
