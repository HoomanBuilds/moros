"use client";
import { useEffect, useState } from "react";
import { Panel, Tag } from "@/components/app/app-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ConnectButton } from "@/components/wallet/connect-button";
import { getKit } from "@/lib/wallet";
import { runBet, type BetSide, type BetStage } from "@/lib/bet/flow";

const STAGES: { key: BetStage; label: string }[] = [
  { key: "hashing", label: "Hashing commitment" },
  { key: "placing", label: "Placing order on-chain" },
  { key: "proving", label: "Proving privately in your browser - this can take a few minutes" },
  { key: "submitting", label: "Submitting ciphertext to committee" },
  { key: "done", label: "Position placed privately" },
];

export function BetPanel() {
  const [side, setSide] = useState<BetSide>("1");
  const [amount, setAmount] = useState("10");
  const [address, setAddress] = useState("");
  const [stage, setStage] = useState<BetStage | null>(null);
  const [error, setError] = useState("");
  const busy = stage !== null && stage !== "done";

  useEffect(() => {
    getKit().getAddress().then((r) => setAddress(r.address)).catch(() => {});
  }, []);

  async function submit() {
    setError("");
    setStage(null);
    try {
      await runBet({ side, amount, address, onStage: setStage });
    } catch (e) {
      setError(e instanceof Error ? e.message : "private bet failed");
      setStage(null);
    }
  }

  const activeIndex = stage ? STAGES.findIndex((s) => s.key === stage) : -1;

  return (
    <Panel className="p-6 space-y-6">
      <Tag>Private bet</Tag>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setSide("1")}
          disabled={busy}
          className="h-12 rounded-md font-mono text-sm uppercase tracking-wider border transition-colors disabled:opacity-50"
          style={
            side === "1"
              ? { backgroundColor: "#16c784", borderColor: "#16c784", color: "#0a0a0a" }
              : { borderColor: "rgba(255,255,255,0.1)" }
          }
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => setSide("0")}
          disabled={busy}
          className="h-12 rounded-md font-mono text-sm uppercase tracking-wider border transition-colors disabled:opacity-50"
          style={
            side === "0"
              ? { backgroundColor: "#f0564a", borderColor: "#f0564a", color: "#0a0a0a" }
              : { borderColor: "rgba(255,255,255,0.1)" }
          }
        >
          No
        </button>
      </div>

      <div className="space-y-2">
        <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
          Amount (XLM)
        </span>
        <Input
          type="number"
          min="1"
          step="1"
          value={amount}
          disabled={busy}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      {!address ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Connect a wallet to place a private bet.</p>
          <ConnectButton />
        </div>
      ) : (
        <Button className="w-full" disabled={busy} onClick={submit}>
          {busy && <Spinner />}
          {busy ? "Placing private bet" : "Place private bet"}
        </Button>
      )}

      {stage && (
        <div className="space-y-2 border-t border-foreground/10 pt-4">
          {STAGES.map((s, i) => (
            <div key={s.key} className="flex items-center gap-3 text-sm">
              {i === activeIndex && stage !== "done" ? (
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

      {error && <p className="text-sm" style={{ color: "#f0564a" }}>{error}</p>}
    </Panel>
  );
}
