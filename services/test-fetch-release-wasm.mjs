import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  RELEASE_WASM_FILES,
  fetchReleaseWasm,
} from "./fetch-release-wasm.mjs";

const artifacts = Object.fromEntries(
  Object.keys(RELEASE_WASM_FILES).map((name) => {
    const wasm = Buffer.from(`${name}-tested-wasm`);
    return [
      createHash("sha256").update(wasm).digest("hex"),
      wasm,
    ];
  }),
);
const deployment = {
  network: "testnet",
  mainnetReady: false,
  wasm: Object.fromEntries(
    Object.entries(RELEASE_WASM_FILES).map(([name], index) => [
      name,
      Object.keys(artifacts)[index],
    ]),
  ),
};
const outputRoot = mkdtempSync(resolve(tmpdir(), "moros-release-wasm-"));
const server = {
  getContractWasmByHash: async (hash) => artifacts[hash.toString("hex")],
};
const hashes = await fetchReleaseWasm({
  server,
  deployment,
  outputRoot,
});
assert.deepEqual(hashes, deployment.wasm);
for (const [name, file] of Object.entries(RELEASE_WASM_FILES)) {
  assert.deepEqual(
    readFileSync(resolve(outputRoot, file)),
    artifacts[deployment.wasm[name]],
  );
}
await assert.rejects(
  fetchReleaseWasm({
    server,
    deployment: { ...deployment, network: "mainnet" },
    outputRoot,
  }),
  /verified testnet deployment/,
);

console.log("release WASM fetch ok");
