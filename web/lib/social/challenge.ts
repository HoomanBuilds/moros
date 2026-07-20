import { randomBytes, randomUUID } from "node:crypto";

export const SOCIAL_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type SocialChallenge = {
  id: string;
  message: string;
  expiresAt: string;
};

export function createSocialChallenge(address: string, domain: string, now = new Date()): SocialChallenge {
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SOCIAL_CHALLENGE_TTL_MS).toISOString();
  const nonce = randomBytes(24).toString("hex");
  const message = [
    "Moros wallet sign-in",
    `Domain: ${domain}`,
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expiresAt}`,
    "Statement: Authenticate public social actions. This does not authorize a bet or transfer.",
  ].join("\n");

  return { id: randomUUID(), message, expiresAt };
}

export function isChallengeExpired(expiresAt: string, now = new Date()): boolean {
  const expiry = Date.parse(expiresAt);
  return !Number.isFinite(expiry) || expiry < now.getTime();
}
