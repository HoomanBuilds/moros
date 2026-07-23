"use client";
import { useEffect, useMemo, useState } from "react";
import { Search, LayoutGrid, List, ArrowUpDown, Check, PanelsTopLeft } from "lucide-react";
import { useMarketCatalog } from "@/lib/markets/catalog";
import { useFavorites } from "@/lib/markets/favorites";
import { sortRows, SORT_OPTIONS, type SortId } from "@/lib/markets/sort";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/app/app-kit";
import { MarketCard } from "./market-card";
import { MarketListRow } from "./market-row";
import { MarketCategoryIcon } from "./market-category-icon";
import { cn } from "@/lib/utils";
import { MARKET_CATEGORIES, type MarketCategory } from "@/lib/markets/categories";
import { refreshMarkets } from "@/lib/markets/registry";

const TABS = ["All", "Live", "Favorites", "Closed"] as const;
type Tab = (typeof TABS)[number];

export function MarketsSection() {
  const { rows } = useMarketCatalog();
  const favorites = useFavorites();
  const [tab, setTab] = useState<Tab>("All");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<SortId>("ending");
  const [activeOnly, setActiveOnly] = useState(false);
  const [category, setCategory] = useState<"All" | MarketCategory>("All");

  useEffect(() => {
    const refresh = () => void refreshMarkets();
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    const v = localStorage.getItem("moros.marketview") ?? localStorage.getItem("umbra.marketview");
    if (v === "list" || v === "grid") setView(v);
  }, []);
  useEffect(() => {
    localStorage.setItem("moros.marketview", view);
    localStorage.removeItem("umbra.marketview");
  }, [view]);

  const counts = {
    Live: rows.filter((r) => r.live).length,
    Favorites: rows.filter((r) => favorites.has(r.id)).length,
    Closed: rows.filter((r) => !r.live).length,
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) => [r.question, r.subject, r.category]
      .some((value) => value?.toLowerCase().includes(q)));
    if (category !== "All") out = out.filter((r) => r.category === category);
    if (tab === "Live") out = out.filter((r) => r.live);
    else if (tab === "Closed") out = out.filter((r) => !r.live);
    else if (tab === "Favorites") out = out.filter((r) => favorites.has(r.id));
    if (activeOnly) out = out.filter((r) => r.orders > 0);
    return sortRows(out, sort);
  }, [rows, search, tab, favorites, activeOnly, sort, category]);

  const sortLabel = SORT_OPTIONS.find((o) => o.id === sort)?.label;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-3xl tracking-tight">All markets</h2>
        <div className="flex items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search markets..."
              className="pl-9"
            />
          </div>
          <div className="hidden shrink-0 items-center gap-0.5 rounded-md border border-white/10 p-0.5 lg:flex">
            {([["grid", LayoutGrid], ["list", List]] as const).map(([v, Icon]) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-label={`${v} view`}
                aria-pressed={view === v}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded transition-colors",
                  view === v ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex gap-6 border-b border-white/[0.08]">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 pb-3 font-mono text-xs uppercase tracking-wider transition-colors",
                tab === t ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
              {t !== "All" && counts[t] > 0 && (
                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] tabular-nums">{counts[t]}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={activeOnly} onCheckedChange={(c) => setActiveOnly(c === true)} aria-label="Only markets with shielded activity" />
            <span>Has activity</span>
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 font-mono text-xs text-foreground transition-colors hover:bg-white/[0.04]">
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              {sortLabel}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Sort by
              </DropdownMenuLabel>
              {SORT_OPTIONS.map((o) => (
                <DropdownMenuItem key={o.id} onSelect={() => setSort(o.id)} className="flex items-center justify-between">
                  {o.label}
                  {sort === o.id && <Check className="h-3.5 w-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="-mx-6 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:-mx-10 lg:px-10">
        <div className="flex min-w-max items-center gap-2" role="group" aria-label="Market category filter">
          <button
            type="button"
            aria-pressed={category === "All"}
            onClick={() => setCategory("All")}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
              category === "All" ? "border-[#eca8d6]/45 bg-[#eca8d6]/10 text-foreground" : "border-white/10 text-foreground/55 hover:border-white/20 hover:text-foreground",
            )}
          >
            <PanelsTopLeft className="size-4" aria-hidden="true" />
            All topics
          </button>
          {MARKET_CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
                category === item ? "border-[#eca8d6]/45 bg-[#eca8d6]/10 text-foreground" : "border-white/10 text-foreground/55 hover:border-white/20 hover:text-foreground",
              )}
            >
              <MarketCategoryIcon category={item} className="size-4" />
              {item}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No markets here" description={search || category !== "All" ? "Nothing matches these filters." : "No markets in this view yet."} />
      ) : view === "grid" ? (
        <div className="flex flex-wrap gap-6">
          {filtered.map((r) => (
            <MarketCard key={r.id} row={r} />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <MarketListRow key={r.id} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}
