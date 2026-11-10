import { xdr } from "@stellar/stellar-sdk";

export const PRIVATE_RELAY_METHODS = Object.freeze({
  private_transfer: 3,
  withdraw: 5,
  fund_liquidity: 8,
  unfund_liquidity: 8,
  redeem_liquidity: 8,
  request_liquidity_exit: 12,
  cancel_liquidity_exit: 7,
  match_liquidity_exit: 15,
  open_epoch: 1,
  accept_order: 6,
  refund_order: 5,
  recover_execution_change: 5,
  claim_position: 5,
});

export function decodeRelayRequest(body) {
  if (
    !body ||
    typeof body.method !== "string" ||
    !Object.hasOwn(PRIVATE_RELAY_METHODS, body.method) ||
    !Array.isArray(body.args) ||
    body.args.length !== PRIVATE_RELAY_METHODS[body.method]
  ) {
    throw new Error("unsupported private relay request");
  }
  const args = body.args.map((value) => {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 196_608
    ) {
      throw new Error("invalid relay argument");
    }
    try {
      const decoded = xdr.ScVal.fromXDR(value, "base64");
      if (decoded.toXDR("base64") !== value) {
        throw new Error("noncanonical XDR");
      }
      return decoded;
    } catch {
      throw new Error("invalid relay argument");
    }
  });
  return { method: body.method, args };
}

export { FixedWindowRateLimiter } from "./rate-limit.mjs";
