import { PageHeader } from "@/components/app/app-kit";
import { PositionsList } from "@/components/portfolio/positions-list";

export default function PortfolioPage() {
  return (
    <div>
      <PageHeader label="Moros" title="Portfolio" description="Your private positions, stored only in this browser" />
      <div className="mt-8">
        <PositionsList />
      </div>
    </div>
  );
}
