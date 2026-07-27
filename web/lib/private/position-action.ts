export function privatePositionContractMethod(
  action: "recover-change" | "claim" | "refund",
  refundableEpoch: boolean,
): "recover_execution_change" | "claim_position" | "refund_order" {
  if (action === "recover-change") return "recover_execution_change";
  if (action === "claim" || !refundableEpoch) return "claim_position";
  return "refund_order";
}
