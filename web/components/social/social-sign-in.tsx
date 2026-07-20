"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { signInWithWallet } from "@/lib/supabase/auth";
import { connectWallet, useWalletAddress } from "@/lib/wallet-store";
import { truncate } from "@/lib/wallet";

export function SocialSignIn({ onSignedIn }: { onSignedIn?: (address: string) => void }) {
  const address = useWalletAddress();
  const [phase, setPhase] = useState<"idle" | "connecting" | "signing">("idle");
  const [error, setError] = useState("");

  async function signIn() {
    setError("");
    let activeAddress = address;
    try {
      if (!activeAddress) {
        setPhase("connecting");
        activeAddress = await connectWallet();
      }
      setPhase("signing");
      const result = await signInWithWallet(activeAddress);
      setPhase("idle");
      if (result.ok) {
        onSignedIn?.(activeAddress);
      } else {
        setError(result.error);
      }
    } catch (cause) {
      setPhase("idle");
      setError(cause instanceof Error ? cause.message : "Wallet sign-in was canceled.");
    }
  }

  const loading = phase !== "idle";
  const label = phase === "connecting"
    ? "Connecting wallet"
    : phase === "signing"
      ? "Waiting for signature"
      : address
        ? `Sign in ${truncate(address)}`
        : "Connect wallet to continue";

  return (
    <div className="space-y-2">
      <Button variant="outline" disabled={loading} onClick={signIn} className="font-mono text-xs">
        {loading && <Spinner className="size-3" />}
        {label}
      </Button>
      {error && (
        <p className="text-sm" style={{ color: "#f0564a" }}>
          {error}
        </p>
      )}
    </div>
  );
}
