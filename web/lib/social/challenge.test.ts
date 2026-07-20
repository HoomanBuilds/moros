import assert from "node:assert";
import { createSocialChallenge, isChallengeExpired, SOCIAL_CHALLENGE_TTL_MS } from "./challenge.ts";

const now = new Date("2026-07-20T10:00:00.000Z");
const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const challenge = createSocialChallenge(address, "moros-six.vercel.app", now);

assert.match(challenge.id, /^[0-9a-f-]{36}$/);
assert.match(challenge.message, /Domain: moros-six\.vercel\.app/);
assert.match(challenge.message, new RegExp(`Address: ${address}`));
assert.match(challenge.message, /Nonce: [0-9a-f]{48}/);
assert.equal(Date.parse(challenge.expiresAt) - now.getTime(), SOCIAL_CHALLENGE_TTL_MS);
assert.equal(isChallengeExpired(challenge.expiresAt, now), false);
assert.equal(isChallengeExpired(challenge.expiresAt, new Date(Date.parse(challenge.expiresAt) + 1)), true);
assert.equal(isChallengeExpired("bad date", now), true);

const second = createSocialChallenge(address, "moros-six.vercel.app", now);
assert.notEqual(second.id, challenge.id);
assert.notEqual(second.message, challenge.message);

console.log("social challenge ok");
