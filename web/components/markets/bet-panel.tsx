"use client";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Panel, Tag } from "@/components/app/app-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useMarket } from "@/lib/stellar/use-market";
import { centsLabel } from "@/lib/stellar/derive";
import { useActiveMarket } from "@/lib/markets/market-context";
import { useWalletAddress, connectWallet } from "@/lib/wallet-store";
import { runBet, type BetSide, type BetStage } from "@/lib/bet/flow";
import {
  addCollateralTrustline,
  getCollateralAccountState,
  type CollateralAccountState,
} from "@/lib/stellar/collateral-account";
import { formatTokenAmount, parseWholeOrderAmount } from "@/lib/stellar/amount";
import { NETWORK } from "@/lib/network";

const STAGES: { key: BetStage; label: string }[] = [
  { key: "hashing", label: "Hashing commitment" },
  { key: "placing", label: "Placing order on-chain" },
  { key: "proving", label: "Proving privately in your browser - this can take a few minutes" },
  { key: "submitting", label: "Submitting ciphertext to committee" },
  { key: "done", label: "Position placed privately" },
];

const YES = "#16c784";
const NO = "#f0564a";

function SideButton({
  active,
  disabled,
  label,
  price,
  color,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  price: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-16 flex-col items-center justify-center gap-1 rounded-md border font-mono uppercase tracking-wider transition-colors disabled:opacity-50"
      style={active ? { backgroundColor: color, borderColor: color, color: "#0a0a0a" } : { borderColor: "rgba(255,255,255,0.1)" }}
    >
      <span className="text-sm">{label}</span>
      <span className="text-xs opacity-80">{price}</span>
    </button>
  );
}

export function BetPanel() {
  const { data } = useMarket();
  const { marketId, poolId, collateral } = useActiveMarket();
  const address = useWalletAddress();
  const [side, setSide] = useState<BetSide>("1");
  const [amount, setAmount] = useState("10");
  const [stage, setStage] = useState<BetStage | null>(null);
  const [error, setError] = useState("");
  const [accountState, setAccountState] = useState<CollateralAccountState | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [trustlineLoading, setTrustlineLoading] = useState(false);
  const busy = stage !== null && stage !== "done";
  const resolved = data ? data.outcome !== "LIVE" : false;

  const prob = side === "1" ? data?.probYes ?? null : data ? 1 - data.probYes : null;
  const stake = Number(amount);
  const estReturn = prob && prob > 0 && stake > 0 ? stake / prob : null;
  let stakeAtomic: bigint | null = null;
  try {
    stakeAtomic = parseWholeOrderAmount(amount, collateral.decimals).atomic;
  } catch {
    stakeAtomic = null;
  }
  const insufficient = !!accountState && stakeAtomic !== null && accountState.balanceAtomic < stakeAtomic;

  useEffect(() => {
    let cancelled = false;
    setAccountState(null);
    if (!address) return;
    setAccountLoading(true);
    getCollateralAccountState(address, collateral)
      .then((state) => {
        if (!cancelled) setAccountState(state);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : `Could not read ${collateral.code} balance`);
      })
      .finally(() => {
        if (!cancelled) setAccountLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, collateral]);

  async function connect() {
    try {
      await connectWallet();
    } catch {
      return;
    }
  }

  async function submit() {
    setError("");
    setStage(null);
    try {
      if (!accountState?.hasTrustline) throw new Error(`Enable ${collateral.code} before placing a bet`);
      if (insufficient) throw new Error(`Insufficient ${collateral.code} balance`);
      await runBet({ side, amount, address, collateral, marketId, poolId, onStage: setStage });
      setAccountState(await getCollateralAccountState(address, collateral));
    } catch (e) {
      setError(e instanceof Error ? e.message : "private bet failed");
      setStage(null);
    }
  }

  async function enableCollateral() {
    setError("");
    setTrustlineLoading(true);
    try {
      await addCollateralTrustline(address, collateral);
      setAccountState(await getCollateralAccountState(address, collateral));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not enable ${collateral.code}`);
    } finally {
      setTrustlineLoading(false);
    }
  }

  function reset() {
    setStage(null);
    setError("");
    setAmount("10");
  }

  const activeIndex = stage ? STAGES.findIndex((s) => s.key === stage) : -1;

  return (
    <Panel className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Tag>Private bet</Tag>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          hidden until redeem
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SideButton
          active={side === "1"}
          disabled={busy || resolved}
          label="Yes"
          price={centsLabel(data ? data.probYes : null)}
          color={YES}
          onClick={() => setSide("1")}
        />
        <SideButton
          active={side === "0"}
          disabled={busy || resolved}
          label="No"
          price={centsLabel(data ? 1 - data.probYes : null)}
          color={NO}
          onClick={() => setSide("0")}
        />
      </div>

      <div className="space-y-2">
        <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
          Amount ({collateral.code})
        </span>
        <Input
          type="number"
          min="1"
          step="1"
          value={amount}
          disabled={busy || resolved}
          onChange={(e) => setAmount(e.target.value)}
          className="h-11 border-white/15 bg-white/[0.04] text-base focus-visible:border-white/30"
        />
        <div className="space-y-1.5 pt-1 font-mono text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>Shares (est.)</span>
            <span className="text-foreground">
              {estReturn ? `≈ ${estReturn.toFixed(2)} ${side === "1" ? "YES" : "NO"}` : "--"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Max payout if {side === "1" ? "YES" : "NO"} wins</span>
            <span className="text-foreground">{estReturn ? `~${estReturn.toFixed(2)} ${collateral.code}` : "--"}</span>
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground/70">
            Each winning share redeems for 1 {collateral.code}. Final count is set at the batch clearing price.
          </p>
          {address && accountState?.hasTrustline && (
            <p className="text-[10px] leading-snug text-muted-foreground/70">
              Available: {formatTokenAmount(accountState.balanceAtomic, collateral.decimals, 2)} {collateral.code}
            </p>
          )}
        </div>
      </div>

      {resolved ? (
        <p className="text-sm text-muted-foreground">
          This market has resolved. Head to your positions to redeem.
        </p>
      ) : stage === "done" ? (
        <div className="space-y-3 rounded-md border p-4" style={{ borderColor: `${YES}44`, backgroundColor: `${YES}0f` }}>
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: YES }}>
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Position placed privately
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Your side is hidden on-chain and the committee only ever sees the batch net. Track it under Portfolio and redeem once the market resolves.
          </p>
          <Button className="w-full" onClick={reset}>Place another bet</Button>
        </div>
      ) : !address ? (
        <Button className="w-full" onClick={connect}>
          Connect wallet to bet
        </Button>
      ) : accountLoading ? (
        <Button className="w-full" disabled>
          <Spinner />
          Checking {collateral.code}
        </Button>
      ) : accountState && !accountState.hasTrustline ? (
        <div className="space-y-3">
          <Button className="w-full" disabled={trustlineLoading} onClick={enableCollateral}>
            {trustlineLoading && <Spinner />}
            {trustlineLoading ? `Enabling ${collateral.code}` : `Enable ${collateral.code}`}
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Stellar requires a one-time trustline before your wallet can hold {collateral.code}. You also need a small XLM balance for network fees and reserve.
          </p>
          {NETWORK.id === "testnet" && collateral.code === "USDC" && (
            <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer" className="block text-xs underline text-muted-foreground hover:text-foreground">
              Get testnet USDC from Circle
            </a>
          )}
        </div>
      ) : (
        <Button className="w-full" disabled={busy || insufficient || !stakeAtomic} onClick={submit}>
          {busy && <Spinner />}
          {busy ? "Placing private bet" : insufficient ? `Insufficient ${collateral.code}` : "Place private bet"}
        </Button>
      )}

      {busy && stage && (
        <div className="space-y-2 border-t border-foreground/10 pt-4">
          {STAGES.map((s, i) => (
            <div key={s.key} className="flex items-center gap-3 text-sm">
              {i === activeIndex ? (
                <Spinner className="size-3 shrink-0" />
              ) : (
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: i <= activeIndex ? YES : "rgba(255,255,255,0.15)" }}
                />
              )}
              <span className={i <= activeIndex ? "" : "text-muted-foreground"}>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm" style={{ color: NO }}>{error}</p>}
    </Panel>
  );
}
