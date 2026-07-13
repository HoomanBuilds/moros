"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { isWatched, toggleWatch } from "@/lib/supabase/watchlist";
import { getKit } from "@/lib/wallet";

export function WatchButton({ marketId }: { marketId: string }) {
  const enabled = !!getBrowserClient();
  const [address, setAddress] = useState<string | null>(null);
  const [watched, setWatched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function load() {
      const client = getBrowserClient();
      if (!client) return;
      const { data } = await client.auth.getSession();
      if (!data.session) return;
      try {
        const { address: addr } = await getKit().getAddress();
        if (cancelled || !addr) return;
        setAddress(addr);
        const w = await isWatched(addr, marketId);
        if (!cancelled) setWatched(w);
      } catch {
        return;
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [enabled, marketId]);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!address || busy) return;
    setBusy(true);
    const next = await toggleWatch(address, marketId);
    setWatched(next);
    setBusy(false);
  }

  if (!enabled || !address) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
      aria-pressed={watched}
      className="text-lg leading-none disabled:opacity-50"
      style={{ color: watched ? "#eca8d6" : "rgba(255,255,255,0.3)" }}
    >
      {watched ? "★" : "☆"}
    </button>
  );
}
