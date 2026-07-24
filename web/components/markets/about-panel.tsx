"use client";
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { useMarket } from "@/lib/stellar/use-market";
import { Panel } from "@/components/app/app-kit";
import { truncate } from "@/lib/wallet";
import { useActiveMarket } from "@/lib/markets/market-context";
import { NETWORK } from "@/lib/network";
import { ORACLE_MODE } from "@/lib/markets/deploy-constants";

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

function safeHttpUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function AboutPanel() {
  const { data } = useMarket();
  const { marketId, poolId } = useActiveMarket();
  const asset = data?.asset ?? "the asset";
  const strike = data?.strike ?? "--";
  const isEvent = data?.resolverType === "event";
  const sourceUrl = safeHttpUrl(data?.resolutionSource);
  const backupSourceUrls = (data?.backupResolutionSources ?? [])
    .map(safeHttpUrl)
    .filter((value): value is string => value !== null);
  const bannerSourceUrl = safeHttpUrl(data?.bannerSourceUrl);
  const bannerLicenseUrl = safeHttpUrl(data?.bannerLicenseUrl);
  const feeLabel = data
    ? `${data.feeBps / 100}% execution parameter with p(1-p) pricing`
    : "--";

  return (
    <Panel className="p-6 space-y-6">
      <div className="space-y-3">
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          How this market works
        </span>
        {isEvent ? (
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p><span className="text-foreground">YES:</span> {data?.resolutionRules}</p>
            <p><span className="text-foreground">VOID:</span> {data?.voidRules}</p>
            <p>
              Event market creation is disabled on this testnet until independent evidence, challenge, arbitration, timeout, and refund operations are running.
            </p>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Resolves <span className="text-foreground">YES</span> if {asset} settles at or above{" "}
            <span className="text-foreground">{strike}</span> at expiry. {ORACLE_MODE === "free" ? "The current testnet beta reads the matching free Reflector CEX or fiat contract on Stellar." : "The paid-mode adapter requires Reflector and Pyth Pro to agree within the configured tolerance."} Invalid or stale data leaves the market pending instead of guessing a result.
          </p>
        )}
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your side and quantity stay encrypted on-chain. Exactly eight orders execute atomically, with at
          least two orders on each side and one clearing price. An incomplete batch is refundable after its
          deadline. Claims are proof-bound and relayer-submittable. The current single-VM coordinator can
          recover individual order values, so this testnet is not threshold privacy.
        </p>
      </div>

      <div className="divide-y divide-foreground/10 border-t border-foreground/10">
        <Row label={isEvent ? "Category" : "Underlying"}>{isEvent ? data?.category || "Event" : asset}</Row>
        {isEvent && data?.subject && <Row label="Subject">{data.subject}</Row>}
        {!isEvent && <Row label="Resolves at">{strike}</Row>}
        {isEvent && sourceUrl && (
          <Row label="Primary source">
            <a href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              Open official source
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Row>
        )}
        {isEvent && backupSourceUrls.length > 0 && (
          <Row label="Backup sources">
            <span className="flex flex-col items-start gap-2 sm:items-end">
              {backupSourceUrls.map((url, index) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                  Open backup source {index + 1}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ))}
            </span>
          </Row>
        )}
        {isEvent && data?.bannerAttribution && (
          <Row label="Subject image">
            <span className="flex flex-col items-start gap-1 sm:items-end">
              <span>{data.bannerAttribution}</span>
              <span className="flex flex-wrap items-center gap-3 text-xs">
                {bannerSourceUrl && (
                  <a href={bannerSourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                    Image source
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {data.bannerLicense && (bannerLicenseUrl ? (
                  <a href={bannerLicenseUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                    {data.bannerLicense}
                  </a>
                ) : (
                  <span className="text-muted-foreground">{data.bannerLicense}</span>
                ))}
              </span>
            </span>
          </Row>
        )}
        <Row label="Settlement">{data ? data.resolutionLabel : "--"}</Row>
        <Row label="Pool collateral">{data ? `${data.poolSize.toFixed(2)} ${data.collateral.code}` : "--"}</Row>
        <Row label="Platform fee">{feeLabel}</Row>
        {isEvent && <Row label="Rules integrity">{data?.rulesVerified ? "Verified against on-chain hash" : "Verification failed"}</Row>}
        <Row label="Privacy">Encrypted side and quantity; single-VM testnet coordinator</Row>
        <Row label="Market contract"><ContractLink id={marketId} /></Row>
        <Row label="Shielded pool"><ContractLink id={poolId} /></Row>
      </div>
    </Panel>
  );
}
