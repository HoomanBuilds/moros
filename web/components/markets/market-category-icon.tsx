import type { LucideIcon } from "lucide-react";
import {
  Bitcoin,
  ChartCandlestick,
  ChartNoAxesCombined,
  Clapperboard,
  CloudSun,
  Cpu,
  Gem,
  Landmark,
  Shapes,
  Trophy,
  Vote,
  Wheat,
} from "lucide-react";
import type { MarketCategory } from "@/lib/markets/categories";

type CategoryPresentation = {
  description: string;
  resolution: string;
  icon: LucideIcon;
};

export const CATEGORY_PRESENTATION: Record<MarketCategory, CategoryPresentation> = {
  "Crypto price": {
    description: "Crypto prices against USD",
    resolution: "Free Reflector CEX feed",
    icon: Bitcoin,
  },
  FX: {
    description: "Global currency rates",
    resolution: "Free Reflector fiat feed",
    icon: Landmark,
  },
  "Gold price": {
    description: "XAU reference price",
    resolution: "Free Reflector fiat feed",
    icon: Gem,
  },
  Equities: {
    description: "Stocks and listed companies",
    resolution: "Official exchange evidence",
    icon: ChartCandlestick,
  },
  Commodities: {
    description: "Energy, metals, and agriculture",
    resolution: "Official benchmark evidence",
    icon: Wheat,
  },
  Sports: {
    description: "Games, tournaments, and players",
    resolution: "Official organizer results",
    icon: Trophy,
  },
  Economics: {
    description: "Inflation, rates, and public data",
    resolution: "Official agency releases",
    icon: ChartNoAxesCombined,
  },
  Weather: {
    description: "Measured weather outcomes",
    resolution: "Public authority observations",
    icon: CloudSun,
  },
  Politics: {
    description: "Elections and public decisions",
    resolution: "Official government records",
    icon: Vote,
  },
  Technology: {
    description: "Launches, releases, and standards",
    resolution: "Official project records",
    icon: Cpu,
  },
  Entertainment: {
    description: "Awards, charts, and events",
    resolution: "Official publisher results",
    icon: Clapperboard,
  },
  Other: {
    description: "Any objective public outcome",
    resolution: "Defined authoritative evidence",
    icon: Shapes,
  },
};

export function MarketCategoryIcon({
  category,
  className,
}: {
  category: MarketCategory;
  className?: string;
}) {
  const Icon = CATEGORY_PRESENTATION[category].icon;
  return <Icon aria-hidden="true" className={className} strokeWidth={1.8} />;
}
