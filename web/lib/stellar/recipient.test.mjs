import assert from "node:assert";
import { recipientField } from "./recipient.ts";
const f = recipientField("GAGRIGZCFEYDOPSFJRJVUYLIN53H3BELSKM2BJ5OWW6MHSWR3DP6NEHL");
assert.equal(f, "14424849361604235067380174612331688627869017881593838234321894168208481505144");
console.log("recipient ok");
