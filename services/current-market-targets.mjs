const CONTRACT_ID = /^C[A-Z2-7]{55}$/;
const PROPOSAL_ID = /^[0-9a-f]{64}$/;

export function currentMarketTargets(rows, deployment, collateralId) {
  if (!Array.isArray(rows)) {
    throw new Error("fresh market registry response is invalid");
  }
  return rows
    .filter((row) =>
      row.market_state === "active"
      && row.factory_id === deployment.contracts.factory
      && row.pool_id === deployment.contracts.sharedVault
      && row.resolver_type === "price"
      && row.collateral_sac === collateralId
      && PROPOSAL_ID.test(row.proposal_id || "")
      && CONTRACT_ID.test(row.market_id || "")
      && CONTRACT_ID.test(row.liquidity_vault_id || "")
    )
    .map((row) => ({
      marketId: row.market_id,
      poolId: row.pool_id,
      liquidityVaultId: row.liquidity_vault_id,
    }));
}
