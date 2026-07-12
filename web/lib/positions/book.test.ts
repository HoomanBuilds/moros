import assert from "node:assert";
import { addPosition, listPositions, updateStatus, _resetForTest } from "./book.ts";

_resetForTest({});
addPosition({ address: "GA", market: "m", side: "1", amount: "10", secret: "1", nullifier: "2", commitment: "3", txHash: "t", status: "placed" });
const list = listPositions("GA");
assert.equal(list.length, 1);
assert.equal(list[0].commitment, "3");
assert.equal(listPositions("GB").length, 0);

updateStatus("GA", "3", "redeemed");
assert.equal(listPositions("GA")[0].status, "redeemed");

updateStatus("GA", "does-not-exist", "redeemed");
assert.equal(listPositions("GA")[0].status, "redeemed");

updateStatus("GB", "3", "redeemed");
assert.equal(listPositions("GB").length, 0);

console.log("book ok");
