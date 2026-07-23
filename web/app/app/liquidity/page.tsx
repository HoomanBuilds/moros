"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  CircleDollarSign,
  Droplets,
  Layers3,
  LockKeyhole,
  Network,
  RefreshCw,
  ShieldCheck,
  Vault,
  WalletCards,
} from "lucide-react";
import { EmptyState, PageHeader, Panel, Tag } from "@/components/app/app-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  fundPooledLiquidity,
  getOwnedLiquidityShares,
  getPooledLiquidityState,
  previewPooledLiquidityRedemption,
  withdrawLiquidity,
  type OwnedLiquidityShare,
  type PooledLiquidityInfo,
  type PooledLiquidityNav,
  type PooledRedemptionPreview,
} from "@/lib/private/actions";
import { openPrivateWallet } from "@/lib/private/wallet";
import {
  formatTokenAmount,
  parseTokenAmount,
} from "@/lib/stellar/amount";
import { NETWORK } from "@/lib/network";
import { connectWallet, useWalletAddress } from "@/lib/wallet-store";
import { cn } from "@/lib/utils";

type ShareRow = OwnedLiquidityShare & {
  preview?: PooledRedemptionPreview;
};

type ActionState = {
  busy: boolean;
  status: string;
  error: string;
};

const EMPTY_ACTION: ActionState = {
  busy: false,
  status: "",
  error: "",
};

function token(amount: bigint, digits = 2): string {
  return formatTokenAmount(amount, NETWORK.collateral.decimals, digits);
}

function percent(numerator: bigint, denominator: bigint): string {
  if (denominator <= 0n) return "0%";
  return `${Number(numerator * 10_000n / denominator) / 100}%`;
}

function shorten(value: string): string {
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}

export default function LiquidityPage() {
  const address = useWalletAddress();
  const [poolId, setPoolId] = useState("");
  const [info, setInfo] = useState<PooledLiquidityInfo>();
  const [nav, setNav] = useState<PooledLiquidityNav>();
  const [privateBalance, setPrivateBalance] = useState<bigint | null>(null);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [depositAmount, setDepositAmount] = useState("20");
  const [withdrawAmounts, setWithdrawAmounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [depositAction, setDepositAction] = useState<ActionState>(EMPTY_ACTION);
  const [shareActions, setShareActions] = useState<Record<string, ActionState>>({});
  const [pageError, setPageError] = useState("");

  const readPool = useCallback(async () => {
    if (!address) {
      setInfo(undefined);
      setNav(undefined);
      setPoolId("");
      return;
    }
    const state = await getPooledLiquidityState(address);
    setPoolId(state.poolId);
    setInfo(state.info);
    setNav(state.nav);
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setPrivateBalance(null);
      setShares([]);
      void readPool();
      return;
    }
    setLoading(true);
    setPageError("");
    void readPool()
      .catch((error) => {
        if (!cancelled) {
          setPageError(
            error instanceof Error ? error.message : "Liquidity pool could not be loaded",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, readPool]);

  const loadPrivateState = useCallback(async () => {
    if (!address) throw new Error("Connect a wallet first");
    const wallet = await openPrivateWallet(address);
    const state = await getPooledLiquidityState(address);
    const owned = await getOwnedLiquidityShares(address, [state.poolId], wallet);
    const rows = await Promise.all(owned.map(async (share) => ({
      ...share,
      preview: await previewPooledLiquidityRedemption(address, share.shares),
    })));
    setPoolId(state.poolId);
    setInfo(state.info);
    setNav(state.nav);
    setPrivateBalance(wallet.balance);
    setShares(rows);
    setWithdrawAmounts((current) => {
      const next = { ...current };
      for (const share of rows) {
        const key = share.commitment.toString();
        next[key] ??= token(share.shares, NETWORK.collateral.decimals);
      }
      return next;
    });
    return { wallet, state, rows };
  }, [address]);

  async function unlock() {
    if (!address) return;
    setUnlocking(true);
    setPageError("");
    try {
      await loadPrivateState();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Private balance could not be unlocked",
      );
    } finally {
      setUnlocking(false);
    }
  }

  async function deposit() {
    if (!address || privateBalance === null) return;
    setDepositAction({ busy: true, status: "Preparing private pool deposit", error: "" });
    try {
      const amount = parseTokenAmount(depositAmount, NETWORK.collateral.decimals);
      if (amount > privateBalance) {
        throw new Error("Add enough private USDC in Portfolio before depositing");
      }
      const result = await fundPooledLiquidity(
        address,
        amount,
        (status) => setDepositAction({ busy: true, status, error: "" }),
      );
      setDepositAction({
        busy: false,
        status: `${token(result.assets, 4)} private USDC added to the Moros liquidity pool`,
        error: "",
      });
      await loadPrivateState();
    } catch (error) {
      setDepositAction({
        busy: false,
        status: "",
        error: error instanceof Error ? error.message : "Private pool deposit failed",
      });
    }
  }

  function updateShareAction(key: string, update: Partial<ActionState>) {
    setShareActions((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? EMPTY_ACTION),
        ...update,
      },
    }));
  }

  async function withdraw(share: ShareRow) {
    if (!address || !poolId) return;
    const key = share.commitment.toString();
    updateShareAction(key, {
      busy: true,
      status: "Preparing private pool withdrawal",
      error: "",
    });
    try {
      const requested = parseTokenAmount(
        withdrawAmounts[key] || "",
        NETWORK.collateral.decimals,
      );
      if (requested > share.shares) {
        throw new Error("Withdrawal shares exceed this private share note");
      }
      const result = await withdrawLiquidity({
        address,
        liquidityVaultId: poolId,
        shareCommitment: share.commitment,
        shares: requested,
        onStatus: (status) => updateShareAction(key, { status }),
      });
      updateShareAction(key, {
        busy: false,
        status: `${token(result.assets, 4)} private USDC returned to your reusable balance`,
        error: "",
      });
      await loadPrivateState();
    } catch (error) {
      updateShareAction(key, {
        busy: false,
        status: "",
        error: error instanceof Error ? error.message : "Private pool withdrawal failed",
      });
    }
  }

  const queuedMarkets = info?.pending_candidates ?? 0;
  const totalPrivateShares = shares.reduce(
    (total, share) => total + share.shares,
    0n,
  );
  const depositAtomic = (() => {
    try {
      return parseTokenAmount(depositAmount, NETWORK.collateral.decimals);
    } catch {
      return 0n;
    }
  })();
  const canDeposit =
    privateBalance !== null &&
    depositAtomic > 0n &&
    depositAtomic <= privateBalance;

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        label="Permissionless LP"
        title="Moros liquidity pool"
        description="Deposit private USDC once. The pool automatically supplies approved markets through isolated risk cells, so market creators never need to fund their own markets."
      />

      <Panel className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex items-start gap-3">
          <LockKeyhole
            className="mt-0.5 size-5 shrink-0 text-[#eca8d6]"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-medium">Private LP wallet</p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-foreground/55">
              Wallet shielding and unshielding are public Stellar boundaries. LP ownership stays
              in encrypted notes. Pool capital, risk limits, and market allocations remain publicly
              auditable for solvency.
            </p>
            {privateBalance !== null && (
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs">
                <span className="text-emerald-200">
                  {token(privateBalance)} private USDC available
                </span>
                <span className="text-foreground/50">
                  {token(totalPrivateShares, 4)} private pool shares
                </span>
              </div>
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
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={unlocking} onClick={() => void unlock()}>
              <RefreshCw className={cn("size-4", unlocking && "animate-spin")} />
              Refresh
            </Button>
            <Button asChild>
              <Link href="/app/portfolio">Add private USDC</Link>
            </Button>
          </div>
        )}
      </Panel>

      {pageError && (
        <div
          role="alert"
          className="rounded-lg border border-red-300/20 bg-red-300/[0.05] p-4 text-sm text-red-200"
        >
          {pageError}
        </div>
      )}

      {loading ? (
        <Panel className="flex min-h-44 items-center justify-center">
          <Spinner />
        </Panel>
      ) : address && info && nav ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Panel className="p-4">
              <div className="flex items-center gap-2 text-foreground/50">
                <Vault className="size-4" aria-hidden="true" />
                <span className="text-xs">Conservative pool value</span>
              </div>
              <p className="mt-3 font-mono text-xl">{token(nav.withdrawal_nav)} USDC</p>
              <p className="mt-1 text-[11px] text-foreground/40">
                Active positions use the lower outcome value.
              </p>
            </Panel>
            <Panel className="p-4">
              <div className="flex items-center gap-2 text-foreground/50">
                <Droplets className="size-4" aria-hidden="true" />
                <span className="text-xs">Idle reserve</span>
              </div>
              <p className="mt-3 font-mono text-xl">{token(nav.idle_assets)} USDC</p>
              <p className="mt-1 text-[11px] text-foreground/40">
                {percent(nav.idle_assets, nav.withdrawal_nav)} of conservative value.
              </p>
            </Panel>
            <Panel className="p-4">
              <div className="flex items-center gap-2 text-foreground/50">
                <Network className="size-4" aria-hidden="true" />
                <span className="text-xs">Active market cells</span>
              </div>
              <p className="mt-3 font-mono text-xl">{info.active_allocations}</p>
              <p className="mt-1 text-[11px] text-foreground/40">
                {token(info.deployed_principal)} USDC allocated with isolated risk.
              </p>
            </Panel>
            <Panel className="p-4">
              <div className="flex items-center gap-2 text-foreground/50">
                <Layers3 className="size-4" aria-hidden="true" />
                <span className="text-xs">Markets waiting</span>
              </div>
              <p className="mt-3 font-mono text-xl">{queuedMarkets}</p>
              <p className="mt-1 text-[11px] text-foreground/40">
                Eligible markets are funded automatically in queue order.
              </p>
            </Panel>
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Panel className="p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <CircleDollarSign className="mt-0.5 size-5 text-[#eca8d6]" aria-hidden="true" />
                <div>
                  <h2 className="text-lg font-medium">Provide liquidity once</h2>
                  <p className="mt-1 text-xs leading-relaxed text-foreground/50">
                    Your deposit receives private pool shares. Share value rises or falls with
                    realized market results and the LP portion of trading fees.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_auto]">
                <div className="relative">
                  <Input
                    inputMode="decimal"
                    value={depositAmount}
                    disabled={depositAction.busy}
                    aria-label="USDC pool deposit"
                    onChange={(event) => {
                      setDepositAmount(event.target.value);
                      setDepositAction(EMPTY_ACTION);
                    }}
                    className="h-11 pr-16 font-mono"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-xs text-foreground/45">
                    USDC
                  </span>
                </div>
                {privateBalance === null ? (
                  <Button disabled={unlocking} onClick={() => void unlock()}>
                    Unlock balance
                  </Button>
                ) : canDeposit ? (
                  <Button disabled={depositAction.busy} onClick={() => void deposit()}>
                    {depositAction.busy && <Spinner />}
                    Deposit privately
                  </Button>
                ) : (
                  <Button asChild>
                    <Link href="/app/portfolio">Add private USDC</Link>
                  </Button>
                )}
              </div>
              {depositAction.status && (
                <p className="mt-3 text-xs text-emerald-200">{depositAction.status}</p>
              )}
              {depositAction.error && (
                <p role="alert" className="mt-3 text-xs text-red-300">
                  {depositAction.error}
                </p>
              )}
              <div className="mt-5 grid gap-2 border-t border-white/[0.07] pt-4 text-[11px] text-foreground/45 sm:grid-cols-3">
                <span>Market cap {info.policy.max_market_bps / 100}%</span>
                <span>Risk group cap {info.policy.max_group_bps / 100}%</span>
                <span>Minimum idle {info.policy.minimum_idle_bps / 100}%</span>
              </div>
            </Panel>

            <Panel className="p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <Activity className="mt-0.5 size-5 text-[#eca8d6]" aria-hidden="true" />
                <div>
                  <h2 className="text-lg font-medium">How allocation works</h2>
                  <p className="mt-1 text-xs leading-relaxed text-foreground/50">
                    The keeper funds only factory-approved markets. Every market receives a separate
                    risk cell and cannot spend capital assigned to another market.
                  </p>
                </div>
              </div>
              <div className="mt-5 space-y-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground/50">Immediate exit capacity</span>
                  <span className="font-mono">{token(nav.immediate_assets, 4)} USDC</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground/50">Deposit valuation</span>
                  <span className="font-mono">{token(nav.deposit_nav, 4)} USDC</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground/50">Conditional fees excluded</span>
                  <span className="font-mono">
                    {token(nav.conditional_fees_excluded, 4)} USDC
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground/50">Pool contract</span>
                  <span className="font-mono text-foreground/65">{shorten(poolId)}</span>
                </div>
              </div>
              <p className="mt-5 border-t border-white/[0.07] pt-4 text-[11px] leading-relaxed text-foreground/40">
                Deposits use the conservative upper liability estimate. Withdrawals use the lower
                outcome estimate. This prevents timing an LP deposit or exit against unresolved
                market outcomes.
              </p>
            </Panel>
          </section>

          {privateBalance !== null && shares.length > 0 ? (
            <section className="space-y-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/45">
                  Your private pool shares
                </p>
                <p className="mt-1 text-sm text-foreground/60">
                  Each encrypted note can be withdrawn fully or partially into reusable private
                  USDC.
                </p>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {shares.map((share) => {
                  const key = share.commitment.toString();
                  const action = shareActions[key] ?? EMPTY_ACTION;
                  const amount = (() => {
                    try {
                      return parseTokenAmount(
                        withdrawAmounts[key] || "",
                        NETWORK.collateral.decimals,
                      );
                    } catch {
                      return 0n;
                    }
                  })();
                  const canWithdraw =
                    amount > 0n &&
                    amount <= share.shares &&
                    (share.preview?.immediate_assets ?? 0n) > 0n;
                  return (
                    <Panel key={key} className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">
                            {token(share.shares, 4)} private shares
                          </p>
                          <p className="mt-1 font-mono text-xs text-foreground/50">
                            Current value {token(share.preview?.assets ?? 0n, 4)} USDC
                          </p>
                        </div>
                        <Tag>
                          {share.preview?.can_redeem_now ? "Available" : "Partial exit"}
                        </Tag>
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <div className="relative">
                          <Input
                            inputMode="decimal"
                            value={withdrawAmounts[key] || ""}
                            disabled={action.busy}
                            aria-label="Pool shares to withdraw"
                            onChange={(event) => setWithdrawAmounts((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))}
                            className="h-10 pr-16 font-mono"
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-[10px] text-foreground/45">
                            SHARES
                          </span>
                        </div>
                        <Button
                          size="sm"
                          disabled={action.busy || !canWithdraw}
                          onClick={() => void withdraw(share)}
                        >
                          {action.busy && <Spinner />}
                          Withdraw
                        </Button>
                      </div>
                      {!share.preview?.can_redeem_now && (
                        <p className="mt-3 text-[11px] leading-relaxed text-amber-100/70">
                          This full note exceeds current immediate capacity. Enter a smaller share
                          amount or retry after the withdrawal window resets.
                        </p>
                      )}
                      {action.status && (
                        <p className="mt-3 text-xs text-emerald-200">{action.status}</p>
                      )}
                      {action.error && (
                        <p role="alert" className="mt-3 text-xs text-red-300">
                          {action.error}
                        </p>
                      )}
                    </Panel>
                  );
                })}
              </div>
            </section>
          ) : privateBalance !== null ? (
            <EmptyState
              title="No private pool shares yet"
              description="Deposit private USDC above. The pool handles approved market allocation automatically."
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
