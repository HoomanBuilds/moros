"use client";

import { getKit } from "@/lib/wallet";
import { getBrowserClient } from "./client";

export type SocialAuthResult = { ok: true } | { ok: false; error: string };

async function resolveAddress(kit: ReturnType<typeof getKit>): Promise<string> {
  try {
    const { address } = await kit.getAddress();
    if (address) return address;
  } catch {
    return (await kit.authModal()).address;
  }
  return (await kit.authModal()).address;
}

async function responseError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return typeof data?.error === "string" ? data.error : fallback;
}

export async function signInWithWallet(expectedAddress?: string): Promise<SocialAuthResult> {
  const client = getBrowserClient();
  if (!client) return { ok: false, error: "Comments are not configured." };

  try {
    const kit = getKit();
    const address = await resolveAddress(kit);
    if (!address) return { ok: false, error: "Connect a Stellar wallet first." };
    if (expectedAddress && address !== expectedAddress) {
      return { ok: false, error: "The selected wallet changed. Try again with the connected wallet." };
    }

    const challengeRes = await fetch("/api/social-auth/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    if (!challengeRes.ok) {
      return { ok: false, error: await responseError(challengeRes, "Could not start wallet sign-in.") };
    }
    const challenge = await challengeRes.json();
    if (typeof challenge?.id !== "string" || typeof challenge?.message !== "string") {
      return { ok: false, error: "The sign-in challenge was invalid." };
    }

    const { signedMessage } = await kit.signMessage(challenge.message, { address });

    const res = await fetch("/api/social-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, signatureBase64: signedMessage, challengeId: challenge.id }),
    });
    if (!res.ok) return { ok: false, error: await responseError(res, "Wallet sign-in failed.") };

    const tokens = await res.json();
    if (!tokens?.access_token || !tokens?.refresh_token) {
      return { ok: false, error: "The social session could not be created." };
    }

    const { error } = await client.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Wallet sign-in was canceled.";
    return { ok: false, error: message };
  }
}
