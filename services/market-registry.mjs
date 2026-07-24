const STATES = new Set(["active", "cancelled"]);

function registryConfig(env) {
  const url =
    env.MARKET_REGISTRY_SUPABASE_URL ||
    env.SUPABASE_URL ||
    "";
  const key =
    env.MARKET_REGISTRY_SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  if (!url && !key) return null;
  if (!url || !key) {
    throw new Error("public market registry configuration is incomplete");
  }
  return { url: url.replace(/\/+$/u, ""), key };
}

export async function syncPublicMarketState({
  proposalId,
  state,
  poolId,
  env = process.env,
  fetchImpl = fetch,
}) {
  if (!/^[0-9a-f]{64}$/u.test(proposalId || "")) {
    throw new Error("public market registry proposal ID is invalid");
  }
  if (!STATES.has(state)) {
    throw new Error("public market registry state is invalid");
  }
  if (poolId !== undefined && !/^C[A-Z2-7]{55}$/u.test(poolId)) {
    throw new Error("public market registry pool ID is invalid");
  }
  const config = registryConfig(env);
  if (!config) return { configured: false };

  const response = await fetchImpl(
    `${config.url}/rest/v1/markets_meta?proposal_id=eq.${proposalId}&select=proposal_id,market_id,pool_id,market_state`,
    {
      method: "PATCH",
      headers: {
        apikey: config.key,
        authorization: `Bearer ${config.key}`,
        "content-type": "application/json",
        prefer: "return=representation",
      },
      body: JSON.stringify({
        market_state: state,
        pool_id: poolId || null,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `public market registry update failed with HTTP ${response.status}`,
    );
  }
  const records = await response.json();
  if (
    !Array.isArray(records) ||
    records.length !== 1 ||
    records[0]?.proposal_id !== proposalId ||
    records[0]?.market_state !== state ||
    records[0]?.pool_id !== (poolId || null)
  ) {
    throw new Error("fresh public market registry record was not updated");
  }
  return { configured: true, record: records[0] };
}
