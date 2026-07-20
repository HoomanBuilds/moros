import { COMMITTEE_URL } from "./config";

export async function getPk(): Promise<string[]> {
  const r = await fetch(`${COMMITTEE_URL}/pk`);
  if (!r.ok) throw new Error("committee /pk unavailable");
  return (await r.json()).pk;
}

export async function getProof(
  commitment: string,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<{ pathIndex: string; siblings: string[]; orderRoot: string }> {
  const attempts = opts.attempts ?? 24;
  const delayMs = opts.delayMs ?? 2500;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${COMMITTEE_URL}/proof/${commitment}`);
      if (r.ok) return r.json();
    } catch {
      // network blip - fall through to retry
    }
    if (i < attempts - 1) await new Promise((res) => setTimeout(res, delayMs));
  }
  throw new Error("membership proof not ready - the committee indexer has not seen this order yet");
}

export async function postOrder(body: { proof: unknown; publicSignals: string[]; poolId: string }, token?: string): Promise<void> {
  const r = await fetch(`${COMMITTEE_URL}/order`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`committee rejected order: ${await r.text()}`);
}

export async function postRedeem(body: { proof: unknown; publicSignals: string[]; recipient: string; poolId: string; protocolVersion?: 2 | 3 }): Promise<unknown> {
  const r = await fetch(`${COMMITTEE_URL}/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proof: body.proof, public: body.publicSignals, recipient: body.recipient, poolId: body.poolId, protocolVersion: body.protocolVersion ?? 2 }),
  });
  if (!r.ok) throw new Error(`committee rejected redeem: ${await r.text()}`);
  return r.json();
}

export async function registerPool(marketId: string, poolId: string, protocolVersion: 2 | 3 = 2): Promise<boolean> {
  try {
    const r = await fetch(`${COMMITTEE_URL}/register-pool`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId, poolId, protocolVersion }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
