import { PageHeader } from "@/components/app/app-kit";
import { MarketCard } from "@/components/markets/market-card";

export default function MarketsPage() {
  return (
    <div>
      <PageHeader
        label="Umbra"
        title="Markets"
        description="Private prediction markets on Stellar testnet."
      />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
        <MarketCard />
      </div>
    </div>
  );
}
