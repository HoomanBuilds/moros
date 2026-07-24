"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Cloud, Download, ExternalLink, RefreshCw, Upload } from "lucide-react";
import { ACCENT, Panel } from "@/components/app/app-kit";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { connectWallet, useWalletAddress } from "@/lib/wallet-store";
import {
  configurePositionBook,
  listPositions,
  subscribePositions,
  updatePosition,
  type Position,
} from "@/lib/positions/book";
import {
  exportEncryptedPositionFile,
  importEncryptedPositionFile,
  preparePositionBackup,
  restorePositionBackups,
  savePositionBackup,
  unlockPositionBackup,
} from "@/lib/positions/backup";
import {
  derivePositionLifecycle,
  estimateSettlement,
  parseOrderStatus,
  type PositionAction,
  type PositionLifecycle,
  type SettlementEstimate,
} from "@/lib/positions/state";
import { findMarket } from "@/lib/markets/registry";
import { retryBetSubmission, type BetStage } from "@/lib/bet/flow";
import { runRedeem, type RedeemStage } from "@/lib/redeem/flow";
import {
  getPrivatePositionState,
  runPrivatePositionAction,
} from "@/lib/private/actions";
import { getPrivateConfig } from "@/lib/private/client";
import { NETWORK } from "@/lib/network";
import { formatTokenAmount } from "@/lib/stellar/amount";
import { outcomeLabel } from "@/lib/stellar/derive";
import { getClearingPrice, getFeeConfig, getMarketCollateral, getMarketInfo, getOrder, getOutcome, getPoolCollateral, getPoolMarket } from "@/lib/stellar/read";
import { refundOrder } from "@/lib/stellar/write";

type Filter = "all" | "active" | "action" | "settled";

type ChainState = {
  supported: boolean;
  title: string;
  poolId?: string;
  outcome?: "YES" | "NO" | "VOID" | "LIVE";
  orderStatus?: "Pending" | "Included" | "Refunded" | "Redeemed";
  lifecycle?: PositionLifecycle;
  action?: PositionAction;
  settlement?: SettlementEstimate;
  feeBps?: number;
  privateChangeAmount?: bigint;
  privateTerminalAmount?: bigint;
};

const SIDE_STYLE = {
  "1": { label: "YES", color: "#16c784" },
  "0": { label: "NO", color: "#f0564a" },
} as const;

const LIFECYCLE: Record<PositionLifecycle, { label: string; detail: string; tone: string }> = {
  awaiting_submission: { label: "Action required", detail: "The order is on-chain but still needs its private committee submission.", tone: "#f5b942" },
  awaiting_batch: { label: "Awaiting batch", detail: "The committee has the encrypted order and is waiting for a private batch.", tone: "#69a7ff" },
  active: { label: "Active", detail: "The order is included and the market is still open.", tone: "#69a7ff" },
  closed: { label: "Resolving", detail: "Betting is closed. Final batching and oracle resolution are pending.", tone: "#f5b942" },
  recover_execution_change: { label: "USDC ready", detail: "The batch executed. Recover the unused order budget without revealing the position side.", tone: "#16c784" },
  claim_winnings: { label: "Won", detail: "Winnings and unused collateral are ready to claim.", tone: "#16c784" },
  recover_collateral: { label: "Lost", detail: "No winnings were earned. Remaining unused USDC is ready to recover.", tone: "#f0564a" },
  lost: { label: "Lost", detail: "This position earned no winnings and has no remaining collateral to recover.", tone: "#f0564a" },
  full_refund: { label: "Full refund", detail: "The position was voided or missed the final private batch.", tone: "#f5b942" },
  claimed: { label: "Claimed", detail: "Winnings and remaining collateral were paid.", tone: "#16c784" },
  recovered: { label: "Recovered", detail: "The losing position earned no winnings and its remaining USDC was recovered.", tone: "#a1a1aa" },
  refunded: { label: "Refunded", detail: "The full public collateral bucket was returned.", tone: "#a1a1aa" },
};

const ACTIVE = new Set<PositionLifecycle>(["awaiting_submission", "awaiting_batch", "active", "closed", "recover_execution_change"]);
const SETTLED = new Set<PositionLifecycle>(["claimed", "recovered", "refunded", "lost"]);

function queryPosition(position: Position) {
  const entry = findMarket(position.market);
  const poolId = position.pool;
  if (!poolId) {
    return Promise.resolve<ChainState>({
      supported: false,
      title: entry?.title ?? "Unavailable test market",
    });
  }
  if (position.protocol === "shared-vault") {
    if (
      position.privateEpoch === undefined ||
      position.privateSequence === undefined ||
      position.executionChangeNullifier === undefined ||
      position.stakeAmountAtomic === undefined
    ) {
      return Promise.reject(new Error("Private activity record is incomplete"));
    }
    return Promise.all([
      getMarketInfo(position.market),
      getPrivatePositionState({
        address: position.address,
        market: position.market,
        epochNumber: BigInt(position.privateEpoch),
        sequence: BigInt(position.privateSequence),
        positionCommitment: BigInt(position.commitment),
        side: position.side === "1" ? 1 : 0,
        positionBudget: BigInt(position.stakeAmountAtomic),
        executionChangeNullifier: BigInt(position.executionChangeNullifier),
        terminalNullifier: BigInt(position.nullifier),
      }),
    ]).then(([info, privateState]) => {
      const winner =
        (position.side === "1" && privateState.outcome === "YES") ||
        (position.side === "0" && privateState.outcome === "NO");
      const now = Math.floor(Date.now() / 1_000);
      let lifecycle: PositionLifecycle;
      if (privateState.terminalSpent) {
        lifecycle = privateState.outcome === "VOID" ||
          privateState.orderStatus === "Pending"
          ? "refunded"
          : winner
            ? "claimed"
            : "lost";
      } else if (privateState.action === "recover-change") {
        lifecycle = "recover_execution_change";
      } else if (privateState.action === "claim") {
        lifecycle = "claim_winnings";
      } else if (privateState.action === "refund") {
        lifecycle = "full_refund";
      } else if (privateState.orderStatus === "Pending") {
        lifecycle = "awaiting_batch";
      } else if (privateState.outcome === "LIVE") {
        lifecycle = now < Number(info.expiry) ? "active" : "closed";
      } else {
        lifecycle = winner ? "claim_winnings" : "lost";
      }
      return {
        supported: true,
        title: entry?.title ?? `${String(info.asset)} price market`,
        poolId,
        outcome: privateState.outcome,
        lifecycle,
        action: privateState.action,
        privateChangeAmount: privateState.changeAmount,
        privateTerminalAmount: privateState.terminalAmount,
      } satisfies ChainState;
    });
  }
  return Promise.all([
    getOutcome(position.market),
    getMarketInfo(position.market),
    getOrder(position.commitment, poolId),
    getClearingPrice(poolId),
    getFeeConfig(poolId),
    getPoolMarket(poolId),
    getPoolCollateral(poolId),
    getMarketCollateral(position.market),
  ]).then(([rawOutcome, info, order, priceYes, feeConfig, linkedMarket, poolCollateral, marketCollateral]) => {
    if (linkedMarket !== position.market || poolCollateral !== NETWORK.collateral.sac || marketCollateral !== NETWORK.collateral.sac) {
      return { supported: false, title: entry?.title ?? "Unsupported test market" } satisfies ChainState;
    }
    const outcome = outcomeLabel(rawOutcome);
    const record = order as { status?: unknown } | null;
    const orderStatus = parseOrderStatus(record?.status ?? order);
    if (!orderStatus) throw new Error("The on-chain order state is invalid");
    const now = Math.floor(Date.now() / 1000);
    const expiry = Number(info.expiry);
    const finalizable = now >= Number(info.finalize_after ?? info.expiry);
    const acceptingOrders = outcome === "LIVE" && now < expiry;
    const settlement = outcome === "YES" || outcome === "NO"
      ? estimateSettlement({
          amount: position.amount,
          stakeAmount: position.stakeAmount,
          side: position.side,
          outcome,
          priceYes,
          feeBps: Number(feeConfig[1]),
          decimals: NETWORK.collateral.decimals,
        })
      : undefined;
    const derived = derivePositionLifecycle({
      localStatus: position.status,
      orderStatus,
      outcome,
      acceptingOrders,
      finalizable,
      winner: settlement?.winner,
      payoutAtomic: settlement?.payoutAtomic,
    });
    return {
      supported: true,
      title: entry?.title ?? `${String(info.asset)} price market`,
      poolId,
      outcome,
      orderStatus,
      lifecycle: derived.lifecycle,
      action: derived.action,
      settlement,
      feeBps: Number(feeConfig[1]),
    } satisfies ChainState;
  });
}

function actionLabel(action: PositionAction, busy: boolean): string {
  if (busy) {
    if (action === "refund") return "Refunding";
    if (action === "retry") return "Retrying";
    if (action === "recover-change") return "Recovering";
    return "Proving claim";
  }
  if (action === "claim") return "Claim winnings";
  if (action === "recover") return "Recover remaining USDC";
  if (action === "recover-change") return "Recover unused USDC";
  if (action === "refund") return "Claim full refund";
  if (action === "retry") return "Retry private submission";
  return "Unavailable";
}

function PositionActionButton({
  position,
  state,
  onCompleted,
}: {
  position: Position;
  state: ChainState;
  onCompleted: () => void;
}) {
  const address = useWalletAddress();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<RedeemStage | BetStage | string | null>(null);
  const [error, setError] = useState("");
  const action = state.action;

  async function execute() {
    if (!address || !action || !state.poolId) return;
    setBusy(true);
    setError("");
    try {
      let status: "submitted" | "redeemed" | "refunded";
      let settlementTxHash: string | undefined;
      let changeTxHash: string | undefined;
      if (position.protocol === "shared-vault") {
        if (
          action === "retry" ||
          action === "recover" ||
          position.privateEpoch === undefined ||
          position.privateSequence === undefined
        ) {
          throw new Error("Private position action is incompatible");
        }
        const result = await runPrivatePositionAction({
          address,
          market: position.market,
          epochNumber: BigInt(position.privateEpoch),
          sequence: BigInt(position.privateSequence),
          positionCommitment: BigInt(position.commitment),
          side: position.side === "1" ? 1 : 0,
          encryptionRandomness: BigInt(position.secret),
          action,
          onStatus: setStage,
        });
        if (action === "recover-change") {
          status = "submitted";
          changeTxHash = result.hash;
        } else {
          status = action === "refund" ? "refunded" : "redeemed";
          settlementTxHash = result.hash;
        }
      } else if (action === "retry") {
        const backupKey = await unlockPositionBackup(address);
        await retryBetSubmission({ position, poolId: state.poolId, backupKey, onStage: setStage });
        status = "submitted";
      } else if (action === "refund") {
        setStage("submitting");
        settlementTxHash = await refundOrder(position.commitment, state.poolId);
        status = "refunded";
      } else {
        const result = await runRedeem({
          position,
          address,
          marketId: position.market,
          poolId: state.poolId,
          onStage: setStage,
        });
        settlementTxHash = result.txHash;
        status = "redeemed";
      }
      updatePosition(address, position.commitment, {
        status,
        settlementTxHash,
        changeTxHash,
      });
      try {
        const backupKey = await preparePositionBackup(address);
        await savePositionBackup({
          ...position,
          status,
          settlementTxHash,
          changeTxHash,
        }, backupKey);
      } catch (cause) {
        updatePosition(address, position.commitment, {
          backupStatus: "local",
          backupError: cause instanceof Error ? cause.message : "Encrypted backup update failed",
        });
      }
      onCompleted();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Position action failed";
      setError(message.includes("NotIncluded") || message.includes("#15")
        ? "This order is not in a settled private batch yet. Retry after batching completes."
        : message);
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  if (!action) return null;
  return (
    <div className="space-y-2">
      <Button size="sm" disabled={busy} onClick={execute}>
        {busy && <Spinner className="size-3" />}
        {actionLabel(action, busy)}
      </Button>
      {stage && busy && <p className="text-xs text-muted-foreground">{stage === "proving" ? "Generating proof privately in this browser" : "Submitting safely"}</p>}
      {error && <p className="max-w-xl text-xs text-red-400">{error}</p>}
    </div>
  );
}

function PositionCard({
  position,
  state,
  loading,
  error,
  onCompleted,
}: {
  position: Position;
  state?: ChainState;
  loading: boolean;
  error: boolean;
  onCompleted: () => void;
}) {
  const side = SIDE_STYLE[position.side];
  const lifecycle = state?.lifecycle;
  const display = lifecycle ? LIFECYCLE[lifecycle] : null;
  const payout = state?.settlement?.payoutAtomic;
  const fee = state?.settlement?.feeAtomic;
  const showsRefund = state?.action === "refund" || lifecycle === "refunded";
  return (
    <Panel className="overflow-hidden">
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 space-y-1.5">
            {state?.supported ? (
              <Link href={`/app/market/${position.market}`} className="line-clamp-2 text-base font-medium hover:underline">
                {state.title}
              </Link>
            ) : (
              <p className="text-base font-medium">{state?.title ?? "Loading market"}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Placed {new Date(position.placedAt).toLocaleString()}
            </p>
          </div>
          {display && (
            <span className="w-fit rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider" style={{ borderColor: `${display.tone}66`, color: display.tone }}>
              {display.label}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Side</p>
            <p className="mt-1 text-sm font-medium" style={{ color: side.color }}>{side.label}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Position</p>
            <p className="mt-1 text-sm">{position.amount} shares</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">USDC locked</p>
            <p className="mt-1 text-sm">
              {position.stakeAmountAtomic
                ? formatTokenAmount(BigInt(position.stakeAmountAtomic), NETWORK.collateral.decimals, 4)
                : position.stakeAmount} USDC
            </p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Outcome</p>
            <p className="mt-1 text-sm">{state?.outcome ?? "Pending"}</p>
          </div>
        </div>

        {display && <p className="text-sm text-muted-foreground">{display.detail}</p>}
        {state?.settlement && (state.action === "claim" || state.action === "recover" || lifecycle === "claimed" || lifecycle === "recovered") && (
          <div className="grid gap-3 rounded-md border border-foreground/10 bg-foreground/[0.025] p-4 sm:grid-cols-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {state.settlement.winner ? "Estimated payout" : "Remaining USDC"}
              </p>
              <p className="mt-1 text-sm font-medium">{formatTokenAmount(payout ?? 0n, NETWORK.collateral.decimals, 4)} USDC</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Platform fee</p>
              <p className="mt-1 text-sm">{formatTokenAmount(fee ?? 0n, NETWORK.collateral.decimals, 4)} USDC</p>
            </div>
          </div>
        )}
        {state?.privateChangeAmount !== undefined &&
          (state.action === "recover-change" || position.changeTxHash) && (
          <div className="rounded-md border border-foreground/10 bg-foreground/[0.025] p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Unused order budget</p>
            <p className="mt-1 text-sm font-medium">
              {formatTokenAmount(state.privateChangeAmount, NETWORK.collateral.decimals, 4)} USDC
            </p>
          </div>
        )}
        {state?.privateTerminalAmount !== undefined &&
          state.privateTerminalAmount > 0n &&
          (state.action === "claim" || lifecycle === "claimed") && (
          <div className="rounded-md border border-foreground/10 bg-foreground/[0.025] p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Private payout</p>
            <p className="mt-1 text-sm font-medium">
              {formatTokenAmount(state.privateTerminalAmount, NETWORK.collateral.decimals, 4)} USDC
            </p>
          </div>
        )}
        {showsRefund && (
          <div className="rounded-md border border-foreground/10 bg-foreground/[0.025] p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Full refund</p>
            <p className="mt-1 text-sm font-medium">
              {state?.privateTerminalAmount !== undefined
                ? formatTokenAmount(state.privateTerminalAmount, NETWORK.collateral.decimals, 4)
                : position.stakeAmount} USDC
            </p>
          </div>
        )}

        {loading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-3" />Reading on-chain position state</p>}
        {error && <p className="text-sm text-red-400">Could not read this position from Stellar. No action is enabled until the state is verified.</p>}
        {state && !state.supported && <p className="text-sm text-amber-300">This older test record is not part of the active USDC testnet release. Moros will not guess its pool or collateral.</p>}

        {state?.supported && <PositionActionButton position={position} state={state} onCompleted={onCompleted} />}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-foreground/10 pt-4 text-xs text-muted-foreground">
          <a href={NETWORK.transactionExplorer(position.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
            Placement transaction <ExternalLink className="h-3 w-3" />
          </a>
          {position.settlementTxHash && (
            <a href={NETWORK.transactionExplorer(position.settlementTxHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
              Settlement transaction <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {position.changeTxHash && (
            <a href={NETWORK.transactionExplorer(position.changeTxHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
              Change recovery transaction <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <span className={position.backupStatus === "synced" ? "text-emerald-400" : "text-amber-300"}>
            {position.backupStatus === "synced" ? "Encrypted backup synced" : "Stored in this browser only"}
          </span>
        </div>
      </div>
    </Panel>
  );
}

export function PositionsList() {
  const address = useWalletAddress();
  const [positions, setPositions] = useState<Position[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const states = useQueries({
    queries: positions.map((position) => ({
      queryKey: ["wallet-position", position.market, position.pool, position.commitment, position.status],
      refetchInterval: 15_000,
      retry: 1,
      queryFn: () => queryPosition(position),
    })),
  });

  function reload() {
    setPositions(address ? listPositions(address) : []);
    for (const state of states) state.refetch();
  }

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribePositions(() => {
      if (!cancelled) setPositions(address ? listPositions(address) : []);
    });
    getPrivateConfig()
      .then((config) => {
        if (cancelled) return;
        configurePositionBook(config.contracts.sharedVault);
        setPositions(address ? listPositions(address) : []);
      })
      .catch(() => {
        if (!cancelled) setPositions([]);
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [address]);

  const counts = useMemo(() => {
    let active = 0;
    let action = 0;
    let settled = 0;
    states.forEach((query) => {
      const lifecycle = query.data?.lifecycle;
      if (!lifecycle) return;
      if (ACTIVE.has(lifecycle)) active++;
      if (query.data?.action) action++;
      if (SETTLED.has(lifecycle)) settled++;
    });
    return { active, action, settled };
  }, [states]);

  const visible = positions.filter((position, index) => {
    const state = states[index]?.data;
    if (filter === "all") return true;
    if (filter === "action") return !!state?.action;
    if (filter === "active") return !!state?.lifecycle && ACTIVE.has(state.lifecycle);
    return !!state?.lifecycle && SETTLED.has(state.lifecycle);
  });

  async function restore() {
    if (!address) return;
    setBackupBusy(true);
    setBackupMessage("");
    try {
      const key = await preparePositionBackup(address);
      const added = await restorePositionBackups(address, key);
      setBackupMessage(added > 0 ? `Restored ${added} position${added === 1 ? "" : "s"}.` : "Encrypted backup is already up to date.");
      reload();
    } catch (cause) {
      setBackupMessage(cause instanceof Error ? cause.message : "Could not restore encrypted backup");
    } finally {
      setBackupBusy(false);
    }
  }

  async function sync() {
    if (!address) return;
    setBackupBusy(true);
    setBackupMessage("");
    try {
      const key = await preparePositionBackup(address);
      const eligible = listPositions(address).filter((position) => position.pool);
      for (const position of eligible) await savePositionBackup(position, key);
      setBackupMessage(`Synced ${eligible.length} encrypted position${eligible.length === 1 ? "" : "s"}.`);
      reload();
    } catch (cause) {
      setBackupMessage(cause instanceof Error ? cause.message : "Could not sync encrypted backup");
    } finally {
      setBackupBusy(false);
    }
  }

  async function exportFile() {
    if (!address) return;
    setBackupBusy(true);
    setBackupMessage("");
    try {
      const key = await unlockPositionBackup(address);
      const contents = await exportEncryptedPositionFile(address, key);
      const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `moros-${NETWORK.id}-positions.json`;
      link.click();
      URL.revokeObjectURL(url);
      setBackupMessage("Encrypted recovery file created.");
    } catch (cause) {
      setBackupMessage(cause instanceof Error ? cause.message : "Could not create recovery file");
    } finally {
      setBackupBusy(false);
    }
  }

  async function importFile(file?: File) {
    if (!address || !file) return;
    setBackupBusy(true);
    setBackupMessage("");
    try {
      const key = await unlockPositionBackup(address);
      const added = await importEncryptedPositionFile(await file.text(), address, key);
      setBackupMessage(added > 0 ? `Imported ${added} position${added === 1 ? "" : "s"}.` : "Recovery file is already present.");
      reload();
    } catch (cause) {
      setBackupMessage(cause instanceof Error ? cause.message : "Could not import recovery file");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
      setBackupBusy(false);
    }
  }

  if (!address) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-lg font-medium">Connect your wallet to view private position history</p>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">Only the connected wallet can unlock its encrypted recovery records.</p>
        <Button className="mt-5" onClick={() => connectWallet()}>Connect wallet</Button>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Panel className="p-4"><p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Positions</p><p className="mt-2 text-2xl font-medium">{positions.length}</p></Panel>
        <Panel className="p-4"><p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Active</p><p className="mt-2 text-2xl font-medium">{counts.active}</p></Panel>
        <Panel className="p-4"><p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Action required</p><p className="mt-2 text-2xl font-medium" style={{ color: counts.action > 0 ? "#f5b942" : undefined }}>{counts.action}</p></Panel>
      </div>

      <Panel className="p-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium"><Cloud className="h-4 w-4" />Encrypted recovery</p>
            <p className="mt-1 text-xs text-muted-foreground">Position secrets are encrypted in this browser before backup. Moros never receives the decryption key.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={backupBusy} onClick={restore}><RefreshCw className="h-3.5 w-3.5" />Restore</Button>
            <Button size="sm" variant="outline" disabled={backupBusy} onClick={sync}><Cloud className="h-3.5 w-3.5" />Sync</Button>
            <Button size="sm" variant="outline" disabled={backupBusy || positions.length === 0} onClick={exportFile}><Download className="h-3.5 w-3.5" />Export</Button>
            <Button size="sm" variant="outline" disabled={backupBusy} onClick={() => fileInput.current?.click()}><Upload className="h-3.5 w-3.5" />Import</Button>
            <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => importFile(event.target.files?.[0])} />
          </div>
        </div>
        {backupBusy && <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="size-3" />Waiting for wallet and encrypted storage</p>}
        {backupMessage && <p className="mt-3 text-xs" style={{ color: ACCENT }}>{backupMessage}</p>}
      </Panel>

      <div className="flex flex-wrap gap-2">
        {([
          ["all", `All ${positions.length}`],
          ["active", `Active ${counts.active}`],
          ["action", `Action required ${counts.action}`],
          ["settled", `Settled ${counts.settled}`],
        ] as [Filter, string][]).map(([key, label]) => (
          <Button key={key} size="sm" variant={filter === key ? "default" : "outline"} onClick={() => setFilter(key)}>{label}</Button>
        ))}
      </div>

      {positions.length === 0 ? (
        <Panel className="p-8 text-center">
          <p className="text-lg font-medium">No private positions found</p>
          <p className="mt-2 text-sm text-muted-foreground">Restore an encrypted backup or place a private USDC position.</p>
          <Button className="mt-5" asChild><Link href="/app">Browse markets</Link></Button>
        </Panel>
      ) : visible.length === 0 ? (
        <Panel className="p-8 text-center text-sm text-muted-foreground">No positions match this filter.</Panel>
      ) : (
        <div className="space-y-4">
          {visible.map((position) => {
            const index = positions.findIndex((item) => item.commitment === position.commitment);
            const query = states[index];
            return (
              <PositionCard
                key={position.commitment}
                position={position}
                state={query?.data}
                loading={!!query?.isLoading}
                error={!!query?.isError}
                onCompleted={reload}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
