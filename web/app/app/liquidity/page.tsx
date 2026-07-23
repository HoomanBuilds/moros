"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CircleAlert,
  Droplets,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { AssetIcon } from "@/components/markets/asset-icon";
import { EmptyState, PageHeader, Panel, Tag } from "@/components/app/app-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  fundMarketLiquidity,
  getOwnedLiquidityShares,
  getLiquidityVaultInfo,
  shieldUsdc,
  withdrawLiquidity,
  type LiquidityVaultInfo,
  type OwnedLiquidityShare,
} from "@/lib/private/actions";
import { openPrivateWallet } from "@/lib/private/wallet";
import {
  fetchLiquidityMarkets,
  type RegistryMarket,
} from "@/lib/supabase/markets-meta";
import {
  addCollateralTrustline,
  getCollateralAccountState,
  type CollateralAccountState,
} from "@/lib/stellar/collateral-account";
import {
  formatTokenAmount,
  parseTokenAmount,
} from "@/lib/stellar/amount";
import { NETWORK } from "@/lib/network";
import { connectWallet } from "@/lib/wallet-store";
import { useWalletAddress } from "@/lib/wallet-store";
import { cn } from "@/lib/utils";

type CardState = {
  amount: string;
  status: string;
  error: string;
  busy: boolean;
};

function phaseName(value: LiquidityVaultInfo["phase"]): string {
  return typeof value === "string" ? value : value.tag;
}

function progress(info: LiquidityVaultInfo | undefined, target: bigint): number {
  if (!info || target <= 0n) return 0;
  return Math.min(100, Number(info.funded_assets * 10_000n / target) / 100);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export default function LiquidityPage() {
  const address = useWalletAddress();
  const [markets, setMarkets] = useState<RegistryMarket[]>([]);
  const [vaults, setVaults] = useState<Record<string, LiquidityVaultInfo>>({});
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [privateBalance, setPrivateBalance] = useState<bigint | null>(null);
  const [ownedShares, setOwnedShares] = useState<OwnedLiquidityShare[]>([]);
  const [collateral, setCollateral] = useState<CollateralAccountState | null>(null);
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [trustlineBusy, setTrustlineBusy] = useState(false);
  const [pageError, setPageError] = useState("");

  const loadMarkets = useCallback(async () => {
    setLoading(true);
    setPageError("");
    try {
      const rows = await fetchLiquidityMarkets();
      setMarkets(rows);
      if (address) {
        const entries = await Promise.all(rows.map(async (market) => {
          if (!market.liquidityVaultId) return null;
          const info = await getLiquidityVaultInfo(address, market.liquidityVaultId);
          return [market.marketId, info] as const;
        }));
        setVaults(Object.fromEntries(entries.filter((entry) => entry !== null)));
        setCollateral(await getCollateralAccountState(address, NETWORK.collateral));
      } else {
        setVaults({});
        setCollateral(null);
        setPrivateBalance(null);
        setOwnedShares([]);
      }
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Funding rounds could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void loadMarkets();
  }, [loadMarkets]);

  const activeMarkets = useMemo(() => markets.filter((market) => {
    const info = vaults[market.marketId];
    return !info || ["Funding", "Ready"].includes(phaseName(info.phase));
  }), [markets, vaults]);

  function updateCard(marketId: string, update: Partial<CardState>) {
    setCards((current) => ({
      ...current,
      [marketId]: {
        amount: current[marketId]?.amount ?? "5",
        status: current[marketId]?.status ?? "",
        error: current[marketId]?.error ?? "",
        busy: current[marketId]?.busy ?? false,
        ...update,
      },
    }));
  }

  async function unlock() {
    if (!address) return;
    setUnlocking(true);
    setPageError("");
    try {
      const wallet = await openPrivateWallet(address);
      setPrivateBalance(wallet.balance);
      setOwnedShares(await getOwnedLiquidityShares(
        address,
        markets.flatMap((market) =>
          market.liquidityVaultId ? [market.liquidityVaultId] : []
        ),
      ));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Private balance could not be unlocked");
    } finally {
      setUnlocking(false);
    }
  }

  async function enableUsdc() {
    if (!address) return;
    setTrustlineBusy(true);
    setPageError("");
    try {
      await addCollateralTrustline(address, NETWORK.collateral);
      setCollateral(await getCollateralAccountState(address, NETWORK.collateral));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "USDC could not be enabled");
    } finally {
      setTrustlineBusy(false);
    }
  }

  async function refreshPrivateBalance(
    priorBalance: bigint,
  ): Promise<bigint> {
    for (let attempt = 0; attempt < 20; attempt++) {
      await wait(2_000);
      const wallet = await openPrivateWallet(address);
      if (wallet.balance > priorBalance) return wallet.balance;
    }
    throw new Error("Deposit confirmed, but the private indexer has not published the new note yet");
  }

  async function shield(market: RegistryMarket) {
    if (!address) return;
    const card = cards[market.marketId] ?? { amount: "5", status: "", error: "", busy: false };
    updateCard(market.marketId, { busy: true, error: "", status: "Preparing deposit" });
    try {
      const amount = parseTokenAmount(card.amount, NETWORK.collateral.decimals);
      if (!collateral?.hasTrustline) throw new Error("Enable USDC before shielding funds");
      if (collateral.balanceAtomic < amount) {
        throw new Error("Wallet USDC balance is too low for this deposit");
      }
      const priorBalance = privateBalance ?? 0n;
      await shieldUsdc(address, amount, (status) =>
        updateCard(market.marketId, { status })
      );
      updateCard(market.marketId, { status: "Waiting for the private note index" });
      const balance = await refreshPrivateBalance(priorBalance);
      setPrivateBalance(balance);
      setCollateral(await getCollateralAccountState(address, NETWORK.collateral));
      updateCard(market.marketId, { status: "USDC is available privately" });
    } catch (error) {
      updateCard(market.marketId, {
        error: error instanceof Error ? error.message : "USDC deposit failed",
        status: "",
      });
    } finally {
      updateCard(market.marketId, { busy: false });
    }
  }

  async function fund(market: RegistryMarket) {
    if (!address || !market.liquidityVaultId) return;
    const card = cards[market.marketId] ?? { amount: "5", status: "", error: "", busy: false };
    updateCard(market.marketId, { busy: true, error: "", status: "Preparing private funding" });
    try {
      const amount = parseTokenAmount(card.amount, NETWORK.collateral.decimals);
      const funded = await fundMarketLiquidity(
        address,
        market.liquidityVaultId,
        amount,
        (status) => updateCard(market.marketId, { status }),
      );
      updateCard(market.marketId, {
        status: `Funded ${formatTokenAmount(funded.assets, NETWORK.collateral.decimals, 2)} USDC privately`,
      });
      const [wallet, info] = await Promise.all([
        openPrivateWallet(address),
        getLiquidityVaultInfo(address, market.liquidityVaultId),
      ]);
      setPrivateBalance(wallet.balance);
      setOwnedShares(await getOwnedLiquidityShares(
        address,
        markets.flatMap((entry) =>
          entry.liquidityVaultId ? [entry.liquidityVaultId] : []
        ),
      ));
      setVaults((current) => ({ ...current, [market.marketId]: info }));
    } catch (error) {
      updateCard(market.marketId, {
        error: error instanceof Error ? error.message : "Private funding failed",
        status: "",
      });
    } finally {
      updateCard(market.marketId, { busy: false });
    }
  }

  async function withdraw(
    market: RegistryMarket,
    share: OwnedLiquidityShare,
  ) {
    if (!address || !market.liquidityVaultId) return;
    const key = `lp:${share.commitment}`;
    updateCard(key, { busy: true, error: "", status: "Preparing private LP withdrawal" });
    try {
      const result = await withdrawLiquidity({
        address,
        liquidityVaultId: market.liquidityVaultId,
        shareCommitment: share.commitment,
        shares: share.shares,
        onStatus: (status) => updateCard(key, { status }),
      });
      updateCard(key, {
        status: `Returned ${formatTokenAmount(result.assets, NETWORK.collateral.decimals, 4)} private USDC`,
      });
      const [wallet, info, shares] = await Promise.all([
        openPrivateWallet(address),
        getLiquidityVaultInfo(address, market.liquidityVaultId),
        getOwnedLiquidityShares(
          address,
          markets.flatMap((entry) =>
            entry.liquidityVaultId ? [entry.liquidityVaultId] : []
          ),
        ),
      ]);
      setPrivateBalance(wallet.balance);
      setOwnedShares(shares);
      setVaults((current) => ({ ...current, [market.marketId]: info }));
    } catch (error) {
      updateCard(key, {
        error: error instanceof Error ? error.message : "Private LP withdrawal failed",
        status: "",
      });
    } finally {
      updateCard(key, { busy: false });
    }
  }

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        label="Permissionless LP"
        title="Fund markets"
        description="Provide private USDC liquidity to isolated market vaults. Each market has its own risk, shares, fees, and settlement."
      />

      <Panel className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex items-start gap-3">
          <LockKeyhole className="mt-0.5 size-5 shrink-0 text-[#eca8d6]" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">Private LP wallet</p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-foreground/55">
              Deposits and final withdrawals are public Stellar boundaries. Internal LP ownership, market allocation, exits, and claims use private notes and proof relaying.
            </p>
            {privateBalance !== null && (
              <p className="mt-3 font-mono text-sm text-emerald-200">
                {formatTokenAmount(privateBalance, NETWORK.collateral.decimals, 2)} private USDC available
              </p>
            )}
          </div>
        </div>
        {!address ? (
          <Button onClick={() => void connectWallet()}>
            <WalletCards className="size-4" />
            Connect wallet
          </Button>
        ) : privateBalance === null ? (
          <Button disabled={unlocking} onClick={() => void unlock()}>
            {unlocking ? <Spinner /> : <ShieldCheck className="size-4" />}
            {unlocking ? "Unlocking" : "Unlock private balance"}
          </Button>
        ) : (
          <Button variant="outline" disabled={unlocking} onClick={() => void unlock()}>
            <RefreshCw className={cn("size-4", unlocking && "animate-spin")} />
            Refresh balance
          </Button>
        )}
      </Panel>

      {address && collateral && !collateral.hasTrustline && (
        <Panel className="flex flex-col gap-4 border-amber-300/20 bg-amber-300/[0.04] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-200" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-amber-100">Enable Stellar testnet USDC</p>
              <p className="mt-1 text-xs text-foreground/55">Only LPs and bettors need USDC. Market creators do not.</p>
            </div>
          </div>
          <Button disabled={trustlineBusy} onClick={() => void enableUsdc()}>
            {trustlineBusy && <Spinner />}
            Enable USDC
          </Button>
        </Panel>
      )}

      {pageError && (
        <div role="alert" className="rounded-lg border border-red-300/20 bg-red-300/[0.05] p-4 text-sm text-red-200">
          {pageError}
        </div>
      )}

      {address && privateBalance !== null && ownedShares.length > 0 && (
        <section className="space-y-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/45">Your private LP positions</p>
            <p className="mt-1 text-sm text-foreground/60">Ownership is recovered from encrypted notes. Each card is isolated to one market.</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {ownedShares.map((share) => {
              const market = markets.find((entry) =>
                entry.liquidityVaultId === share.liquidityVaultId
              );
              if (!market) return null;
              const info = vaults[market.marketId];
              const phase = info ? phaseName(info.phase) : "Loading";
              const withdrawable = ["Funding", "Ready", "Cancelled", "Settled"].includes(phase);
              const cardKey = `lp:${share.commitment}`;
              const card = cards[cardKey];
              return (
                <Panel key={share.commitment.toString()} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{market.title || `${market.asset} market`}</p>
                      <p className="mt-1 font-mono text-xs text-foreground/50">
                        {formatTokenAmount(share.shares, NETWORK.collateral.decimals, 4)} LP shares
                      </p>
                    </div>
                    <Tag>{phase}</Tag>
                  </div>
                  <p className="mt-4 text-xs leading-relaxed text-foreground/50">
                    {phase === "Active"
                      ? "These shares secure an open market. Exit requires a replacement LP or terminal settlement."
                      : withdrawable
                        ? "The vault can return this note at its current proportional value."
                        : "The vault is updating its settlement state."}
                  </p>
                  {withdrawable && (
                    <Button
                      className="mt-4"
                      size="sm"
                      disabled={card?.busy}
                      onClick={() => void withdraw(market, share)}
                    >
                      {card?.busy && <Spinner />}
                      {phase === "Funding" || phase === "Ready"
                        ? "Withdraw funding"
                        : "Redeem LP shares"}
                    </Button>
                  )}
                  {card?.status && <p className="mt-3 text-xs text-emerald-200">{card.status}</p>}
                  {card?.error && <p className="mt-3 text-xs text-red-300">{card.error}</p>}
                </Panel>
              );
            })}
          </div>
        </section>
      )}

      {loading ? (
        <Panel className="flex min-h-52 items-center justify-center">
          <Spinner />
        </Panel>
      ) : activeMarkets.length === 0 ? (
        <EmptyState
          title="No funding rounds are open"
          description="Create a price market proposal or return after another user opens one."
          action={<Button asChild><Link href="/app/create">Create a market</Link></Button>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {activeMarkets.map((market) => {
            const info = vaults[market.marketId];
            const target = info?.target_assets ?? BigInt(market.liquidityTarget ?? "0");
            const funded = info?.funded_assets ?? 0n;
            const remaining = target > funded ? target - funded : 0n;
            const card = cards[market.marketId] ?? { amount: "5", status: "", error: "", busy: false };
            const amount = (() => {
              try {
                return parseTokenAmount(card.amount, NETWORK.collateral.decimals);
              } catch {
                return 0n;
              }
            })();
            const canFund = privateBalance !== null && privateBalance >= amount && amount > 0n;
            return (
              <Panel key={market.marketId} className="overflow-hidden">
                <div className="flex items-start gap-3 border-b border-white/[0.08] p-5">
                  <AssetIcon asset={market.asset} />
                  <div className="min-w-0 flex-1">
                    <Tag>{market.category || "Price market"}</Tag>
                    <h2 className="mt-2 text-lg font-medium leading-snug">
                      {market.title || `${market.asset} price market`}
                    </h2>
                  </div>
                  <span className="rounded-full border border-[#eca8d6]/20 bg-[#eca8d6]/[0.05] px-2.5 py-1 font-mono text-[10px] uppercase text-[#f4c5e4]">
                    {info ? phaseName(info.phase) : "Funding"}
                  </span>
                </div>

                <div className="space-y-5 p-5">
                  <div>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-foreground/55">Funding progress</span>
                      <span className="font-mono">
                        {formatTokenAmount(funded, NETWORK.collateral.decimals, 2)} / {formatTokenAmount(target, NETWORK.collateral.decimals, 2)} USDC
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.07]">
                      <div
                        className="h-full rounded-full bg-[#eca8d6] transition-[width]"
                        style={{ width: `${progress(info, target)}%` }}
                      />
                    </div>
                    <p className="mt-2 text-[11px] text-foreground/45">
                      {formatTokenAmount(remaining, NETWORK.collateral.decimals, 2)} USDC remaining. Capital is isolated to this market.
                    </p>
                  </div>

                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <div className="relative">
                      <Input
                        inputMode="decimal"
                        value={card.amount}
                        disabled={card.busy || remaining === 0n}
                        aria-label="USDC liquidity amount"
                        onChange={(event) => updateCard(market.marketId, {
                          amount: event.target.value,
                          error: "",
                        })}
                        className="h-11 pr-16 font-mono"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-xs text-foreground/45">USDC</span>
                    </div>
                    {!address ? (
                      <Button onClick={() => void connectWallet()}>Connect</Button>
                    ) : privateBalance === null ? (
                      <Button disabled={unlocking} onClick={() => void unlock()}>Unlock</Button>
                    ) : canFund ? (
                      <Button disabled={card.busy || remaining === 0n} onClick={() => void fund(market)}>
                        {card.busy && <Spinner />}
                        Fund privately
                      </Button>
                    ) : (
                      <Button disabled={card.busy || amount <= 0n || !collateral?.hasTrustline} onClick={() => void shield(market)}>
                        {card.busy && <Spinner />}
                        Shield USDC
                      </Button>
                    )}
                  </div>

                  {card.status && <p className="text-xs text-emerald-200">{card.status}</p>}
                  {card.error && <p role="alert" className="text-xs text-red-300">{card.error}</p>}

                  <div className="flex items-center gap-2 text-[11px] text-foreground/45">
                    <Droplets className="size-3.5" aria-hidden="true" />
                    LP shares track the vault terminal equity and fee share. Returns are not guaranteed.
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
