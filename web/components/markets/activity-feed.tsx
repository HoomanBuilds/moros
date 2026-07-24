"use client";
import { ExternalLink } from "lucide-react";
import { useOrders } from "@/lib/stellar/use-orders";
import { formatAgo } from "@/lib/stellar/derive";
import { Panel } from "@/components/app/app-kit";
import { useActiveMarket } from "@/lib/markets/market-context";
import { NETWORK } from "@/lib/network";

function shortHash(hex: string): string {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

export function ActivityFeed() {
  const { data: orders, isLoading, isError } = useOrders();
  const { poolId } = useActiveMarket();

  return (
    <Panel className="p-6 space-y-5">
      <div className="space-y-1">
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Shielded activity
        </span>
        <p className="text-sm text-muted-foreground">
          Every order is an on-chain commitment with an encrypted payload. The side and quantity stay out of public plaintext.
        </p>
      </div>

      {isLoading ? (
        <p className="font-mono text-sm text-muted-foreground">Reading on-chain orders…</p>
      ) : isError ? (
        <p className="font-mono text-sm text-muted-foreground">Activity is momentarily unavailable.</p>
      ) : !orders || orders.length === 0 ? (
        <p className="font-mono text-sm text-muted-foreground">No shielded orders yet. Be the first.</p>
      ) : (
        <div className="divide-y divide-foreground/10">
          {orders.map((o) => (
            <a
              key={o.index}
              href={NETWORK.explorer(poolId)}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center justify-between gap-4 py-3 transition-colors hover:bg-foreground/[0.03]"
            >
              <div className="flex items-center gap-4">
                <span className="font-mono text-xs text-muted-foreground">#{o.index}</span>
                <span className="font-mono text-sm">{shortHash(o.commitment)}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">{formatAgo(o.at)}</span>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            </a>
          ))}
        </div>
      )}
    </Panel>
  );
}
