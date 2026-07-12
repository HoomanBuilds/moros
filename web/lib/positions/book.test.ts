import assert from "node:assert";
import { addPosition, listPositions, _resetForTest } from "./book.ts";

_resetForTest({});
addPosition({ address: "GA", market: "m", side: "1", amount: "10", secret: "1", nullifier: "2", commitment: "3", txHash: "t", status: "placed" });
const list = listPositions("GA");
assert.equal(list.length, 1);
assert.equal(list[0].commitment, "3");
assert.equal(listPositions("GB").length, 0);
console.log("book ok");
