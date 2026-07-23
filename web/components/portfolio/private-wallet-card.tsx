"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CircleAlert,
  CircleDollarSign,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UnlockKeyhole,
  WalletCards,
} from "lucide-react";
import { Panel, Tag } from "@/components/app/app-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { NETWORK } from "@/lib/network";
import {
  shieldUsdc,
  withdrawPrivateUsdc,
} from "@/lib/private/actions";
import { openPrivateWallet } from "@/lib/private/wallet";
import {
  addCollateralTrustline,
  getCollateralAccountState,
  type CollateralAccountState,
} from "@/lib/stellar/collateral-account";
import {
  formatTokenAmount,
  parseTokenAmount,
} from "@/lib/stellar/amount";
import { connectWallet, useWalletAddress } from "@/lib/wallet-store";

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function PrivateWalletCard() {
  const address = useWalletAddress();
  const [account, setAccount] = useState<CollateralAccountState | null>(null);
  const [privateBalance, setPrivateBalance] = useState<bigint | null>(null);
  const [amount, setAmount] = useState("5");
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [busy, setBusy] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const refreshPublicBalance = useCallback(async () => {
    if (!address) {
      setAccount(null);
      return null;
    }
    setAccountLoading(true);
    try {
      const next = await getCollateralAccountState(address, NETWORK.collateral);
      setAccount(next);
      return next;
    } finally {
      setAccountLoading(false);
    }
  }, [address]);

  useEffect(() => {
    setPrivateBalance(null);
    setStatus("");
    setError("");
    void refreshPublicBalance().catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Wallet USDC balance could not be read");
    });
  }, [refreshPublicBalance]);

  async function unlock() {
    if (!address) return;
    setBusy(true);
    setStatus("Unlocking encrypted private notes");
    setError("");
    try {
      const wallet = await openPrivateWallet(address);
      setPrivateBalance(wallet.balance);
      setStatus("Private balance unlocked");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Private balance could not be unlocked");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function enableUsdc() {
    if (!address) return;
    setBusy(true);
    setStatus("Enabling Stellar USDC");
    setError("");
    try {
      await addCollateralTrustline(address, NETWORK.collateral);
      await refreshPublicBalance();
      setStatus("Stellar USDC is enabled");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "USDC could not be enabled");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function deposit() {
    if (!address) return;
    setBusy(true);
    setStatus("Checking deposit");
    setError("");
    try {
      const amountAtomic = parseTokenAmount(amount, NETWORK.collateral.decimals);
      const publicAccount = account ?? await refreshPublicBalance();
      if (!publicAccount?.hasTrustline) {
        throw new Error("Enable Stellar USDC before adding a private balance");
      }
      if (publicAccount.balanceAtomic < amountAtomic) {
        throw new Error("Wallet USDC balance is lower than the deposit amount");
      }
      const wallet = await openPrivateWallet(address);
      const priorBalance = wallet.balance;
      setPrivateBalance(priorBalance);
      await shieldUsdc(address, amountAtomic, setStatus);
      setStatus("Deposit confirmed. Waiting for encrypted notes");
      for (let attempt = 0; attempt < 30; attempt++) {
        await wait(2_000);
        const refreshed = await openPrivateWallet(address);
        if (refreshed.balance >= priorBalance + amountAtomic) {
          setPrivateBalance(refreshed.balance);
          await refreshPublicBalance();
          setStatus("Private USDC is ready for bets and liquidity");
          return;
        }
      }
      throw new Error("Deposit confirmed, but the private indexer has not published the notes yet");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Private USDC deposit failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!address || privateBalance === null) return;
    setBusy(true);
    setStatus("Checking withdrawal");
    setError("");
    try {
      const amountAtomic = parseTokenAmount(amount, NETWORK.collateral.decimals);
      if (privateBalance < amountAtomic) {
        throw new Error("Private USDC balance is lower than the withdrawal amount");
      }
      const priorBalance = privateBalance;
      await withdrawPrivateUsdc(address, amountAtomic, setStatus);
      setStatus("Withdrawal confirmed. Waiting for encrypted notes");
      for (let attempt = 0; attempt < 30; attempt++) {
        await wait(2_000);
        const refreshed = await openPrivateWallet(address);
        if (refreshed.balance <= priorBalance - amountAtomic) {
          setPrivateBalance(refreshed.balance);
          await refreshPublicBalance();
          setStatus("USDC returned to the connected Stellar wallet");
          return;
        }
      }
      throw new Error("Withdrawal confirmed, but the private indexer has not published the change note yet");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Private USDC withdrawal failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  function useMaximum() {
    const maximum = mode === "deposit"
      ? account?.hasTrustline ? account.balanceAtomic : 0n
      : privateBalance ?? 0n;
    setAmount(formatTokenAmount(
      maximum,
      NETWORK.collateral.decimals,
      NETWORK.collateral.decimals,
    ));
    setError("");
  }

  return (
    <Panel className="overflow-hidden">
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.15fr_0.85fr] lg:p-8">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full border border-[#eca8d6]/20 bg-[#eca8d6]/[0.06] text-[#eca8d6]">
              <LockKeyhole className="size-5" aria-hidden="true" />
            </span>
            <div>
              <Tag>Reusable private wallet</Tag>
              <h2 className="mt-1 text-xl font-medium">Private USDC balance</h2>
            </div>
          </div>

          <p className="mt-5 max-w-xl text-sm leading-relaxed text-foreground/60">
            Add USDC once, then use the same private balance across every Moros bet, market liquidity position, exit, claim, and refund.
          </p>

          <div className="mt-6 rounded-lg border border-white/[0.08] bg-black/15 p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/45">
              Available privately
            </p>
            <p className="mt-2 font-display text-4xl tracking-tight">
              {privateBalance === null
                ? "Locked"
                : `${formatTokenAmount(privateBalance, NETWORK.collateral.decimals, 4)} USDC`}
            </p>
            {address && account?.hasTrustline && (
              <p className="mt-2 font-mono text-xs text-foreground/45">
                Public wallet: {formatTokenAmount(account.balanceAtomic, NETWORK.collateral.decimals, 4)} USDC
              </p>
            )}
          </div>

          <div className="mt-4 grid gap-2 text-xs leading-relaxed text-foreground/55 sm:grid-cols-2">
            <div className="rounded-md border border-white/[0.07] p-3">
              <p className="font-medium text-foreground/80">Public boundary</p>
              <p className="mt-1">Your Stellar wallet and deposit amount are visible when USDC enters the shielded vault.</p>
            </div>
            <div className="rounded-md border border-white/[0.07] p-3">
              <p className="font-medium text-foreground/80">Private inside Moros</p>
              <p className="mt-1">Balance ownership, bets, LP allocations, exits, and claims are recovered from encrypted notes.</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center rounded-lg border border-white/[0.08] bg-white/[0.025] p-4 sm:p-5">
          {!address ? (
            <Button onClick={() => void connectWallet()}>
              <WalletCards className="size-4" />
              Connect wallet to unlock
            </Button>
          ) : !account?.hasTrustline && !accountLoading ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 text-sm text-amber-100">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Enable the Circle USDC trustline before depositing.
              </div>
              <Button disabled={busy} onClick={() => void enableUsdc()}>
                {busy ? <Spinner /> : <CircleDollarSign className="size-4" />}
                {busy ? status : "Enable Stellar USDC"}
              </Button>
              {NETWORK.id === "testnet" && (
                <a
                  href="https://faucet.circle.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="block text-xs text-foreground/55 underline hover:text-foreground"
                >
                  Get Circle testnet USDC
                </a>
              )}
            </div>
          ) : privateBalance === null ? (
            <Button disabled={busy || accountLoading} onClick={() => void unlock()}>
              {busy || accountLoading ? <Spinner /> : <ShieldCheck className="size-4" />}
              {busy ? status : accountLoading ? "Reading wallet USDC" : "Unlock private balance"}
            </Button>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 rounded-md border border-white/[0.08] bg-black/15 p-1">
                {(["deposit", "withdraw"] as const).map((nextMode) => (
                  <button
                    key={nextMode}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setMode(nextMode);
                      setAmount("5");
                      setStatus("");
                      setError("");
                    }}
                    className={`rounded px-3 py-2 text-xs font-medium capitalize transition-colors ${
                      mode === nextMode
                        ? "bg-white/[0.09] text-foreground"
                        : "text-foreground/50 hover:text-foreground/75"
                    }`}
                  >
                    {nextMode}
                  </button>
                ))}
              </div>
              <label htmlFor="private-usdc-amount" className="block font-mono text-xs uppercase tracking-wider text-foreground/55">
                {mode === "deposit" ? "Add private USDC" : "Withdraw private USDC"}
              </label>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div className="relative">
                  <Input
                    id="private-usdc-amount"
                    inputMode="decimal"
                    value={amount}
                    disabled={busy}
                    onChange={(event) => {
                      setAmount(event.target.value);
                      setError("");
                    }}
                    className="h-11 pr-16 font-mono"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-xs text-foreground/45">
                    USDC
                  </span>
                </div>
                <Button type="button" variant="outline" disabled={busy} onClick={useMaximum}>
                  Max
                </Button>
              </div>
              <Button
                className="w-full"
                disabled={busy}
                onClick={() => void (mode === "deposit" ? deposit() : withdraw())}
              >
                {busy
                  ? <Spinner />
                  : mode === "deposit"
                    ? <LockKeyhole className="size-4" />
                    : <UnlockKeyhole className="size-4" />}
                {busy
                  ? status
                  : mode === "deposit"
                    ? "Add to private balance"
                    : "Withdraw to Stellar wallet"}
              </Button>
              {mode === "withdraw" && (
                <p className="text-xs leading-relaxed text-amber-100/75">
                  The recipient wallet and withdrawal amount are public on Stellar. Your earlier private activity remains hidden.
                </p>
              )}
              <Button className="w-full" variant="outline" disabled={busy} onClick={() => void unlock()}>
                <RefreshCw className="size-4" />
                Refresh private balance
              </Button>
            </div>
          )}

          {status && !busy && (
            <p className="mt-4 text-xs text-emerald-200">{status}</p>
          )}
          {error && (
            <p role="alert" className="mt-4 text-xs text-red-300">{error}</p>
          )}
        </div>
      </div>
      <div className="border-t border-white/[0.08] px-5 py-3 text-[11px] leading-relaxed text-foreground/45 sm:px-6 lg:px-8">
        Plaintext private balances are not stored in Supabase or browser storage. Your wallet unlocks encrypted recovery data and decrypts the current balance locally.
      </div>
    </Panel>
  );
}
