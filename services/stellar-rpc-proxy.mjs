export const STELLAR_RPC_METHODS = new Set([
  "getEvents",
  "getFeeStats",
  "getHealth",
  "getLatestLedger",
  "getLedgerEntries",
  "getLedgers",
  "getNetwork",
  "getTransaction",
  "getTransactions",
  "getVersionInfo",
  "sendTransaction",
  "simulateTransaction",
]);

export function isAllowedStellarRpcRequest(body) {
  return body?.jsonrpc === "2.0" &&
    typeof body.method === "string" &&
    STELLAR_RPC_METHODS.has(body.method) &&
    (
      body.params === undefined ||
      body.params === null ||
      typeof body.params === "object"
    );
}
