import assert from "node:assert/strict";
import {
  PrivateProverArtifactCache,
  type PrivateProverArtifactSources,
} from "./prover-artifacts.ts";

const sources: PrivateProverArtifactSources = {
  wasm: "https://example.test/order.wasm",
  provingKey: "https://example.test/order.zkey",
  verificationKey: "https://example.test/order.json",
  preloadBinaries: true,
};

async function main() {
  const calls: string[] = [];
  const cache = new PrivateProverArtifactCache(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith(".json")) {
      return Response.json({ protocol: "groth16" });
    }
    return new Response(Uint8Array.from([1, 2, 3]));
  });
  const [first, second] = await Promise.all([
    cache.prepare("order", sources),
    cache.prepare("order", sources),
  ]);
  assert.equal(first, second);
  assert.deepEqual(calls.sort(), [
    sources.provingKey,
    sources.verificationKey,
    sources.wasm,
  ].sort());
  assert(first.wasm instanceof Uint8Array);
  assert(first.provingKey instanceof Uint8Array);

  const invocationContexts: unknown[] = [];
  const invocationSensitive = new PrivateProverArtifactCache(
    function (this: typeof globalThis, input: RequestInfo | URL) {
      invocationContexts.push(this);
      return String(input).endsWith(".json")
        ? Promise.resolve(Response.json({ protocol: "groth16" }))
        : Promise.resolve(new Response(Uint8Array.from([1])));
    } as typeof fetch,
  );
  await invocationSensitive.prepare("bound", sources);
  assert(invocationContexts.every((context) => context === globalThis));

  const local = await cache.prepare("local", {
    ...sources,
    preloadBinaries: false,
  });
  assert.equal(local.wasm, sources.wasm);
  assert.equal(local.provingKey, sources.provingKey);

  let failures = 0;
  const retrying = new PrivateProverArtifactCache(async () => {
    failures++;
    if (failures === 1) return new Response(null, { status: 503 });
    return Response.json({ protocol: "groth16" });
  });
  const verificationOnly = {
    ...sources,
    preloadBinaries: false,
  };
  await assert.rejects(
    retrying.prepare("retry", verificationOnly),
    /verification key is unavailable/,
  );
  await retrying.prepare("retry", verificationOnly);
  assert.equal(failures, 2);

  console.log("private prover artifacts ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
