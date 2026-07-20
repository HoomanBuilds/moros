"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PageHeader, Panel, Tag } from "@/components/app/app-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { AssetIcon } from "@/components/markets/asset-icon";
import { AssetSpotChart } from "@/components/markets/asset-spot-chart";
import { MARKET_SUBSIDY, RESOLVABLE_ASSETS } from "@/lib/markets/deploy-constants";
import { useAssetPrice } from "@/lib/prices/use-asset-price";
import { useWalletAddress, connectWallet } from "@/lib/wallet-store";
import { deployShieldedMarket, type DeployStep } from "@/lib/markets/deploy";
import { addMarket, refreshMarkets } from "@/lib/markets/registry";
import { saveMarketToRegistry } from "@/lib/supabase/markets-meta";
import { registerPool } from "@/lib/committee/client";
import { cn } from "@/lib/utils";
import { NETWORK } from "@/lib/network";
import {
  addCollateralTrustline,
  getCollateralAccountState,
  type CollateralAccountState,
} from "@/lib/stellar/collateral-account";
import { formatTokenAmount } from "@/lib/stellar/amount";

const STEPS: { key: DeployStep; label: string }[] = [
  { key: "market", label: "Deploying market contract" },
  { key: "funding", label: "Funding guaranteed market solvency" },
  { key: "pool", label: "Deploying shielded pool" },
  { key: "batcher", label: "Linking pool as batcher" },
  { key: "committee", label: "Configuring threshold committee" },
  { key: "redeemvk", label: "Installing redeem verifying key" },
  { key: "resolver", label: "Wiring Reflector oracle auto-resolution" },
  { key: "done", label: "Shielded market live" },
];

const EXPIRIES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

function fmtUsd(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

export default function CreatePage() {
  const address = useWalletAddress();
  const [asset, setAsset] = useState("BTC");
  const [strike, setStrike] = useState("");
  const [days, setDays] = useState(30);
  const [stage, setStage] = useState<DeployStep | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ marketId: string } | null>(null);
  const [accountState, setAccountState] = useState<CollateralAccountState | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [trustlineLoading, setTrustlineLoading] = useState(false);

  const { spot } = useAssetPrice(asset);
  const strikeNum = Number(strike);
  const busy = stage !== null && stage !== "done";
  const valid = strikeNum > 0 && RESOLVABLE_ASSETS.includes(asset);
  const subsidy = BigInt(MARKET_SUBSIDY);
  const hasSubsidy = !!accountState?.hasTrustline && accountState.balanceAtomic >= subsidy;
  const activeIndex = stage ? STEPS.findIndex((s) => s.key === stage) : -1;

  const question = useMemo(
    () => `Will ${asset} be at or above ${strikeNum > 0 ? fmtUsd(strikeNum) : "..."} at settlement?`,
    [asset, strikeNum],
  );

  useEffect(() => {
    let cancelled = false;
    setAccountState(null);
    if (!address) return;
    setAccountLoading(true);
    getCollateralAccountState(address, NETWORK.collateral)
      .then((state) => {
        if (!cancelled) setAccountState(state);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not read USDC balance");
      })
      .finally(() => {
        if (!cancelled) setAccountLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  async function connect() {
    try {
      await connectWallet();
    } catch {
      return;
    }
  }

  async function create() {
    setError("");
    setResult(null);
    setStage(null);
    try {
      if (!accountState?.hasTrustline) throw new Error("Enable USDC before creating a market");
      if (!hasSubsidy) throw new Error("Insufficient USDC for the required market subsidy");
      const expiryUnix = Math.floor(Date.now() / 1000) + days * 86400;
      const { marketId, poolId } = await deployShieldedMarket({
        address,
        asset,
        strikeUsd: strikeNum,
        expiryUnix,
        onStep: setStage,
      });
      const collateral = NETWORK.collateral;
      addMarket({
        marketId,
        poolId,
        asset,
        kind: "shielded",
        collateralCode: collateral.code,
        collateralIssuer: collateral.issuer,
        collateralSac: collateral.sac,
        collateralDecimals: collateral.decimals,
        createdAt: Date.now(),
      });
      await registerPool(marketId, poolId);
      try {
        await saveMarketToRegistry({
          marketId,
          poolId,
          asset,
          collateralCode: collateral.code,
          collateralIssuer: collateral.issuer,
          collateralSac: collateral.sac,
          collateralDecimals: collateral.decimals,
          creator: address,
          title: question,
          category: "Crypto price",
        });
        await refreshMarkets();
      } catch {
        setError("Market is live but could not be listed for others. It is saved locally.");
      }
      setResult({ marketId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "deploy failed");
      setStage(null);
    }
  }

  async function enableCollateral() {
    setError("");
    setTrustlineLoading(true);
    try {
      await addCollateralTrustline(address, NETWORK.collateral);
      setAccountState(await getCollateralAccountState(address, NETWORK.collateral));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not enable USDC");
    } finally {
      setTrustlineLoading(false);
    }
  }

  return (
    <div className="space-y-10">
      <PageHeader label="Moros" title="Create a prediction" description="Deploy your own private, shielded prediction market on Stellar. Anyone can bet; nobody sees which side you took." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr] lg:items-start">
        <Panel className="space-y-7 p-6">
          <div className="space-y-3">
            <Tag>Underlying asset</Tag>
            <div className="flex flex-wrap gap-2">
              {RESOLVABLE_ASSETS.map((a) => (
                <button
                  key={a}
                  type="button"
                  disabled={busy}
                  onClick={() => setAsset(a)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-xs transition-colors disabled:opacity-50",
                    asset === a ? "border-white/40 bg-white/[0.06] text-foreground" : "border-white/10 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <AssetIcon asset={a} size="sm" />
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Tag>Strike price (USD)</Tag>
            <Input
              type="number"
              min="0"
              step="any"
              value={strike}
              disabled={busy}
              placeholder={spot ? spot.price.toString() : "price"}
              onChange={(e) => setStrike(e.target.value)}
            />
            {spot && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setStrike(spot.price.toString())}
                className="font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                current {asset} price {fmtUsd(spot.price)} · tap to use
              </button>
            )}
          </div>

          <div className="space-y-3">
            <Tag>Settles in</Tag>
            <div className="flex gap-2">
              {EXPIRIES.map((e) => (
                <button
                  key={e.days}
                  type="button"
                  disabled={busy}
                  onClick={() => setDays(e.days)}
                  className={cn(
                    "rounded-md border px-4 py-2 font-mono text-xs transition-colors disabled:opacity-50",
                    days === e.days ? "border-white/40 bg-white/[0.06] text-foreground" : "border-white/10 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-white/[0.03] p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Collateral</p>
            <p className="mt-1 text-sm">{NETWORK.collateral.code} on Stellar</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              All new markets accept and settle in Circle USDC. Creating one deposits {formatTokenAmount(subsidy, NETWORK.collateral.decimals, 7)} USDC to cover the LMSR worst-case loss. XLM is used only for Stellar network fees and account reserve.
            </p>
            {address && accountState?.hasTrustline && (
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                Available: {formatTokenAmount(accountState.balanceAtomic, NETWORK.collateral.decimals, 2)} USDC
              </p>
            )}
          </div>

          {!address ? (
            <Button className="w-full" onClick={connect}>
              Connect wallet to create
            </Button>
          ) : accountLoading ? (
            <Button className="w-full" disabled><Spinner />Checking USDC</Button>
          ) : accountState && !accountState.hasTrustline ? (
            <div className="space-y-3">
              <Button className="w-full" disabled={trustlineLoading} onClick={enableCollateral}>
                {trustlineLoading && <Spinner />}
                {trustlineLoading ? "Enabling USDC" : "Enable USDC"}
              </Button>
              {NETWORK.id === "testnet" && (
                <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer" className="block text-xs underline text-muted-foreground hover:text-foreground">
                  Get testnet USDC from Circle
                </a>
              )}
            </div>
          ) : (
            <Button className="w-full" disabled={busy || !valid || !hasSubsidy} onClick={create}>
              {busy && <Spinner />}
              {busy ? "Deploying market" : !hasSubsidy ? "Insufficient USDC for subsidy" : "Deploy shielded market"}
            </Button>
          )}

          {stage && (
            <div className="space-y-2 border-t border-white/[0.08] pt-4">
              {STEPS.map((s, i) => (
                <div key={s.key} className="flex items-center gap-3 text-sm">
                  {i === activeIndex && stage !== "done" ? (
                    <Spinner className="size-3 shrink-0" />
                  ) : (
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: i <= activeIndex ? "#16c784" : "rgba(255,255,255,0.15)" }} />
                  )}
                  <span className={i <= activeIndex ? "" : "text-muted-foreground"}>{s.label}</span>
                </div>
              ))}
            </div>
          )}

          {result && (
            <div className="space-y-3 border-t border-white/[0.08] pt-4">
              <p className="text-sm" style={{ color: "#16c784" }}>Your shielded market is live on testnet.</p>
              <Link href={`/app/market/${result.marketId}`} className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider" style={{ color: "#eca8d6" }}>
                Open your market
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}

          {error && <p className="text-sm" style={{ color: "#f0564a" }}>{error}</p>}
        </Panel>

        <div className="space-y-6">
          <Panel className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <AssetIcon asset={asset} size="lg" />
              <div>
                <h3 className="font-display text-xl leading-tight">{question}</h3>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{asset} binary market · shielded</p>
              </div>
            </div>
            <AssetSpotChart asset={asset} strike={strikeNum > 0 ? strikeNum : undefined} height={200} />
          </Panel>

          <Panel className="space-y-2 p-6">
            <Tag>What gets deployed</Tag>
            <p className="text-sm leading-relaxed text-muted-foreground">
              A USDC-backed LMSR market plus a paired shielded pool and threshold committee, deployed from your wallet in a few signatures. Bets are zero-knowledge commitments, netted by the committee. At expiry the market resolves automatically from the oracle, so there is no trusted admin deciding the outcome.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
