"use client";
import { useEffect, useState } from "react";
import { ACCENT, EmptyState, Panel, Tag } from "@/components/app/app-kit";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { truncate } from "@/lib/wallet";
import { useWalletAddress } from "@/lib/wallet-store";
import { listPositions, updateStatus, type Position } from "@/lib/positions/book";
import { findMarket } from "@/lib/markets/registry";
import { useMarket } from "@/lib/stellar/use-market";
import { runRedeem, type RedeemStage } from "@/lib/redeem/flow";
import { NETWORK } from "@/lib/network";

const SIDE_STYLE: Record<string, { label: string; color: string }> = {
  "1": { label: "YES", color: "#16c784" },
  "0": { label: "NO", color: "#f0564a" },
};

const REDEEM_STAGES: { key: RedeemStage; label: string }[] = [
  { key: "preparing", label: "Fetching membership proof" },
  { key: "proving", label: "Proving privately in your browser - this can take a few minutes" },
  { key: "submitting", label: "Submitting redeem to the committee" },
  { key: "done", label: "Redeemed privately" },
];

function friendlyRedeemError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("NotIncluded") || msg.includes("#15")) {
    return "This order hasn't been included in a settled batch yet - try again after the next batch settles.";
  }
  if (msg.includes("not resolved")) {
    return "This market hasn't resolved yet.";
  }
  return msg;
}

function RedeemRow({
  position,
  address,
  onRedeemed,
}: {
  position: Position;
  address: string;
  onRedeemed: (commitment: string) => void;
}) {
  const [stage, setStage] = useState<RedeemStage | null>(null);
  const [error, setError] = useState("");
  const alreadyRedeemed = position.status === "redeemed";
  const busy = stage !== null && stage !== "done";
  const activeIndex = stage ? REDEEM_STAGES.findIndex((s) => s.key === stage) : -1;

  async function redeem() {
    setError("");
    setStage(null);
    try {
      const entry = findMarket(position.market);
      await runRedeem({ position, address, marketId: position.market, poolId: entry?.poolId, onStage: setStage });
      updateStatus(address, position.commitment, "redeemed");
      onRedeemed(position.commitment);
    } catch (e) {
      setError(friendlyRedeemError(e));
      setStage(null);
    }
  }

  return (
    <div className="w-full space-y-3">
      {!alreadyRedeemed && stage !== "done" && (
        <Button size="sm" disabled={busy} onClick={redeem}>
          {busy && <Spinner className="size-3" />}
          {busy ? "Redeeming" : "Redeem"}
        </Button>
      )}

      {stage && stage !== "done" && (
        <div className="space-y-2">
          {REDEEM_STAGES.map((s, i) => (
            <div key={s.key} className="flex items-center gap-3 text-xs">
              {i === activeIndex ? (
                <Spinner className="size-3 shrink-0" />
              ) : (
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: i <= activeIndex ? "#16c784" : "rgba(255,255,255,0.15)" }}
                />
              )}
              <span className={i <= activeIndex ? "" : "text-muted-foreground"}>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {stage === "done" && (
        <a
          href={NETWORK.explorer(NETWORK.poolId)}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-mono underline"
          style={{ color: ACCENT }}
        >
          Redeemed - view payout on stellar.expert
        </a>
      )}

      {error && (
        <p className="text-xs" style={{ color: "#f0564a" }}>
          {error}
        </p>
      )}
    </div>
  );
}

export function PositionsList() {
  const address = useWalletAddress();
  const [positions, setPositions] = useState<Position[]>([]);
  const { data } = useMarket();
  const resolved = data ? data.outcome !== "LIVE" : false;

  useEffect(() => {
    setPositions(address ? listPositions(address) : []);
  }, [address]);

  function handleRedeemed(commitment: string) {
    setPositions((prev) =>
      prev.map((p) => (p.commitment === commitment ? { ...p, status: "redeemed" } : p))
    );
  }

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
                <span className="text-sm">{p.amount} {p.collateralCode ?? "XLM"}</span>
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
              {resolved && (
                <RedeemRow position={p} address={address} onRedeemed={handleRedeemed} />
              )}
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
