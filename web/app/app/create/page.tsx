"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Circle,
  CircleAlert,
  CircleDollarSign,
  Clock3,
  Database,
  Link2,
  LockKeyhole,
  ShieldCheck,
  WalletCards,
  Zap,
} from "lucide-react";
import { Panel, Tag } from "@/components/app/app-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { AssetIcon } from "@/components/markets/asset-icon";
import { AssetSpotChart } from "@/components/markets/asset-spot-chart";
import {
  EventSubjectMediaPicker,
  type SelectedMarketImage,
} from "@/components/markets/event-subject-media-picker";
import {
  CATEGORY_PRESENTATION,
  MarketCategoryIcon,
} from "@/components/markets/market-category-icon";
import { MarketBanner, MarketVisual } from "@/components/markets/market-visual";
import { EVENT_MARKETS_ENABLED, ORACLE_MODE } from "@/lib/markets/deploy-constants";
import { useAssetPrice } from "@/lib/prices/use-asset-price";
import { useWalletAddress, connectWallet } from "@/lib/wallet-store";
import {
  clearPendingProposal,
  getPendingProposal,
  proposeMarket,
  type PendingProposal,
  type ProposalStep,
} from "@/lib/markets/propose";
import {
  getPrivateConfig,
  registerPrivateProposal,
} from "@/lib/private/client";
import { saveMarketToRegistry } from "@/lib/supabase/markets-meta";
import { uploadMarketBanner } from "@/lib/supabase/market-media";
import { cn } from "@/lib/utils";
import { NETWORK } from "@/lib/network";
import {
  MIN_MARKET_LEAD_SECONDS,
  marketExpiryError,
  parseMarketExpiry,
  presetExpiryLocal,
  toLocalDateTimeValue,
} from "@/lib/markets/expiry";
import {
  MARKET_CATEGORIES,
  assetsForCategory,
  eventGuidance,
  isPriceCategory,
  type EventCategory,
  type MarketCategory,
} from "@/lib/markets/categories";

const STEPS: { key: ProposalStep; label: string }[] = [
  { key: "configuration", label: "Checking private testnet policy" },
  { key: "proposal", label: "Creating the market proposal" },
  { key: "liquidity", label: "Registering with the liquidity pool" },
  { key: "listing", label: "Publishing the market" },
  { key: "done", label: "Market queued for activation" },
];

const EXPIRY_PRESETS = [
  { key: "1h", label: "1 hour", detail: "Intraday", seconds: 60 * 60 },
  { key: "1d", label: "1 day", detail: "Tomorrow", seconds: 24 * 60 * 60 },
  { key: "7d", label: "7 days", detail: "This week", seconds: 7 * 24 * 60 * 60 },
  { key: "30d", label: "30 days", detail: "This month", seconds: 30 * 24 * 60 * 60 },
];

const PROPOSAL_MIN_LEAD_SECONDS = MIN_MARKET_LEAD_SECONDS;
const LIQUIDITY_TIERS = [
  { atomic: "200000000", label: "20 USDC", detail: "Starter depth" },
  { atomic: "500000000", label: "50 USDC", detail: "Standard depth" },
  { atomic: "1000000000", label: "100 USDC", detail: "Deeper market" },
];

const PRICE_CATEGORIES = MARKET_CATEGORIES.filter(isPriceCategory);
const EVENT_CATEGORIES = MARKET_CATEGORIES.filter((item) => !isPriceCategory(item));

function SectionHeading({
  number,
  title,
  description,
  complete,
}: {
  number: number;
  title: string;
  description: string;
  complete?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-xs transition-colors duration-200 motion-reduce:transition-none",
          complete
            ? "border-[#eca8d6]/40 bg-[#eca8d6]/10 text-[#f4c5e4]"
            : "border-white/15 bg-white/[0.03] text-foreground/60",
        )}
        aria-hidden="true"
      >
        {complete ? <Check className="size-4" /> : number}
      </span>
      <div>
        <h2 className="text-base font-medium text-foreground">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-foreground/55">{description}</p>
      </div>
    </div>
  );
}

function FieldLabel({
  htmlFor,
  children,
  description,
}: {
  htmlFor: string;
  children: ReactNode;
  description?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
        {children}
      </label>
      {description && (
        <p id={`${htmlFor}-description`} className="text-xs leading-relaxed text-foreground/50">
          {description}
        </p>
      )}
    </div>
  );
}

function ReadinessItem({ complete, children }: { complete: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex items-center gap-2 text-xs", complete ? "text-foreground/75" : "text-foreground/50")}>
      {complete ? (
        <Check className="size-3.5 text-[#eca8d6]" aria-hidden="true" />
      ) : (
        <Circle className="size-3.5" aria-hidden="true" />
      )}
      <span>{children}</span>
    </div>
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function sourceUrls(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((source) => source.trim()).filter(Boolean))];
}

function fmtUsd(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

export default function CreatePage() {
  const address = useWalletAddress();
  const [asset, setAsset] = useState("BTC");
  const [category, setCategory] = useState<MarketCategory>("Crypto price");
  const [strike, setStrike] = useState("");
  const [eventQuestion, setEventQuestion] = useState("");
  const [subject, setSubject] = useState("");
  const [selectedImage, setSelectedImage] = useState<SelectedMarketImage | null>(null);
  const [resolutionSource, setResolutionSource] = useState("");
  const [backupSources, setBackupSources] = useState("");
  const [resolutionRules, setResolutionRules] = useState("");
  const [voidRules, setVoidRules] = useState("");
  const [expiryLocal, setExpiryLocal] = useState("");
  const [selectedExpiryPreset, setSelectedExpiryPreset] = useState("30d");
  const [minimumExpiry, setMinimumExpiry] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [liquidityTarget, setLiquidityTarget] = useState(LIQUIDITY_TIERS[0].atomic);
  const [stage, setStage] = useState<ProposalStep | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    proposalId: string;
    marketId: string;
    liquidityVaultId: string;
  } | null>(null);
  const [pendingProposal, setPendingProposal] = useState<PendingProposal | null>(null);
  const [attempted, setAttempted] = useState(false);

  const isPriceMarket = isPriceCategory(category);
  const priceAssets = assetsForCategory(category, ORACLE_MODE);
  const guidance = eventGuidance(category);
  const backupResolutionSources = sourceUrls(backupSources);
  const { spot } = useAssetPrice(isPriceMarket ? asset : undefined);
  const strikeNum = Number(strike);
  const busy = stage !== null && stage !== "done";
  const subjectComplete = isPriceMarket || subject.trim().length >= 2;
  const questionComplete = isPriceMarket || eventQuestion.trim().length >= 12;
  const primarySourceComplete = isPriceMarket || isHttpUrl(resolutionSource.trim());
  const backupSourcesComplete = isPriceMarket || (
    backupResolutionSources.length >= 1
    && backupResolutionSources.length <= 3
    && backupResolutionSources.every(isHttpUrl)
    && !backupResolutionSources.includes(resolutionSource.trim())
  );
  const yesRuleComplete = isPriceMarket || resolutionRules.trim().length >= 20;
  const voidRuleComplete = isPriceMarket || voidRules.trim().length >= 20;
  const strikeComplete = !isPriceMarket || (strikeNum > 0 && priceAssets.includes(asset));
  const detailsValid = isPriceMarket
    ? strikeComplete
    : subjectComplete
      && questionComplete
      && primarySourceComplete
      && backupSourcesComplete
      && yesRuleComplete
      && voidRuleComplete;
  const expiryValidationError = marketExpiryError(expiryLocal);
  const timingComplete = expiryValidationError === "";
  const settlementDate = timingComplete ? new Date(parseMarketExpiry(expiryLocal) * 1000) : null;
  const valid = detailsValid && timingComplete;
  const activeIndex = stage ? STEPS.findIndex((s) => s.key === stage) : -1;
  const busyLabel = stage === "configuration"
    ? "Checking policy"
    : stage === "listing"
      ? "Publishing market"
      : stage === "liquidity"
        ? "Registering liquidity"
        : "Creating proposal";
  const categoryMode = isPriceMarket ? "price" : "event";
  const categoryPresentation = CATEGORY_PRESENTATION[category];
  const outcomeComplete = isPriceMarket ? strikeComplete : subjectComplete && questionComplete;
  const resolutionComplete = isPriceMarket
    ? true
    : primarySourceComplete && backupSourcesComplete && yesRuleComplete && voidRuleComplete;
  const completedRequirements = isPriceMarket
    ? Number(strikeComplete)
    : [subjectComplete, questionComplete, primarySourceComplete, backupSourcesComplete, yesRuleComplete, voidRuleComplete]
      .filter(Boolean).length;
  const totalRequirements = isPriceMarket ? 1 : 6;
  const feedName = category === "Crypto price" ? "Reflector CEX" : "Reflector fiat";

  const detailsFirstInvalidField = isPriceMarket
    ? "strike-price"
    : !subjectComplete
      ? "event-subject"
      : !questionComplete
        ? "event-question"
        : !primarySourceComplete
        ? "resolution-source"
        : !backupSourcesComplete
          ? "backup-sources"
          : !yesRuleComplete
            ? "yes-rule"
            : "void-rule";
  const firstInvalidField = detailsValid ? "settlement-time" : detailsFirstInvalidField;

  const question = useMemo(() => {
    if (!isPriceMarket) return eventQuestion.trim() || (subject.trim() ? `Create a question about ${subject.trim()}` : "Enter a clear YES or NO question");
    return `Will ${asset} be at or above ${strikeNum > 0 ? fmtUsd(strikeNum) : "..."} at settlement?`;
  }, [asset, eventQuestion, isPriceMarket, strikeNum, subject]);

  useEffect(() => () => {
    if (selectedImage?.kind === "upload") URL.revokeObjectURL(selectedImage.previewUrl);
  }, [selectedImage]);

  useEffect(() => {
    const now = Date.now();
    setExpiryLocal(presetExpiryLocal(30 * 24 * 60 * 60, now));
    setMinimumExpiry(presetExpiryLocal(PROPOSAL_MIN_LEAD_SECONDS, now));
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  function selectCategory(nextCategory: MarketCategory) {
    setCategory(nextCategory);
    setAttempted(false);
    setError("");
    const nextAssets = assetsForCategory(nextCategory, ORACLE_MODE);
    if (nextAssets[0]) setAsset(nextAssets[0]);
  }

  function selectCategoryMode(mode: "price" | "event") {
    if (mode === categoryMode) return;
    if (mode === "event" && !EVENT_MARKETS_ENABLED) return;
    selectCategory(mode === "price" ? PRICE_CATEGORIES[0] : EVENT_CATEGORIES[0]);
  }

  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setPendingProposal(null);
      return;
    }
    void getPrivateConfig().then((config) => {
      if (cancelled) return;
      const pending = getPendingProposal(address, config.contracts.factory);
      setPendingProposal(pending);
      if (pending) {
        setExpiryLocal(toLocalDateTimeValue(new Date(pending.expiryUnix * 1000)));
        setLiquidityTarget(pending.liquidityTarget);
        setSelectedExpiryPreset("");
      }
    }).catch(() => {
      if (!cancelled) setPendingProposal(null);
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

  function applyExpiryPreset(key: string, seconds: number) {
    setExpiryLocal(presetExpiryLocal(seconds));
    setSelectedExpiryPreset(key);
    setError("");
  }

  async function create() {
    setError("");
    setResult(null);
    setStage(null);
    setAttempted(true);
    try {
      if (!pendingProposal && !valid) {
        requestAnimationFrame(() => document.getElementById(firstInvalidField)?.focus());
        if (!detailsValid) {
          throw new Error(isPriceMarket ? "Enter a valid strike price" : "Complete every outcome and resolution requirement");
        }
        throw new Error(expiryValidationError);
      }
      if (!address) throw new Error("Connect a Stellar wallet to create a market");
      if (!isPriceMarket) {
        throw new Error("Event markets stay disabled until their resolution operations are ready");
      }
      const expiryUnix = pendingProposal?.expiryUnix ?? parseMarketExpiry(expiryLocal);
      const metadata = {
        title: question,
        category,
        bannerDownloadUrl: selectedImage?.kind === "commons" ? selectedImage.downloadUrl : undefined,
        bannerSourceUrl: selectedImage?.kind === "commons" ? selectedImage.sourceUrl : undefined,
        bannerAttribution: selectedImage?.attribution,
        bannerLicense: selectedImage?.license,
        bannerLicenseUrl: selectedImage?.kind === "commons" ? selectedImage.licenseUrl : undefined,
      };
      const proposal = await proposeMarket({
        address,
        asset,
        strikeUsd: strikeNum,
        expiryUnix,
        liquidityTarget: BigInt(liquidityTarget),
        metadata,
        resume: pendingProposal,
        onStep: setStage,
        onProgress: setPendingProposal,
      });
      setStage("listing");
      await saveMarketToRegistry({
        marketId: proposal.marketId,
        asset: proposal.asset,
        collateralCode: NETWORK.collateral.code,
        collateralIssuer: NETWORK.collateral.issuer,
        collateralSac: NETWORK.collateral.sac,
        collateralDecimals: NETWORK.collateral.decimals,
        creator: address,
        title: proposal.metadata.title,
        category: proposal.metadata.category,
        bannerSourceUrl: proposal.metadata.bannerSourceUrl,
        bannerAttribution: proposal.metadata.bannerAttribution,
        bannerLicense: proposal.metadata.bannerLicense,
        bannerLicenseUrl: proposal.metadata.bannerLicenseUrl,
        resolverType: "price",
        rulesHash: proposal.rulesHash,
        proposalId: proposal.proposalId,
        factoryId: proposal.factoryId,
        liquidityVaultId: proposal.liquidityVaultId,
        marketState: "funding",
        liquidityTarget: proposal.liquidityTarget,
        fundingDeadline: proposal.fundingDeadline * 1_000,
        activationCutoff: proposal.activationCutoff * 1_000,
        settlementTime: proposal.expiryUnix * 1_000,
      });
      await registerPrivateProposal(proposal.proposalId);
      const bannerSource = selectedImage
        ? selectedImage.kind === "upload"
          ? { kind: "upload" as const, file: selectedImage.file }
          : { kind: "commons" as const, downloadUrl: selectedImage.downloadUrl }
        : proposal.metadata.bannerDownloadUrl
          ? { kind: "commons" as const, downloadUrl: proposal.metadata.bannerDownloadUrl }
          : null;
      if (bannerSource) {
        try {
          await uploadMarketBanner({ address, marketId: proposal.marketId, source: bannerSource });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "The market is registered, but its image could not be attached.");
        }
      }
      clearPendingProposal(address, proposal.factoryId);
      setPendingProposal(null);
      setStage("done");
      setResult({
        proposalId: proposal.proposalId,
        marketId: proposal.marketId,
        liquidityVaultId: proposal.liquidityVaultId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Market proposal failed");
      setStage(null);
    }
  }

  return (
    <div className="space-y-8 pb-12 sm:space-y-10">
      <header className="max-w-3xl space-y-5">
        <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.18em] text-foreground/55">
          <span className="h-px w-10 bg-white/20" />
          Creator studio
        </div>
        <div className="space-y-4">
          <h1 className="max-w-2xl font-display text-5xl leading-[0.92] tracking-tight sm:text-6xl lg:text-7xl">
            Create a prediction
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-foreground/60 sm:text-lg">
            Choose a market type, define an outcome, and deploy a shielded USDC market on Stellar testnet.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { icon: ShieldCheck, label: "Shielded positions" },
            { icon: CircleDollarSign, label: "USDC collateral" },
            { icon: Database, label: "Free public oracles" },
          ].map(({ icon: Icon, label }) => (
            <span key={label} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.025] px-3 text-xs text-foreground/65">
              <Icon className="size-3.5 text-[#eca8d6]" aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <Panel className="overflow-hidden">
          <div className="grid grid-cols-4 border-b border-white/[0.08] bg-white/[0.018] px-4 py-3 sm:px-7">
            {[
              { number: 1, label: "Type", complete: true },
              { number: 2, label: "Outcome", complete: outcomeComplete },
              { number: 3, label: "Resolution", complete: resolutionComplete },
              { number: 4, label: "Propose", complete: valid },
            ].map((item) => (
              <div key={item.number} className="flex items-center justify-center gap-2 text-[11px] text-foreground/55 sm:text-xs">
                <span className={cn("inline-flex size-5 items-center justify-center rounded-full border font-mono text-[10px]", item.complete ? "border-[#eca8d6]/40 bg-[#eca8d6]/10 text-[#f4c5e4]" : "border-white/15")}>
                  {item.complete ? <Check className="size-3" aria-hidden="true" /> : item.number}
                </span>
                <span className="hidden sm:inline">{item.label}</span>
              </div>
            ))}
          </div>

          <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
            <section className="space-y-6 border-b border-white/[0.08] p-5 sm:p-7">
              <SectionHeading
                number={1}
                title="Choose a market type"
                description="Price markets resolve from verified public feeds. Other market categories open only after their full resolution operations are ready."
                complete
              />

              <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-black/20 p-1" role="group" aria-label="Market type">
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={categoryMode === "price"}
                  onClick={() => selectCategoryMode("price")}
                  className={cn(
                    "min-h-11 rounded-md px-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50 motion-reduce:transition-none",
                    categoryMode === "price" ? "bg-white/[0.09] text-foreground shadow-sm" : "text-foreground/50 hover:text-foreground/80",
                  )}
                >
                  Price feeds
                </button>
                <button
                  type="button"
                  disabled={busy || !EVENT_MARKETS_ENABLED}
                  aria-pressed={categoryMode === "event"}
                  aria-describedby={!EVENT_MARKETS_ENABLED ? "event-market-status" : undefined}
                  onClick={() => selectCategoryMode("event")}
                  className={cn(
                    "min-h-11 rounded-md px-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50 motion-reduce:transition-none",
                    categoryMode === "event" ? "bg-white/[0.09] text-foreground shadow-sm" : "text-foreground/50 hover:text-foreground/80",
                  )}
                >
                  Event outcomes{EVENT_MARKETS_ENABLED ? "" : " - Soon"}
                </button>
              </div>

              {!EVENT_MARKETS_ENABLED && (
                <div id="event-market-status" className="flex items-start gap-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-4 text-sm text-foreground/60">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-200" aria-hidden="true" />
                  <p>
                    Sports, politics, weather, economics, and other event markets stay unavailable during this testnet release. They will open only after their evidence observers, challenges, arbitration, and refund monitoring are running.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label={`${categoryMode === "price" ? "Price" : "Event"} categories`}>
                {(categoryMode === "price" ? PRICE_CATEGORIES : EVENT_CATEGORIES).map((item) => {
                  const selected = category === item;
                  const presentation = CATEGORY_PRESENTATION[item];
                  return (
                    <button
                      key={item}
                      type="button"
                      aria-label={item}
                      aria-pressed={selected}
                      disabled={busy}
                      onClick={() => selectCategory(item)}
                      className={cn(
                        "group relative min-h-24 rounded-lg border p-3 text-left transition-[border-color,background-color,color,box-shadow] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50 motion-reduce:transition-none sm:p-4",
                        selected
                          ? "border-[#eca8d6]/45 bg-[#eca8d6]/[0.075] shadow-[inset_0_0_0_1px_rgba(236,168,214,0.06)]"
                          : "border-white/10 bg-white/[0.018] hover:border-white/20 hover:bg-white/[0.04]",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={cn("inline-flex size-8 items-center justify-center rounded-md border transition-colors duration-200 motion-reduce:transition-none", selected ? "border-[#eca8d6]/30 bg-[#eca8d6]/10 text-[#f4c5e4]" : "border-white/10 bg-white/[0.03] text-foreground/55 group-hover:text-foreground/80")}>
                          <MarketCategoryIcon category={item} className="size-4" />
                        </span>
                        {selected && <Check className="size-4 text-[#eca8d6]" aria-hidden="true" />}
                      </div>
                      <span className="mt-3 block text-sm font-medium text-foreground">{item}</span>
                      <span className="mt-1 hidden text-[11px] leading-snug text-foreground/55 sm:block">{presentation.description}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section key={`${category}-outcome`} className="space-y-6 border-b border-white/[0.08] p-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 sm:p-7">
              <SectionHeading
                number={2}
                title={isPriceMarket ? "Set the price outcome" : `Define the ${category.toLowerCase()} outcome`}
                description={isPriceMarket ? "Select the underlying asset and the USD level that YES must reach." : "Ask one objective YES or NO question with a result anyone can verify."}
                complete={outcomeComplete}
              />

              {isPriceMarket ? (
                <>
                  <div className="space-y-3">
                    <span className="block text-sm font-medium text-foreground">Underlying asset</span>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" role="group" aria-label="Underlying asset">
                      {priceAssets.map((item) => {
                        const selected = asset === item;
                        return (
                          <button
                            key={item}
                            type="button"
                            aria-label={item}
                            aria-pressed={selected}
                            disabled={busy}
                            onClick={() => { setAsset(item); setAttempted(false); }}
                            className={cn(
                              "flex min-h-14 items-center gap-2.5 rounded-lg border px-3 text-left transition-[border-color,background-color,color] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50 motion-reduce:transition-none",
                              selected ? "border-[#eca8d6]/45 bg-[#eca8d6]/[0.07]" : "border-white/10 bg-white/[0.018] hover:border-white/20 hover:bg-white/[0.04]",
                            )}
                          >
                            <AssetIcon asset={item} size="sm" />
                            <span className="min-w-0">
                              <span className="block font-mono text-xs text-foreground">{item}</span>
                              <span className="mt-0.5 block truncate text-[10px] text-foreground/50">USD reference</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <FieldLabel htmlFor="strike-price" description="YES wins if the settlement price is equal to or above this level.">
                      Strike price in USD
                    </FieldLabel>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-sm text-foreground/55">$</span>
                      <Input
                        id="strike-price"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={strike}
                        disabled={busy}
                        aria-describedby="strike-price-description"
                        aria-invalid={attempted && !strikeComplete}
                        placeholder={spot ? spot.price.toString() : "Enter a price"}
                        onChange={(event) => setStrike(event.target.value)}
                        className="h-12 pl-8 text-base"
                      />
                    </div>
                    {spot && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setStrike(spot.price.toString())}
                        className="inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-xs text-foreground/55 transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50 motion-reduce:transition-none"
                      >
                        <Zap className="size-3.5 text-[#eca8d6]" aria-hidden="true" />
                        Use current {asset} price {fmtUsd(spot.price)}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-6">
                  <EventSubjectMediaPicker
                    category={category as EventCategory}
                    subject={subject}
                    subjectLabel={guidance.subjectLabel}
                    subjectPlaceholder={guidance.subjectPlaceholder}
                    selectedImage={selectedImage}
                    disabled={busy}
                    invalid={attempted && !subjectComplete}
                    onSubjectChange={setSubject}
                    onImageChange={setSelectedImage}
                  />

                  <div className="space-y-3">
                    <FieldLabel htmlFor="event-question" description="State one outcome only. Include the subject, condition, and cutoff when relevant.">
                      YES or NO question
                    </FieldLabel>
                    <Textarea
                      id="event-question"
                      value={eventQuestion}
                      disabled={busy}
                      maxLength={180}
                      rows={3}
                      aria-describedby="event-question-description event-question-count"
                      aria-invalid={attempted && !questionComplete}
                      placeholder={guidance.question}
                      onChange={(event) => setEventQuestion(event.target.value)}
                      className="min-h-24 resize-y text-base leading-relaxed"
                    />
                    <div id="event-question-count" className="flex justify-between gap-4 text-xs text-foreground/50">
                      <span>Minimum 12 characters</span>
                      <span className="font-mono">{eventQuestion.length}/180</span>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section key={`${category}-resolution`} className="space-y-6 border-b border-white/[0.08] p-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 sm:p-7">
              <SectionHeading
                number={3}
                title="Define the resolution"
                description={isPriceMarket ? "This testnet market uses a free public Stellar oracle feed at expiry." : "Set the evidence hierarchy, exact YES rule, and every refund condition before deployment."}
                complete={resolutionComplete}
              />

              {isPriceMarket ? (
                <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-[#eca8d6]/25 bg-[#eca8d6]/10 text-[#f4c5e4]">
                      <Database className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium text-foreground">{feedName} public feed</h3>
                        <span className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.06] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-200">Free</span>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-foreground/50">
                        {categoryPresentation.resolution} supplies the USD reference. Moros checks freshness and resolves the market after its configured expiry.
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 grid grid-cols-1 gap-2 border-t border-white/[0.08] pt-4 sm:grid-cols-3">
                    <ReadinessItem complete>Public Stellar feed</ReadinessItem>
                    <ReadinessItem complete>USD quote checked</ReadinessItem>
                    <ReadinessItem complete>Freshness checked</ReadinessItem>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      <Link2 className="mt-0.5 size-5 shrink-0 text-[#eca8d6]" aria-hidden="true" />
                      <div>
                        <h3 className="text-sm font-medium">Evidence sources</h3>
                        <p className="mt-1 text-xs leading-relaxed text-foreground/50">{guidance.sourceHint}</p>
                      </div>
                    </div>
                    <div className="mt-5 grid gap-5">
                      <div className="space-y-3">
                        <FieldLabel htmlFor="resolution-source" description="Use the authority that directly publishes or controls the result.">
                          Primary source URL
                        </FieldLabel>
                        <Input
                          id="resolution-source"
                          type="url"
                          inputMode="url"
                          value={resolutionSource}
                          disabled={busy}
                          aria-describedby="resolution-source-description"
                          aria-invalid={attempted && !primarySourceComplete}
                          placeholder={guidance.source}
                          onChange={(event) => setResolutionSource(event.target.value)}
                          className="h-12"
                        />
                      </div>

                      <div className="space-y-3">
                        <FieldLabel htmlFor="backup-sources" description="Add one to three distinct public URLs, one per line. State which source wins if they disagree.">
                          Backup source URLs
                        </FieldLabel>
                        <Textarea
                          id="backup-sources"
                          value={backupSources}
                          disabled={busy}
                          maxLength={1200}
                          rows={3}
                          inputMode="url"
                          aria-describedby="backup-sources-description"
                          aria-invalid={attempted && !backupSourcesComplete}
                          placeholder={"https://second-official-source.example/result\nhttps://public-archive.example/result"}
                          onChange={(event) => setBackupSources(event.target.value)}
                          className="min-h-24 resize-y"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-4">
                      <FieldLabel htmlFor="yes-rule" description="At least 20 characters. Define the exact source field, cutoff, units, and comparison.">
                        YES resolution rule
                      </FieldLabel>
                      <Textarea
                        id="yes-rule"
                        value={resolutionRules}
                        disabled={busy}
                        maxLength={800}
                        rows={5}
                        aria-describedby="yes-rule-description"
                        aria-invalid={attempted && !yesRuleComplete}
                        placeholder={guidance.rules}
                        onChange={(event) => setResolutionRules(event.target.value)}
                        className="min-h-36 resize-y"
                      />
                    </div>

                    <div className="space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-4">
                      <FieldLabel htmlFor="void-rule" description="At least 20 characters. Define cancellations, missing data, conflicts, and ambiguity.">
                        Void and refund rule
                      </FieldLabel>
                      <Textarea
                        id="void-rule"
                        value={voidRules}
                        disabled={busy}
                        maxLength={800}
                        rows={5}
                        aria-describedby="void-rule-description"
                        aria-invalid={attempted && !voidRuleComplete}
                        placeholder={guidance.voidRules}
                        onChange={(event) => setVoidRules(event.target.value)}
                        className="min-h-36 resize-y"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/[0.08] bg-black/15 p-4 sm:grid-cols-3">
                    <ReadinessItem complete={subjectComplete}>Named subject</ReadinessItem>
                    <ReadinessItem complete={questionComplete}>Clear question</ReadinessItem>
                    <ReadinessItem complete={primarySourceComplete}>Primary source</ReadinessItem>
                    <ReadinessItem complete={backupSourcesComplete}>Backup source</ReadinessItem>
                    <ReadinessItem complete={yesRuleComplete}>YES rule</ReadinessItem>
                    <ReadinessItem complete={voidRuleComplete}>Void rule</ReadinessItem>
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-6 p-5 sm:p-7">
              <SectionHeading
                number={4}
                title="Set timing and choose market depth"
                description="Choose when resolution begins and how much capital the shared Moros pool may allocate to this isolated market."
                complete={valid}
              />

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-foreground">Settlement date and time</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {EXPIRY_PRESETS.map((expiry) => {
                    const selected = selectedExpiryPreset === expiry.key;
                    return (
                      <button
                        key={expiry.key}
                        type="button"
                        aria-label={expiry.label}
                        aria-pressed={selected}
                        disabled={busy || !!pendingProposal}
                        onClick={() => applyExpiryPreset(expiry.key, expiry.seconds)}
                        className={cn(
                          "min-h-16 rounded-lg border px-2 py-3 text-center transition-[border-color,background-color,color] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50 motion-reduce:transition-none",
                          selected ? "border-[#eca8d6]/45 bg-[#eca8d6]/[0.07]" : "border-white/10 bg-white/[0.018] hover:border-white/20 hover:bg-white/[0.04]",
                        )}
                      >
                        <span className="block font-mono text-xs text-foreground">{expiry.label}</span>
                        <span className="mt-1 hidden text-[10px] text-foreground/50 sm:block">{expiry.detail}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-4">
                  <FieldLabel
                    htmlFor="settlement-time"
                    description="Choose any exact future date and minute. The value is entered in your local time."
                  >
                    Exact settlement time
                  </FieldLabel>
                  <Input
                    id="settlement-time"
                    type="datetime-local"
                    step={60}
                    min={minimumExpiry || undefined}
                    value={expiryLocal}
                    disabled={busy || !!pendingProposal}
                    aria-describedby="settlement-time-description settlement-time-conversion"
                    aria-invalid={attempted && !timingComplete}
                    onChange={(event) => {
                      setExpiryLocal(event.target.value);
                      setSelectedExpiryPreset("");
                    }}
                    className="h-12 font-mono"
                  />
                  <div id="settlement-time-conversion" className="space-y-1 text-xs text-foreground/55" aria-live="polite">
                    {settlementDate ? (
                      <>
                        <p>Local: {settlementDate.toLocaleString()} {timeZone ? `(${timeZone})` : ""}</p>
                        <p className="font-mono">UTC: {settlementDate.toISOString().replace("T", " ").replace(".000Z", " UTC")}</p>
                      </>
                    ) : (
                      <p className="text-red-300">{expiryValidationError}</p>
                    )}
                  </div>
                </div>
              </fieldset>

              <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <AssetIcon asset="USDC" size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Automatic USDC liquidity</p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-foreground/50">Shared pool, isolated market risk</p>
                    <p className="mt-3 text-xs leading-relaxed text-foreground/50">
                      Creating a market requires no USDC. The shared Moros liquidity pool automatically funds eligible markets in queue order while enforcing per-market and per-category limits. Your wallet only pays normal Stellar transaction fees and account reserve.
                    </p>
                  </div>
                </div>
                <fieldset className="mt-4 grid grid-cols-1 gap-2 border-t border-white/[0.08] pt-4 sm:grid-cols-3">
                  <legend className="sr-only">Liquidity target</legend>
                  {LIQUIDITY_TIERS.map((tier) => {
                    const selected = liquidityTarget === tier.atomic;
                    return (
                      <button
                        key={tier.atomic}
                        type="button"
                        disabled={busy || !!pendingProposal}
                        aria-pressed={selected}
                        onClick={() => setLiquidityTarget(tier.atomic)}
                        className={cn(
                          "min-h-16 rounded-lg border px-3 py-2 text-left transition-[border-color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50",
                          selected
                            ? "border-[#eca8d6]/45 bg-[#eca8d6]/[0.07]"
                            : "border-white/10 bg-black/15 hover:border-white/20",
                        )}
                      >
                        <span className="block font-mono text-xs text-foreground">{tier.label}</span>
                        <span className="mt-1 block text-[10px] text-foreground/50">{tier.detail}</span>
                      </button>
                    );
                  })}
                </fieldset>
              </div>

              {pendingProposal && (
                <div className="rounded-lg border border-amber-300/30 bg-amber-300/[0.05] p-4">
                  <div className="flex items-start gap-3">
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-200" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-medium text-amber-100">Incomplete market proposal found</p>
                      <p className="mt-2 text-xs leading-relaxed text-foreground/55">
                        Resume the saved {pendingProposal.metadata.category} proposal from its last confirmed transaction. Moros reuses the deterministic proposal and LP vault addresses.
                      </p>
                      <p className="mt-2 break-all font-mono text-[10px] text-foreground/50">Proposal: {pendingProposal.proposalId}</p>
                      <p className="mt-1 break-all font-mono text-[10px] text-foreground/50">LP vault: {pendingProposal.liquidityVaultId}</p>
                    </div>
                  </div>
                </div>
              )}

              {!address ? (
                <Button type="button" size="lg" className="h-12 w-full" onClick={connect}>
                  <WalletCards className="size-4" />
                  Connect wallet to create
                </Button>
              ) : (
                <Button type="submit" size="lg" className="h-12 w-full" disabled={busy || (!pendingProposal && !valid)}>
                  {busy && <Spinner />}
                  {busy
                    ? busyLabel
                    : pendingProposal
                      ? "Resume market proposal"
                      : valid
                        ? "Create market"
                        : "Complete market details"}
                </Button>
              )}

              {stage && (
                <div className="space-y-2 rounded-lg border border-white/[0.08] bg-black/15 p-4" aria-live="polite">
                  {STEPS.map((step, index) => (
                    <div key={step.key} className="flex items-center gap-3 text-sm">
                      {index === activeIndex && stage !== "done" ? (
                        <Spinner className="size-3 shrink-0" />
                      ) : (
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: index <= activeIndex ? "#16c784" : "rgba(255,255,255,0.15)" }} />
                      )}
                      <span className={index <= activeIndex ? "text-foreground" : "text-foreground/50"}>{step.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {result && (
                <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.05] p-4" aria-live="polite">
                  <p className="text-sm text-emerald-200">Your market is registered on {NETWORK.name}. The shared liquidity pool will fund and activate it automatically when policy capacity is available.</p>
                  <Link href="/app/liquidity" className="mt-3 inline-flex min-h-11 items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-[#eca8d6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
                    View liquidity pool
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </div>
              )}

              {error && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-300/20 bg-red-300/[0.05] p-3 text-sm text-red-200">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}
            </section>
          </form>
        </Panel>

        <aside className="space-y-4 xl:sticky xl:top-24">
          <Panel className="overflow-hidden">
            <div className="border-b border-white/[0.08] p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <Tag>Market preview</Tag>
                <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider", valid ? "border-emerald-300/20 bg-emerald-300/[0.05] text-emerald-200" : "border-white/10 bg-white/[0.025] text-foreground/55")}>
                  <span className={cn("size-1.5 rounded-full", valid ? "bg-emerald-300" : "bg-white/30")} />
                  {valid ? "Ready" : "Draft"}
                </span>
              </div>

              <div className="mt-5 flex items-start gap-3">
                <MarketVisual
                  resolverType={isPriceMarket ? "price" : "event"}
                  asset={asset}
                  category={category}
                  subject={subject}
                  imageUrl={selectedImage?.previewUrl}
                  size="lg"
                />
                <div className="min-w-0">
                  <h2 className="font-display text-2xl leading-tight tracking-tight">{question}</h2>
                  <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-foreground/50">
                    {isPriceMarket ? category : subject.trim() || category} / shielded binary market
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-5 p-5 sm:p-6">
              {isPriceMarket ? (
                <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-black/20">
                  <AssetSpotChart asset={asset} strike={strikeNum > 0 ? strikeNum : undefined} height={220} />
                </div>
              ) : (
                <div className="space-y-4">
                  <MarketBanner
                    category={category}
                    subject={subject}
                    question={question}
                    imageUrl={selectedImage?.previewUrl}
                    className="h-40"
                  />
                  <div className="space-y-4 rounded-lg border border-white/[0.08] bg-black/15 p-4 text-xs leading-relaxed text-foreground/55">
                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-200">YES condition</span>
                      <p className="mt-1.5">{resolutionRules.trim() || "Add the exact YES rule."}</p>
                    </div>
                    <div className="border-t border-white/[0.08] pt-4">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-amber-200">Void and refund</span>
                      <p className="mt-1.5">{voidRules.trim() || "Add the cancellation and ambiguity rule."}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.08]">
                {[
                  { icon: CircleDollarSign, label: "Collateral", value: "USDC" },
                  {
                    icon: CalendarDays,
                    label: "Settlement time",
                    value: settlementDate
                      ? settlementDate.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                      : "Choose time",
                  },
                  { icon: Database, label: "Resolution", value: isPriceMarket ? feedName : "Evidence" },
                  { icon: LockKeyhole, label: "Position sides", value: "Shielded" },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="bg-background p-3.5">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-foreground/50">
                      <Icon className="size-3" aria-hidden="true" />
                      {label}
                    </div>
                    <p className="mt-2 text-sm text-foreground/80">{value}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-foreground/50">Market details</span>
                  <span className="font-mono text-foreground/70">{completedRequirements}/{totalRequirements}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className="h-full rounded-full bg-[#eca8d6] transition-[width] duration-300 ease-out motion-reduce:transition-none"
                    style={{ width: `${(completedRequirements / totalRequirements) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </Panel>

          <Panel className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-foreground/60">
                {isPriceMarket ? <Database className="size-4" aria-hidden="true" /> : <ShieldCheck className="size-4" aria-hidden="true" />}
              </span>
              <div>
                <Tag>How resolution works</Tag>
                <p className="mt-2 text-sm leading-relaxed text-foreground/55">
                  {isPriceMarket
                    ? ORACLE_MODE === "free"
                      ? `After expiry, the matching free public ${feedName} feed resolves this testnet market.`
                      : "After expiry, Reflector and Pyth Pro must agree before the market resolves."
                    : "After expiry, anyone can post a bonded result with evidence. Conflicts trigger committee arbitration. Cancelled or ambiguous events can be voided for full refunds."}
                </p>
              </div>
            </div>
          </Panel>

          <Panel className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-foreground/60">
                <Clock3 className="size-4" aria-hidden="true" />
              </span>
              <div>
                <Tag>What gets deployed</Tag>
                <p className="mt-2 text-sm leading-relaxed text-foreground/55">
                  A USDC-backed LMSR market, paired shielded pool, and threshold committee. Position sides and amounts stay encrypted during batching, while the market remains fully collateralized.
                </p>
              </div>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
