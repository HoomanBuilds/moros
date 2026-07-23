import { PageHeader } from "@/components/app/app-kit";
import { PrivateWalletCard } from "@/components/portfolio/private-wallet-card";
import { PositionsList } from "@/components/portfolio/positions-list";

export default function PortfolioPage() {
  return (
    <div>
      <PageHeader label="Moros" title="Position history" description="Track every private USDC position, claim, recovery, and refund" />
      <div className="mt-8 space-y-8">
        <PrivateWalletCard />
        <PositionsList />
      </div>
    </div>
  );
}
