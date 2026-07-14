import { COMMITTEE_URL } from "./config";

export async function getPk(): Promise<string[]> {
  const r = await fetch(`${COMMITTEE_URL}/pk`);
  if (!r.ok) throw new Error("committee /pk unavailable");
  return (await r.json()).pk;
}

export async function getProof(commitment: string): Promise<{ pathIndex: string; siblings: string[]; orderRoot: string }> {
  const r = await fetch(`${COMMITTEE_URL}/proof/${commitment}`);
  if (!r.ok) throw new Error("membership proof not ready");
  return r.json();
}

export async function postOrder(body: { proof: unknown; publicSignals: string[]; poolId: string }, token?: string): Promise<void> {
  const r = await fetch(`${COMMITTEE_URL}/order`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`committee rejected order: ${await r.text()}`);
}

export async function postRedeem(body: { proof: unknown; publicSignals: string[]; recipient: string; poolId: string }): Promise<unknown> {
  const r = await fetch(`${COMMITTEE_URL}/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proof: body.proof, public: body.publicSignals, recipient: body.recipient, poolId: body.poolId }),
  });
  if (!r.ok) throw new Error(`committee rejected redeem: ${await r.text()}`);
  return r.json();
}

export async function registerPool(marketId: string, poolId: string): Promise<boolean> {
  try {
    const r = await fetch(`${COMMITTEE_URL}/register-pool`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId, poolId }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
