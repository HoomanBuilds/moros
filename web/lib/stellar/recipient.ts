import { Address, xdr, hash } from "@stellar/stellar-sdk";

export function recipientField(address: string): string {
  const scv = xdr.ScVal.scvAddress(new Address(address).toScAddress());
  const h = hash(scv.toXDR());
  const bytes = new Uint8Array(h);
  bytes[0] &= 0x1f;
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt("0x" + hex).toString();
}
