import { createHash } from "node:crypto";
import {
  Address,
  StrKey,
  hash,
  xdr,
} from "@stellar/stellar-sdk";
import { poseidon2Hash } from "@zkpassport/poseidon2";
import {
  FIELD,
  SUBORDER,
  publicKey,
} from "./committee/bn254-babyjub.mjs";

export const PRIVATE_TREE_LEVELS = 20;
export const PRIVATE_GENESIS_ROOT =
  2611866331166115416723223527596396580179948542347864251823105860387727173205n;

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

export function deterministicSalt(label) {
  if (!label) throw new Error("deployment salt label is required");
  return sha256(`Moros testnet contract salt:${label}`);
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

export function testnetPrivacyIdentity(secret) {
  const committeeSecret = secretScalar(secret, "committee");
  const committeePublicKey = publicKey(committeeSecret);
  const spendSecret = secretScalar(secret, "treasury-spend");
  const viewingSecret = secretScalar(secret, "treasury-view");
  const viewingPublicKey = publicKey(viewingSecret);
  const spendPublicKey = poseidon2Hash([1002n, spendSecret]);
  const treasuryKey = poseidon2Hash([
    1015n,
    spendPublicKey,
    viewingPublicKey[0],
    viewingPublicKey[1],
  ]);
  const committeeConfigHash = sha256(
    Buffer.concat([
      fieldBytes(committeePublicKey[0]),
      fieldBytes(committeePublicKey[1]),
      Buffer.from("moros-testnet-single-vm-committee"),
    ]),
  );
  return {
    committeeSecret,
    committeePublicKey,
    committeeConfigHash,
    treasuryKey,
    spendSecret,
    viewingSecret,
    spendPublicKey,
    viewingPublicKey,
  };
}
