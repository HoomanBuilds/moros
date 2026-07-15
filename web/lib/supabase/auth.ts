"use client";

import { getKit } from "@/lib/wallet";
import { getBrowserClient } from "./client";

const MESSAGE_PREFIX = "Sign in to Moros social - ";

async function resolveAddress(kit: ReturnType<typeof getKit>): Promise<string> {
  try {
    const { address } = await kit.getAddress();
    if (address) return address;
  } catch {
    return (await kit.authModal()).address;
  }
  return (await kit.authModal()).address;
}

export async function signInWithWallet(): Promise<boolean> {
  const client = getBrowserClient();
  if (!client) return false;

  try {
    const kit = getKit();
    const address = await resolveAddress(kit);
    if (!address) return false;

    const message = `${MESSAGE_PREFIX}${new Date().toISOString()}`;
    const { signedMessage } = await kit.signMessage(message, { address });

    const res = await fetch("/api/social-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, signatureBase64: signedMessage, message }),
    });
    if (!res.ok) return false;

    const tokens = await res.json();
    if (!tokens?.access_token || !tokens?.refresh_token) return false;

    const { error } = await client.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });
    return !error;
  } catch {
    return false;
  }
}
