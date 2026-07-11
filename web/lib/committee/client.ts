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

export async function postOrder(body: { proof: unknown; publicSignals: string[] }, token?: string): Promise<void> {
  const r = await fetch(`${COMMITTEE_URL}/order`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`committee rejected order: ${await r.text()}`);
}
