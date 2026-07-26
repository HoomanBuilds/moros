import assert from "node:assert/strict";
import { isAllowedStellarRpcRequest } from "./stellar-rpc-proxy.mjs";

assert.equal(isAllowedStellarRpcRequest({
  jsonrpc: "2.0",
  method: "getLatestLedger",
}), true);
assert.equal(isAllowedStellarRpcRequest({
  jsonrpc: "2.0",
  method: "getLatestLedger",
  params: null,
}), true);
assert.equal(isAllowedStellarRpcRequest({
  jsonrpc: "2.0",
  method: "getEvents",
  params: {},
}), true);
assert.equal(isAllowedStellarRpcRequest({
  jsonrpc: "2.0",
  method: "getEvents",
  params: [],
}), true);
assert.equal(isAllowedStellarRpcRequest({
  jsonrpc: "2.0",
  method: "unknown",
  params: {},
}), false);
assert.equal(isAllowedStellarRpcRequest({
  jsonrpc: "2.0",
  method: "getEvents",
  params: "invalid",
}), false);

console.log("stellar rpc proxy ok");
