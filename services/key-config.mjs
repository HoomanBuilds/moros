import { execFileSync } from "node:child_process";
import { Keypair } from "@stellar/stellar-sdk";

function readStellarIdentity(identity) {
  return execFileSync("stellar", ["keys", "secret", identity], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

export function configuredSecret(
  { secret, identity, label },
  readIdentity = readStellarIdentity,
) {
  const value = secret || (identity ? readIdentity(identity) : "");
  if (!value) return "";
  try {
    Keypair.fromSecret(value);
  } catch {
    throw new Error(`${label} is not a valid Stellar secret`);
  }
  return value;
}
