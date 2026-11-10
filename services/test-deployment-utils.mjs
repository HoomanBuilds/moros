import assert from "node:assert/strict";
import { Keypair, Networks, StrKey } from "@stellar/stellar-sdk";
import {
  contractResultValue,
  deriveContractId,
  deterministicSalt,
  fieldBytes,
  networkDomain,
} from "./deployment-utils.mjs";

const deployer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();
const salt = deterministicSalt("payments-vault");
const first = deriveContractId(deployer, salt, Networks.TESTNET);
const second = deriveContractId(deployer, salt, Networks.TESTNET);

assert.equal(first, second);
assert.equal(StrKey.isValidContract(first), true);
assert.notEqual(
  deriveContractId(deployer, deterministicSalt("payment-verifier"), Networks.TESTNET),
  first,
);
assert.notEqual(
  deriveContractId(deployer, salt, Networks.PUBLIC),
  first,
);
assert.notDeepEqual(
  deterministicSalt("payments-vault", "mainnet"),
  salt,
);
assert.throws(
  () => deterministicSalt("payments-vault", "local"),
  /testnet or mainnet/,
);
assert.equal(networkDomain(Networks.TESTNET).length, 32);
assert.throws(() => fieldBytes(0n), /nonzero/);
assert.deepEqual(
  contractResultValue({ value: { quorum: 1 } }),
  { quorum: 1 },
);
assert.deepEqual(
  contractResultValue({ quorum: 1 }),
  { quorum: 1 },
);

console.log("deployment utils ok");
