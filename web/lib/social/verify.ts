import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

const SEP53_PREFIX = "Stellar Signed Message:\n";

export function sep53Hash(message: string): Buffer {
  const payload = Buffer.concat([Buffer.from(SEP53_PREFIX, "utf8"), Buffer.from(message, "utf8")]);
  return createHash("sha256").update(payload).digest();
}

export function verifyWalletSignature(address: string, message: string, signatureBase64: string): boolean {
  let kp: Keypair;
  let sig: Buffer;
  try {
    kp = Keypair.fromPublicKey(address);
    sig = Buffer.from(signatureBase64, "base64");
  } catch {
    return false;
  }
  if (sig.length === 0) return false;

  const candidates = [sep53Hash(message), Buffer.from(message, "utf8")];
  for (const data of candidates) {
    try {
      if (kp.verify(data, sig)) return true;
    } catch {
      continue;
    }
  }
  return false;
}
