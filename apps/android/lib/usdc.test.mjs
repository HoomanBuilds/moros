import assert from "node:assert/strict";

const { formatUsdcAtomic, parseUsdcAtomic } = await import(new URL("./usdc.ts", import.meta.url).href);

assert.equal(parseUsdcAtomic("1"), 10_000_000n);
assert.equal(parseUsdcAtomic("0.0000001"), 1n);
assert.equal(parseUsdcAtomic("12.3400000"), 123_400_000n);
assert.equal(formatUsdcAtomic(123_400_000n), "12.34");
assert.equal(formatUsdcAtomic(0n), "0");
assert.equal(formatUsdcAtomic(null), "--");
assert.throws(() => parseUsdcAtomic("0"), /greater than zero/);
assert.throws(() => parseUsdcAtomic("1.00000001"), /valid USDC amount/);
assert.throws(() => parseUsdcAtomic("-1"), /valid USDC amount/);
assert.throws(() => parseUsdcAtomic("1e3"), /valid USDC amount/);

console.log("USDC amount tests passed");
