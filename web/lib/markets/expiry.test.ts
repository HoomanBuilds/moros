import assert from "node:assert";
import {
  MIN_MARKET_LEAD_SECONDS,
  marketExpiryError,
  parseMarketExpiry,
  presetExpiryLocal,
  toLocalDateTimeValue,
} from "./expiry.ts";

const now = new Date(2030, 0, 10, 12, 0, 0, 0).getTime();
const oneHour = presetExpiryLocal(60 * 60, now);
assert.equal(parseMarketExpiry(oneHour, now), Math.floor(now / 1000) + 60 * 60);
assert.equal(toLocalDateTimeValue(new Date(parseMarketExpiry(oneHour, now) * 1000)), oneHour);

const tooSoon = toLocalDateTimeValue(new Date(now + (MIN_MARKET_LEAD_SECONDS - 60) * 1000));
assert.match(marketExpiryError(tooSoon, now), /at least 15 minutes/);

const longDuration = toLocalDateTimeValue(new Date(2045, 6, 20, 8, 45, 0, 0));
assert.equal(parseMarketExpiry(longDuration, now), Math.floor(new Date(2045, 6, 20, 8, 45, 0, 0).getTime() / 1000));
assert.match(marketExpiryError("2030-02-31T10:00", now), /valid local date/);
assert.match(marketExpiryError("", now), /exact settlement/);
assert.throws(() => presetExpiryLocal(60, now), /Invalid settlement shortcut/);

console.log("market expiry ok");
