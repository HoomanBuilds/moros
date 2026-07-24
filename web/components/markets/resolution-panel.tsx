"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Panel, Tag } from "@/components/app/app-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useMarket } from "@/lib/stellar/use-market";
import { getEventConfig, getEventProposal } from "@/lib/stellar/read";
import { challengeEventResult, finalizeEventResult, proposeEventResult, voteEventResult } from "@/lib/stellar/write";
import { outcomeLabel, formatCountdown } from "@/lib/stellar/derive";
import { useActiveMarket } from "@/lib/markets/market-context";
import { useWalletAddress, connectWallet } from "@/lib/wallet-store";
import { getCollateralAccountState } from "@/lib/stellar/collateral-account";
import { formatTokenAmount } from "@/lib/stellar/amount";
import { truncate } from "@/lib/wallet";
import { cn } from "@/lib/utils";

type EventOutcome = "YES" | "NO" | "VOID";
type EventProposal = {
  proposer: string;
  outcome: unknown;
  evidence_ref: string;
  challenge_until: bigint;
  challenger: string | null;
  challenged_outcome: unknown;
  challenged_evidence_ref: string | null;
};

const OUTCOMES: EventOutcome[] = ["YES", "NO", "VOID"];

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function EvidenceLink({ value }: { value: string }) {
  if (!isHttpUrl(value)) return <span className="break-all text-muted-foreground">{value}</span>;
  return (
    <a href={value} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 break-all text-muted-foreground hover:text-foreground">
      Open submitted evidence
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
    </a>
  );
}

export function ResolutionPanel() {
  const { data } = useMarket();
  const { marketId, collateral } = useActiveMarket();
  const address = useWalletAddress();
  const queryClient = useQueryClient();
  const resolverId = data?.resolverId || "";
  const [selected, setSelected] = useState<EventOutcome>("YES");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const configQuery = useQuery({
    queryKey: ["event-config", resolverId],
    enabled: !!resolverId && data?.resolverType === "event",
    queryFn: () => getEventConfig(resolverId),
  });
  const proposalQuery = useQuery({
    queryKey: ["event-proposal", resolverId, marketId],
    enabled: !!resolverId && data?.resolverType === "event",
    refetchInterval: 15000,
    queryFn: () => getEventProposal(resolverId, marketId) as Promise<EventProposal | null>,
  });
  const proposal = proposalQuery.data;
  const proposedOutcome = proposal ? outcomeLabel(proposal.outcome) as EventOutcome : null;
  const challengedOutcome = proposal?.challenger ? outcomeLabel(proposal.challenged_outcome) as EventOutcome : null;
  const now = Math.floor(Date.now() / 1000);
  const challengeUntil = proposal ? Number(proposal.challenge_until) : 0;
  const challengeOpen = !!proposal && !proposal.challenger && now < challengeUntil;
  const readyToFinalize = !!proposal && !proposal.challenger && now >= challengeUntil;
  const arbitrationUntil = proposal?.challenger
    ? challengeUntil + Number(configQuery.data?.challenge_period ?? BigInt(0))
    : 0;
  const arbitrationTimedOut = !!proposal?.challenger && now >= arbitrationUntil;
  const resultWindowOpen = !!data && now >= data.finalizeAfter;
  const bond = configQuery.data?.bond ?? null;
  const hasBond = balance !== null && bond !== null && balance >= bond;
  const isCommitteeMember = !!address && !!configQuery.data?.committee.includes(address);

  const availableOutcomes = useMemo(
    () => proposal ? OUTCOMES.filter((outcome) => outcome !== proposedOutcome) : OUTCOMES,
    [proposal, proposedOutcome],
  );

  useEffect(() => {
    if (proposal && selected === proposedOutcome) setSelected(availableOutcomes[0] ?? "VOID");
  }, [availableOutcomes, proposal, proposedOutcome, selected]);

  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setBalance(null);
      return;
    }
    getCollateralAccountState(address, collateral)
      .then((state) => {
        if (!cancelled) setBalance(state.hasTrustline ? state.balanceAtomic : BigInt(0));
      })
      .catch(() => {
        if (!cancelled) setBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address, collateral]);

  if (data?.resolverType !== "event") return null;

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["event-proposal", resolverId, marketId] }),
      queryClient.invalidateQueries({ queryKey: ["market", marketId] }),
    ]);
    if (address) {
      const state = await getCollateralAccountState(address, collateral);
      setBalance(state.hasTrustline ? state.balanceAtomic : BigInt(0));
    }
  }

  async function submit(kind: "propose" | "challenge" | "finalize" | "vote") {
    setError("");
    if (!address) {
      await connectWallet();
      return;
    }
    if (!data?.rulesVerified) {
      setError("The displayed rules do not match the immutable on-chain rules hash");
      return;
    }
    if (kind !== "finalize" && kind !== "vote" && !isHttpUrl(evidenceRef.trim())) {
      setError("Enter an HTTP or HTTPS evidence URL");
      return;
    }
    if (kind !== "finalize" && kind !== "vote" && !hasBond) {
      setError(`You need ${bond === null ? "the required" : formatTokenAmount(bond, collateral.decimals, 2)} ${collateral.code} for the result bond`);
      return;
    }
    setBusy(true);
    try {
      if (kind === "propose") {
        await proposeEventResult(resolverId, marketId, address, selected, evidenceRef.trim());
      } else if (kind === "challenge") {
        await challengeEventResult(resolverId, marketId, address, selected, evidenceRef.trim());
      } else if (kind === "finalize") {
        await finalizeEventResult(resolverId, marketId);
      } else {
        await voteEventResult(resolverId, marketId, address, selected);
      }
      setEvidenceRef("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Resolution transaction failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Tag>Event resolution</Tag>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            This inactive event foundation uses bonded proposals, challenges, and independent arbitration. New event markets are not enabled on the current testnet.
          </p>
        </div>
        {bond !== null && (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {formatTokenAmount(bond, collateral.decimals, 2)} {collateral.code} bond
          </span>
        )}
      </div>

      {!data.rulesVerified && (
        <p className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">
          Rule verification failed. Betting and resolution actions are blocked.
        </p>
      )}

      {data.outcome !== "LIVE" ? (
        <p className="text-sm text-muted-foreground">This market resolved {data.outcome}.</p>
      ) : proposalQuery.isLoading || configQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading resolution state</div>
      ) : !proposal ? (
        resultWindowOpen ? (
          <div className="space-y-4">
            <OutcomePicker selected={selected} outcomes={OUTCOMES} disabled={busy} onSelect={setSelected} />
            <EvidenceInput value={evidenceRef} disabled={busy} onChange={setEvidenceRef} />
            <Button disabled={busy || !data.rulesVerified} onClick={() => submit("propose")}>
              {busy && <Spinner />}
              Propose bonded result
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Result proposals open after the final encrypted batch window in {formatCountdown(Math.max(0, data.finalizeAfter - now))}.
          </p>
        )
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 rounded-md border border-white/10 bg-white/[0.03] p-4 text-sm sm:grid-cols-2">
            <div><span className="text-muted-foreground">Proposed result:</span> <span className="font-mono">{proposedOutcome}</span></div>
            <div><span className="text-muted-foreground">Proposer:</span> <span className="font-mono">{truncate(proposal.proposer)}</span></div>
            <div className="sm:col-span-2"><EvidenceLink value={proposal.evidence_ref} /></div>
          </div>

          {proposal.challenger ? (
            <div className="space-y-3 rounded-md border border-amber-400/30 bg-amber-400/10 p-4 text-sm">
              <p className="text-amber-200">Disputed as {challengedOutcome}. Independent arbitration is required before the timeout.</p>
              <p className="font-mono text-xs text-muted-foreground">Challenger {truncate(proposal.challenger)}</p>
              {proposal.challenged_evidence_ref && <EvidenceLink value={proposal.challenged_evidence_ref} />}
              {arbitrationTimedOut ? (
                <div className="space-y-3 border-t border-amber-200/20 pt-3">
                  <p className="text-xs text-muted-foreground">The arbitration window expired without a quorum. Anyone can void the market and return both bonds.</p>
                  <Button disabled={busy || !data.rulesVerified} onClick={() => submit("finalize")}>
                    {busy && <Spinner />}
                    Void timed-out dispute
                  </Button>
                </div>
              ) : isCommitteeMember ? (
                <div className="space-y-3 border-t border-amber-200/20 pt-3">
                  <p className="text-xs text-muted-foreground">Your arbitration vote is permanent. The market settles when {configQuery.data?.threshold} members agree.</p>
                  <OutcomePicker selected={selected} outcomes={OUTCOMES} disabled={busy} onSelect={setSelected} />
                  <Button disabled={busy || !data.rulesVerified} onClick={() => submit("vote")}>
                    {busy && <Spinner />}
                    Submit arbitration vote
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Independent arbitrators submit on-chain votes. No single member can resolve the dispute. If no quorum forms, anyone can void it in {formatCountdown(Math.max(0, arbitrationUntil - now))}.</p>
              )}
            </div>
          ) : challengeOpen ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Challenge window closes in {formatCountdown(challengeUntil - now)}.</p>
              {address === proposal.proposer ? (
                <p className="text-sm text-muted-foreground">The proposer cannot challenge their own result.</p>
              ) : (
                <>
                  <OutcomePicker selected={selected} outcomes={availableOutcomes} disabled={busy} onSelect={setSelected} />
                  <EvidenceInput value={evidenceRef} disabled={busy} onChange={setEvidenceRef} />
                  <Button disabled={busy || !data.rulesVerified} onClick={() => submit("challenge")}>
                    {busy && <Spinner />}
                    Challenge with bond
                  </Button>
                </>
              )}
            </div>
          ) : readyToFinalize ? (
            <Button disabled={busy || !data.rulesVerified} onClick={() => submit("finalize")}>
              {busy && <Spinner />}
              Finalize unchallenged result
            </Button>
          ) : null}
        </div>
      )}

      {!address && <Button onClick={() => connectWallet()}>Connect wallet for resolution actions</Button>}
      {address && balance !== null && (
        <p className="font-mono text-xs text-muted-foreground">Available: {formatTokenAmount(balance, collateral.decimals, 2)} {collateral.code}</p>
      )}
      {error && <p className="text-sm text-red-300">{error}</p>}
    </Panel>
  );
}

function OutcomePicker({ selected, outcomes, disabled, onSelect }: { selected: EventOutcome; outcomes: EventOutcome[]; disabled: boolean; onSelect: (outcome: EventOutcome) => void }) {
  return (
    <div className="flex gap-2">
      {outcomes.map((outcome) => (
        <button
          key={outcome}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(outcome)}
          className={cn(
            "rounded-md border px-4 py-2 font-mono text-xs disabled:opacity-50",
            selected === outcome ? "border-white/40 bg-white/[0.08]" : "border-white/10 text-muted-foreground",
          )}
        >
          {outcome}
        </button>
      ))}
    </div>
  );
}

function EvidenceInput({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Result evidence URL</span>
      <Input type="url" value={value} disabled={disabled} maxLength={512} placeholder="https://official-source.example/final-result" onChange={(event) => onChange(event.target.value)} />
      <p className="text-xs text-muted-foreground">The reference and its hash are stored on-chain with the bonded claim.</p>
    </div>
  );
}
