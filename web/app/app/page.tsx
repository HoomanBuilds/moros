import { PageHeader } from "@/components/app/app-kit";
import { FeaturedCarousel } from "@/components/markets/featured-carousel";
import { MarketsHeroRail } from "@/components/markets/markets-hero-rail";
import { MarketsSection } from "@/components/markets/markets-section";

export default function MarketsPage() {
  return (
    <div className="space-y-12">
      <PageHeader
        label="Umbra"
        title="Markets"
        description="Private prediction markets on Stellar testnet."
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
        <FeaturedCarousel />
        <MarketsHeroRail />
      </div>
      <MarketsSection />
    </div>
  );
}
