import assert from "node:assert";
import {
  _resetForTest,
  addPosition,
  configurePositionBook,
  exportWallet,
  importWallet,
  listPositions,
  updatePosition,
  type Position,
} from "./book.ts";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
});

const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const other = "GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABX";
const position: Position = {
  address,
  market: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  pool: "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARQG",
  side: "1",
  amount: "10",
  stakeAmount: "10",
  collateralCode: "USDC",
  secret: "11",
  nullifier: "12",
  commitment: "13",
  txHash: "a".repeat(64),
  placedAt: 100,
  status: "placed",
};

_resetForTest({});
configurePositionBook(position.pool!);
addPosition(position);
addPosition({ ...position, status: "submitted", placedAt: 101 });
assert.equal(listPositions(address).length, 1);
assert.equal(listPositions(address)[0].status, "submitted");

addPosition({ ...position, status: "placed", placedAt: 101 });
assert.equal(listPositions(address)[0].status, "submitted");

updatePosition(address, position.commitment, { status: "redeemed", settlementTxHash: "b".repeat(64) });
assert.equal(listPositions(address)[0].settlementTxHash, "b".repeat(64));

const backup = exportWallet(address);
_resetForTest({});
assert.equal(importWallet(backup, address), 1);
assert.equal(listPositions(address)[0].market, position.market);
assert.throws(() => importWallet(backup, other));

assert.throws(() => addPosition({ ...position, txHash: "bad" }));

const otherVault = `C${"A".repeat(55)}`;
configurePositionBook(otherVault);
assert.equal(listPositions(address).length, 0);
configurePositionBook(position.pool!);
assert.equal(listPositions(address).length, 1);

console.log("position book ok");
