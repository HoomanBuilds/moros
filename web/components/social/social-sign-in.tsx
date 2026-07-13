"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { signInWithWallet } from "@/lib/supabase/auth";

export function SocialSignIn({ onSignedIn }: { onSignedIn?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signIn() {
    setLoading(true);
    setFailed(false);
    const ok = await signInWithWallet();
    setLoading(false);
    if (ok) {
      onSignedIn?.();
    } else {
      setFailed(true);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" disabled={loading} onClick={signIn} className="font-mono text-xs">
        {loading && <Spinner className="size-3" />}
        {loading ? "Signing in" : "Sign in with your wallet to comment"}
      </Button>
      {failed && (
        <p className="text-sm" style={{ color: "#f0564a" }}>
          Sign-in failed - try again.
        </p>
      )}
    </div>
  );
}
