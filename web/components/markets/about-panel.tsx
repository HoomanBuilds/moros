"use client";
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { useMarket } from "@/lib/stellar/use-market";
import { Panel } from "@/components/app/app-kit";
import { truncate } from "@/lib/wallet";
import { useActiveMarket } from "@/lib/markets/market-context";
import { NETWORK } from "@/lib/network";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm sm:text-right">{children}</span>
    </div>
  );
}

function ContractLink({ id }: { id: string }) {
  return (
    <a
      href={NETWORK.explorer(id)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 font-mono text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      {truncate(id)}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

export function AboutPanel() {
  const { data } = useMarket();
  const { marketId, poolId } = useActiveMarket();
  const asset = data?.asset ?? "the asset";
  const strike = data?.strike ?? "--";

  return (
    <Panel className="p-6 space-y-6">
      <div className="space-y-3">
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          How this market works
        </span>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Resolves <span className="text-foreground">YES</span> if {asset} settles at or above{" "}
          <span className="text-foreground">{strike}</span> at expiry, read from the on-chain oracle.
          Otherwise it resolves <span className="text-foreground">NO</span>. Prices are set by an LMSR
          market maker, so odds move as the pool takes each side.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your bet is a zero-knowledge commitment. Neither the side nor the size is visible on-chain.
          A threshold committee only ever decrypts the net across a batch, and winners redeem privately
          through a relayer, so no signature links a payout back to you.
        </p>
      </div>

      <div className="divide-y divide-foreground/10 border-t border-foreground/10">
        <Row label="Underlying">{asset}</Row>
        <Row label="Resolves at">{strike}</Row>
        <Row label="Settlement">{data ? data.resolutionLabel : "--"}</Row>
        <Row label="Pool collateral">{data ? `${data.poolSizeXlm.toFixed(2)} XLM` : "--"}</Row>
        <Row label="Privacy">Groth16 · BLS12-381 · t-of-n committee</Row>
        <Row label="Market contract"><ContractLink id={marketId} /></Row>
        <Row label="Shielded pool"><ContractLink id={poolId} /></Row>
      </div>
    </Panel>
  );
}
