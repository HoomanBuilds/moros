import assert from "node:assert/strict";
import { Keypair, Networks, StrKey } from "@stellar/stellar-sdk";
import {
  PRIVATE_GENESIS_ROOT,
  PRIVATE_TREE_LEVELS,
  deriveContractId,
  deterministicSalt,
  fieldBytes,
  networkDomain,
  testnetPrivacyIdentity,
} from "./deployment-utils.mjs";

const deployer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();
const salt = deterministicSalt("shared-vault");
const first = deriveContractId(deployer, salt, Networks.TESTNET);
const second = deriveContractId(deployer, salt, Networks.TESTNET);

assert.equal(first, second);
assert.equal(StrKey.isValidContract(first), true);
assert.notEqual(
  deriveContractId(deployer, deterministicSalt("factory"), Networks.TESTNET),
  first,
);
assert.notEqual(
  deriveContractId(deployer, salt, Networks.PUBLIC),
  first,
);
assert.equal(networkDomain(Networks.TESTNET).length, 32);
assert.equal(PRIVATE_TREE_LEVELS, 20);
assert.equal(
  PRIVATE_GENESIS_ROOT,
  2611866331166115416723223527596396580179948542347864251823105860387727173205n,
);

const identity = testnetPrivacyIdentity("test-only-secret");
assert.notEqual(identity.committeeSecret, identity.spendSecret);
assert.notEqual(identity.spendSecret, identity.viewingSecret);
assert.equal(identity.committeePublicKey.length, 2);
assert.equal(identity.viewingPublicKey.length, 2);
assert.equal(identity.committeeConfigHash.length, 32);
assert.equal(fieldBytes(identity.treasuryKey).length, 32);
assert.deepEqual(
  testnetPrivacyIdentity("test-only-secret"),
  identity,
);

assert.throws(() => fieldBytes(0n), /nonzero/);

console.log("deployment utils ok");
