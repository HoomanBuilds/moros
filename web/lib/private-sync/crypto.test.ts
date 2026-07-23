import assert from "node:assert/strict";
import { utf8 } from "./encoding.ts";
import {
  derivePrivateArchiveKeys,
  joinArchivePages,
  splitArchivePages,
} from "./crypto.ts";
import {
  canonicalJson,
  PRIVATE_SYNC_PAGE_BYTES,
  PRIVATE_SYNC_SCHEMA,
  privateSyncMessage,
  type RegisterPayload,
} from "./protocol.ts";
import type { Position } from "../positions/book.ts";

const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const vault = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const market = "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARQG";
const position: Position = {
  address,
  market,
  pool: vault,
  side: "1",
  amount: "100",
  collateralCode: "USDC",
  stakeAmount: "150",
  secret: "101",
  nullifier: "102",
  commitment: "103",
  txHash: "a".repeat(64),
  placedAt: 100,
  status: "submitted",
};

async function main() {
  const keys = await derivePrivateArchiveKeys(
    address,
    "testnet",
    vault,
    "deterministic-wallet-signature",
  );
  const same = await derivePrivateArchiveKeys(
    address,
    "testnet",
    vault,
    "deterministic-wallet-signature",
  );
  const other = await derivePrivateArchiveKeys(
    address,
    "testnet",
    vault,
    "different-wallet-signature",
  );
  assert.equal(keys.bucketId, same.bucketId);
  assert.equal(keys.verificationKey, same.verificationKey);
  assert.notEqual(keys.bucketId, other.bucketId);
  assert.notEqual(keys.verificationKey, address);

  const pages = await splitArchivePages(keys, [position]);
  assert.equal(pages.length, 1);
  assert.equal(Buffer.from(pages[0].ciphertext, "base64").length, PRIVATE_SYNC_PAGE_BYTES + 16);
  assert.equal(Buffer.from(pages[0].ciphertext, "base64").includes(Buffer.from(address)), false);
  assert.deepEqual(await joinArchivePages(keys, pages), [position]);
  await assert.rejects(() => joinArchivePages(other, pages));

  const tampered = structuredClone(pages);
  tampered[0].ciphertextHash = "0".repeat(64);
  await assert.rejects(() => joinArchivePages(keys, tampered), /hash mismatch/);

  const payload: RegisterPayload = {
    operation: "register",
    bucketId: keys.bucketId,
    schemaVersion: PRIVATE_SYNC_SCHEMA,
    verificationKey: keys.verificationKey,
  };
  const message = privateSyncMessage(payload, "f".repeat(64), "n".repeat(32), 10);
  const signature = keys.signingKey.sign(utf8(message) as Buffer);
  assert.equal(keys.signingKey.verify(utf8(message) as Buffer, signature), true);
  assert.equal(canonicalJson({ z: 1, a: { d: 2, b: 3 } }), '{"a":{"b":3,"d":2},"z":1}');

  console.log("opaque private activity crypto ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
