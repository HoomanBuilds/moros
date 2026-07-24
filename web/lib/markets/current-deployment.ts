const CONTRACT_ID = /^C[A-Z2-7]{55}$/u;
const PROPOSAL_ID = /^[0-9a-f]{64}$/u;

export function isCurrentDeploymentMarket(
  record: {
    poolId: string;
    proposalId?: string;
    factoryId?: string;
    liquidityVaultId?: string;
    marketState?: string;
  },
  deployment: {
    factory: string;
    sharedVault: string;
  },
): boolean {
  return record.marketState === "active"
    && record.factoryId === deployment.factory
    && record.poolId === deployment.sharedVault
    && PROPOSAL_ID.test(record.proposalId ?? "")
    && CONTRACT_ID.test(record.liquidityVaultId ?? "");
}
