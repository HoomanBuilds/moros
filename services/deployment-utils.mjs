import { createHash } from "node:crypto";
import {
  Address,
  StrKey,
  hash,
  xdr,
} from "@stellar/stellar-sdk";
import {
  FIELD,
  SUBORDER,
} from "./crypto/babyjub.mjs";

export function contractResultValue(value) {
  return value &&
    typeof value === "object" &&
    Object.hasOwn(value, "value")
    ? value.value
    : value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest();
}

export function deterministicSalt(label, network = "testnet") {
  if (!label) throw new Error("deployment salt label is required");
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error("deployment salt network must be testnet or mainnet");
  }
  return sha256(`Moros ${network} contract salt:${label}`);
}

export function deriveContractId(deployer, salt, networkPassphrase) {
  const saltBytes = Buffer.from(salt);
  if (saltBytes.length !== 32) throw new Error("contract salt must be 32 bytes");
  const networkId = hash(Buffer.from(networkPassphrase));
  const contractIdPreimage =
    xdr.ContractIdPreimage.contractIdPreimageFromAddress(
      new xdr.ContractIdPreimageFromAddress({
        address: Address.fromString(deployer).toScAddress(),
        salt: saltBytes,
      }),
    );
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId,
      contractIdPreimage,
    }),
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}

export function networkDomain(networkPassphrase) {
  return hash(Buffer.from(networkPassphrase));
}

export function secretScalar(secret, label) {
  if (!secret || !label) throw new Error("secret and derivation label are required");
  const value = BigInt(`0x${sha256(`${label}:${secret}`).toString("hex")}`);
  return (value % (SUBORDER - 1n)) + 1n;
}

export function fieldBytes(value) {
  const field = BigInt(value);
  if (field <= 0n || field >= FIELD) {
    throw new Error("value is not a nonzero BN254 scalar field element");
  }
  return Buffer.from(field.toString(16).padStart(64, "0"), "hex");
}
