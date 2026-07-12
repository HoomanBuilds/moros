"use client";
import { useEffect, useState } from "react";
import { ACCENT, EmptyState, Panel, Tag } from "@/components/app/app-kit";
import { getKit, truncate } from "@/lib/wallet";
import { listPositions, type Position } from "@/lib/positions/book";
import { useMarket } from "@/lib/stellar/use-market";

const SIDE_STYLE: Record<string, { label: string; color: string }> = {
  "1": { label: "YES", color: "#16c784" },
  "0": { label: "NO", color: "#f0564a" },
};

export function PositionsList() {
  const [address, setAddress] = useState("");
  const [positions, setPositions] = useState<Position[]>([]);
  const { data } = useMarket();
  const resolved = data ? data.outcome !== "LIVE" : false;

  useEffect(() => {
    getKit()
      .getAddress()
      .then((r) => {
        setAddress(r.address);
        setPositions(listPositions(r.address));
      })
      .catch(() => {});
  }, []);

  if (!address || positions.length === 0) {
    return (
      <EmptyState
        title="No positions yet"
        description="Place a private bet on a market."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {positions.map((p) => {
          const side = SIDE_STYLE[p.side] ?? { label: p.side, color: ACCENT };
          const claimable = resolved && p.status !== "redeemed";
          return (
            <Panel key={p.commitment} className="p-6 flex flex-wrap items-center gap-4 justify-between">
              <div className="flex items-center gap-4">
                <span
                  className="text-sm font-mono uppercase tracking-wider"
                  style={{ color: side.color }}
                >
                  {side.label}
                </span>
                <span className="text-sm">{p.amount} XLM</span>
                <span className="text-xs font-mono text-muted-foreground">{truncate(p.commitment)}</span>
              </div>
              <div className="flex items-center gap-3">
                <Tag>{p.status}</Tag>
                {claimable && (
                  <span
                    className="text-xs font-mono uppercase tracking-wider px-2 py-0.5 rounded border"
                    style={{ borderColor: ACCENT, color: ACCENT }}
                  >
                    Claimable
                  </span>
                )}
              </div>
            </Panel>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        Positions are stored only in this browser. Export a backup so you can always redeem.
      </p>
    </div>
  );
}
