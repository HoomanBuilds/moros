import assert from "node:assert";
import { truncate } from "./wallet";

assert.equal(truncate("GABCDEFGHIJKLMNOP1234567890"), "GABCDE...567890");
assert.equal(truncate(""), "");
console.log("wallet ok");
