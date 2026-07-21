import { COMMITTEE_URL } from "./config";

export async function getPk(): Promise<string[]> {
  const r = await fetch(`${COMMITTEE_URL}/pk`);
  if (!r.ok) throw new Error("committee /pk unavailable");
  return (await r.json()).pk;
}

export async function getProof(
  commitment: string,
  poolId?: string,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<{ pathIndex: string; siblings: string[]; orderRoot: string }> {
  const attempts = opts.attempts ?? 24;
  const delayMs = opts.delayMs ?? 2500;
  for (let i = 0; i < attempts; i++) {
    try {
      const suffix = poolId ? `?poolId=${encodeURIComponent(poolId)}` : "";
      const r = await fetch(`${COMMITTEE_URL}/proof/${commitment}${suffix}`);
      if (r.ok) {
        const proof = await r.json();
        if (!poolId || proof.poolId === poolId) return proof;
      }
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
  if (r.status === 409) return;
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

async function registrationError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (!body) return `service returned HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
  } catch {
    return body.slice(0, 240);
  }
  return body.slice(0, 240);
}

export async function registerPool(marketId: string, poolId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${COMMITTEE_URL}/register-pool`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId, poolId }),
    });
  } catch {
    throw new Error("The market contracts are confirmed, but Moros services could not be reached. Retry market setup to register them.");
  }
  if (!response.ok) {
    const detail = await registrationError(response);
    throw new Error(`The market contracts are confirmed, but service registration was rejected: ${detail}. Retry market setup after the service is ready.`);
  }
}
