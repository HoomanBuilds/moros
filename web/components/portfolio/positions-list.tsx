"use client";
import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ACCENT, EmptyState, Panel, Tag } from "@/components/app/app-kit";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { truncate } from "@/lib/wallet";
import { useWalletAddress } from "@/lib/wallet-store";
import { listPositions, updateStatus, type Position } from "@/lib/positions/book";
import { findMarket } from "@/lib/markets/registry";
import { runRedeem, type RedeemStage } from "@/lib/redeem/flow";
import { NETWORK } from "@/lib/network";
import { getMarketInfo, getOrder, getOutcome } from "@/lib/stellar/read";
import { outcomeLabel } from "@/lib/stellar/derive";
import { refundOrder } from "@/lib/stellar/write";

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
  mode,
  poolId,
  protocolVersion,
  onCompleted,
}: {
  position: Position;
  address: string;
  mode: "redeem" | "refund";
  poolId: string;
  protocolVersion: 2 | 3;
  onCompleted: (commitment: string, status: "redeemed" | "refunded") => void;
}) {
  const [stage, setStage] = useState<RedeemStage | null>(null);
  const [error, setError] = useState("");
  const alreadyRedeemed = position.status === "redeemed" || position.status === "refunded";
  const busy = stage !== null && stage !== "done";
  const activeIndex = stage ? REDEEM_STAGES.findIndex((s) => s.key === stage) : -1;

  async function execute() {
    setError("");
    setStage(null);
    try {
      if (mode === "refund") {
        setStage("submitting");
        await refundOrder(position.commitment, poolId);
        setStage("done");
        updateStatus(address, position.commitment, "refunded");
      } else {
        await runRedeem({
          position,
          address,
          marketId: position.market,
          poolId,
          protocolVersion,
          onStage: setStage,
        });
        updateStatus(address, position.commitment, "redeemed");
      }
      onCompleted(position.commitment, mode === "refund" ? "refunded" : "redeemed");
    } catch (e) {
      setError(friendlyRedeemError(e));
      setStage(null);
    }
  }

  return (
    <div className="w-full space-y-3">
      {!alreadyRedeemed && stage !== "done" && (
        <Button size="sm" disabled={busy} onClick={execute}>
          {busy && <Spinner className="size-3" />}
          {busy ? mode === "refund" ? "Refunding" : "Redeeming" : mode === "refund" ? "Claim full refund" : "Redeem"}
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
          href={NETWORK.explorer(poolId)}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-mono underline"
          style={{ color: ACCENT }}
        >
          {mode === "refund" ? "Refunded" : "Redeemed"} - view on stellar.expert
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
  const marketStates = useQueries({
    queries: positions.map((position) => {
      const entry = findMarket(position.market);
      const poolId = entry?.poolId ?? NETWORK.poolId;
      const protocolVersion = entry?.protocolVersion ?? 2;
      return {
        queryKey: ["position-market", position.market, position.commitment, protocolVersion],
        refetchInterval: 15_000,
        queryFn: async () => {
          const [rawOutcome, info, order] = await Promise.all([
            getOutcome(position.market),
            getMarketInfo(position.market),
            protocolVersion === 3 ? getOrder(position.commitment, poolId).catch(() => null) : Promise.resolve(null),
          ]);
          const outcome = outcomeLabel(rawOutcome);
          const statusRaw = order && typeof order === "object" ? (order as { status?: unknown }).status : null;
          const orderStatus = typeof statusRaw === "string"
            ? statusRaw
            : statusRaw && typeof statusRaw === "object"
              ? String((statusRaw as { tag?: string }).tag ?? "")
              : null;
          return {
            outcome,
            orderStatus,
            finalizable: Date.now() / 1000 >= Number(info.finalize_after ?? info.expiry),
            poolId,
            protocolVersion,
          };
        },
      };
    }),
  });

  useEffect(() => {
    setPositions(address ? listPositions(address) : []);
  }, [address]);

  function handleCompleted(commitment: string, status: "redeemed" | "refunded") {
    setPositions((prev) =>
      prev.map((p) => (p.commitment === commitment ? { ...p, status } : p))
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
        {positions.map((p, index) => {
          const side = SIDE_STYLE[p.side] ?? { label: p.side, color: ACCENT };
          const state = marketStates[index]?.data;
          const finished = p.status === "redeemed" || p.status === "refunded";
          const refundable = !finished && state?.protocolVersion === 3 && (
            state.outcome === "VOID" && (state.orderStatus === "Pending" || state.orderStatus === "Included")
            || state.outcome === "LIVE" && state.finalizable && state.orderStatus === "Pending"
          );
          const redeemable = !finished && (state?.outcome === "YES" || state?.outcome === "NO")
            && (state.protocolVersion === 2 || state.orderStatus === "Included");
          const claimable = refundable || redeemable;
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
              {claimable && state && (
                <RedeemRow
                  position={p}
                  address={address}
                  mode={refundable ? "refund" : "redeem"}
                  poolId={state.poolId}
                  protocolVersion={state.protocolVersion}
                  onCompleted={handleCompleted}
                />
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
