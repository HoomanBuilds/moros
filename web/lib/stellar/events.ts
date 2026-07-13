import { rpc, xdr, scValToNative } from "@stellar/stellar-sdk";
import { NETWORK } from "@/lib/network";

const server = new rpc.Server(NETWORK.rpcUrl, { allowHttp: false });
const LEDGER_WINDOW = 9000;

export type ShieldedOrder = {
  index: number;
  commitment: string;
  ledger: number;
  at: number;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getRecentOrders(limit = 30): Promise<ShieldedOrder[]> {
  const latest = await server.getLatestLedger();
  const startLedger = Math.max(latest.sequence - LEDGER_WINDOW, 1);
  const res = await server.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [NETWORK.poolId],
        topics: [[xdr.ScVal.scvSymbol("order_placed").toXDR("base64"), "*"]],
      },
    ],
  });
  const byIndex = new Map<number, ShieldedOrder>();
  for (const ev of res.events ?? []) {
    const index = Number(scValToNative(ev.value)[0]);
    const commitment = "0x" + bytesToHex(scValToNative(ev.topic[1]) as Uint8Array);
    const at = ev.ledgerClosedAt ? Date.parse(ev.ledgerClosedAt) : 0;
    byIndex.set(index, { index, commitment, ledger: ev.ledger, at });
  }
  return [...byIndex.values()].sort((a, b) => b.index - a.index).slice(0, limit);
}
