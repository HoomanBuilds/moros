"use client";

import { AssetIcon } from "@/components/markets/asset-icon";
import { MarketCategoryIcon } from "@/components/markets/market-category-icon";
import { isMarketCategory, type MarketCategory } from "@/lib/markets/categories";
import { cn } from "@/lib/utils";

const SQUARE_SIZE = {
  sm: "size-8 rounded-full",
  md: "size-11 rounded-lg",
  lg: "size-14 rounded-xl",
} as const;

function eventCategory(category?: string): MarketCategory {
  return isMarketCategory(category) ? category : "Other";
}

export function MarketVisual({
  resolverType,
  asset,
  category,
  subject,
  imageUrl,
  size = "md",
  className,
}: {
  resolverType?: "price" | "event";
  asset?: string;
  category?: string;
  subject?: string;
  imageUrl?: string | null;
  size?: keyof typeof SQUARE_SIZE;
  className?: string;
}) {
  if (resolverType !== "event") return <AssetIcon asset={asset} size={size} />;
  const resolvedCategory = eventCategory(category);
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={`${subject || resolvedCategory} subject`}
        className={cn(SQUARE_SIZE[size], "shrink-0 border border-white/10 bg-white/[0.03] object-cover", className)}
      />
    );
  }
  return (
    <span className={cn(SQUARE_SIZE[size], "inline-flex shrink-0 items-center justify-center border border-[#eca8d6]/25 bg-[#eca8d6]/10 text-[#f4c5e4]", className)}>
      <MarketCategoryIcon category={resolvedCategory} className={size === "sm" ? "size-4" : size === "md" ? "size-5" : "size-6"} />
    </span>
  );
}

export function MarketBanner({
  category,
  subject,
  question,
  imageUrl,
  className,
}: {
  category?: string;
  subject?: string;
  question: string;
  imageUrl?: string | null;
  className?: string;
}) {
  const resolvedCategory = eventCategory(category);
  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-white/[0.08] bg-black/20", className)}>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`${subject || question} market subject`}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(236,168,214,0.12),transparent_55%)]">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="inline-flex size-14 items-center justify-center rounded-xl border border-[#eca8d6]/25 bg-[#eca8d6]/10 text-[#f4c5e4]">
              <MarketCategoryIcon category={resolvedCategory} className="size-6" />
            </span>
            <span className="max-w-[80%] text-xs text-foreground/55">{subject || resolvedCategory}</span>
          </div>
        </div>
      )}
      {imageUrl && <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />}
    </div>
  );
}
