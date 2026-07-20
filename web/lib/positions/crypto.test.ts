import assert from "node:assert";
import { backupMessage, decryptPosition, deriveBackupKey, encryptPosition } from "./crypto.ts";
import type { Position } from "./book.ts";

const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const position: Position = {
  address,
  market: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  pool: "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARQG",
  side: "0",
  amount: "10",
  stakeAmount: "25",
  collateralCode: "USDC",
  secret: "11",
  nullifier: "12",
  commitment: "13",
  txHash: "a".repeat(64),
  placedAt: 100,
  status: "submitted",
};

assert.match(backupMessage(address, "testnet"), /does not submit a transaction/);

async function main() {
  const key = await deriveBackupKey(address, "testnet", "deterministic-wallet-signature");
  const encrypted = await encryptPosition(position, key);
  assert.notEqual(Buffer.from(encrypted.ciphertext, "base64").toString("utf8"), JSON.stringify(position));
  assert.deepEqual(await decryptPosition(encrypted.ciphertext, encrypted.iv, key), position);

  const wrongKey = await deriveBackupKey(address, "testnet", "different-signature");
  await assert.rejects(() => decryptPosition(encrypted.ciphertext, encrypted.iv, wrongKey));

  console.log("position encryption ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
