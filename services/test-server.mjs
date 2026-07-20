import { spawn, spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const CIRC = resolve(REPO, "contracts/shielded-pool/circuits");
const SNARKJS = resolve(REPO, "circuits/node_modules/.bin/snarkjs");
const STOKEN = "test-service-token";
const MTOKEN = "test-member-token";
const SPORT = 39730;
const TEST_MARKET = "CBKR2OYQHNBYUSHQEFEHB4GI6BMZYXP35GPYYCBKFRTZBTR6NV3P3MXS";
const TEST_POOL = "CDUYUZEZBIWRPXM3ITDQZBANHN3Q6B6KUKCBV7MP6BGLYRQCT6QSV23E";
const work = mkdtempSync(resolve(tmpdir(), "server-test-"));
const keeperStatusFile = resolve(work, "keeper-status.json");
writeFileSync(keeperStatusFile, JSON.stringify({
  lastTickAt: new Date().toISOString(),
  marketsScanned: 0,
  dueMarkets: 0,
  resolvedMarkets: 0,
  voidedMarkets: 0,
  waitingForOracle: 0,
  errors: [],
}));

function sh(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} failed: ${(r.stderr || r.stdout).slice(-400)}`);
  return r.stdout;
}

const memberUrls = ["http://127.0.0.1:39731", "http://127.0.0.1:39732", "http://127.0.0.1:39733"];
const procs = memberUrls.map((url, k) =>
  spawn("node", [resolve(HERE, "committee/member.mjs")], {
    env: { ...process.env, PORT: new URL(url).port, INDEX: String(k + 1), MEMBER_TOKEN: MTOKEN },
    stdio: "ignore",
  })
);
const serverProc = spawn("node", [resolve(HERE, "server.mjs")], {
    env: {
      ...process.env, PORT: String(SPORT), SERVICE_TOKEN: STOKEN, MEMBER_TOKEN: MTOKEN,
      MEMBERS: memberUrls.join(","), THRESHOLD: "2", BATCH_N: "4", WINDOW_MS: "600000",
      DRY_RUN: "1", ALLOW_UNVERIFIED_REGISTRATION: "1",
      POOL_ID: "", MARKET: "", FUNDER_SK: "",
      POOLS_FILE: resolve(work, "pools.json"), QUEUE_FILE: resolve(work, "queue.json"),
      INDEXER_DIR: resolve(work, "indexer"),
      KEEPER_STATUS_FILE: keeperStatusFile, KEEPER_STALE_MS: "60000",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
serverProc.on("exit", (code, signal) => {
  if (code && code !== 0) console.error(`server exited during test: code=${code} signal=${signal}`);
});
procs.push(serverProc);

const base = `http://127.0.0.1:${SPORT}`;
const publicHdr = { "content-type": "application/json" };
const hdr = { ...publicHdr, authorization: `Bearer ${STOKEN}` };

try {
  let pk = null;
  for (let k = 0; k < 120; k++) {
    try {
      const r = await fetch(`${base}/pk`);
      if (r.ok) { pk = (await r.json()).pk; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!pk) throw new Error("server never became ready");
  console.log("server up; epoch committee pk fetched from /pk");

  const health = await fetch(`${base}/health`);
  if (!health.ok || !(await health.json()).healthy) throw new Error("healthy committee and keeper reported unavailable");
  console.log("health includes a fresh keeper heartbeat");

  const registered = await fetch(`${base}/register-pool`, {
    method: "POST",
    headers: publicHdr,
    body: JSON.stringify({ marketId: TEST_MARKET, poolId: TEST_POOL }),
  });
  if (!registered.ok) throw new Error(`pool registration failed: ${await registered.text()}`);
  console.log("public pool registration accepted in explicit test mode");

  const invalidProofLookup = await fetch(`${base}/proof/not-a-commitment?poolId=${TEST_POOL}`);
  if (invalidProofLookup.status !== 400) throw new Error("malformed proof lookup was not rejected");
  const wrongPoolProofLookup = await fetch(`${base}/proof/1?poolId=${TEST_MARKET}`);
  if (wrongPoolProofLookup.status !== 404) throw new Error("proof lookup silently searched outside the requested pool");
  console.log("membership proof lookup is bound to its requested pool");

  const wrongPoolRedeem = await fetch(`${base}/redeem`, {
    method: "POST",
    headers: publicHdr,
    body: JSON.stringify({ proof: {}, public: {}, recipient: TEST_MARKET, poolId: TEST_MARKET }),
  });
  if (wrongPoolRedeem.status !== 404) throw new Error("redemption silently fell back from an unregistered pool");
  console.log("unregistered redemption pool rejected without fallback");

  const orders = [
    { amount: "10", side: "1", secret: "100", nullifier: "101" },
    { amount: "20", side: "1", secret: "102", nullifier: "103" },
    { amount: "5", side: "0", secret: "104", nullifier: "105" },
    { amount: "15", side: "0", secret: "106", nullifier: "107" },
  ];
  const ORDER_TREE = resolve(REPO, "inspiration/zk/soroban-privacy-pools/target/release/order_tree");
  const ordersPath = resolve(work, "orders.json");
  writeFileSync(ordersPath, JSON.stringify(orders));
  const tree = JSON.parse(sh(ORDER_TREE, [ordersPath, "16"]));
  const proofs = [];
  for (const [k, o] of orders.entries()) {
    const rnd = () => {
      const b = createHash("sha256").update(`sv-${k}-${Math.random()}`).digest("hex");
      return (BigInt("0x" + b) % 6554484396890773809930967563523245729705921265872317281365359162392183254199n).toString();
    };
    const leaf = tree.orders[k];
    const inPath = resolve(work, `in${k}.json`);
    writeFileSync(inPath, JSON.stringify({ orderRoot: tree.orderRoot, ...o, ryes: rnd(), rno: rnd(), pk, pathIndex: leaf.pathIndex, siblings: leaf.siblings }));
    sh("node", [resolve(CIRC, "build/encrypt_order_js/generate_witness.js"), resolve(CIRC, "build/encrypt_order_js/encrypt_order.wasm"), inPath, resolve(work, `w${k}.wtns`)]);
    sh(SNARKJS, ["groth16", "prove", resolve(CIRC, "build/encrypt_order_final.zkey"), resolve(work, `w${k}.wtns`), resolve(work, `p${k}.json`), resolve(work, `pub${k}.json`)]);
    proofs.push({
      proof: JSON.parse(readFileSync(resolve(work, `p${k}.json`), "utf8")),
      publicSignals: JSON.parse(readFileSync(resolve(work, `pub${k}.json`), "utf8")),
    });
  }
  console.log("4 order proofs generated client-side (membership + ciphertext; secrets never sent)");

  const tampered = structuredClone(proofs[0]);
  tampered.publicSignals[2] = "12345";
  const bad = await fetch(`${base}/order`, { method: "POST", headers: publicHdr, body: JSON.stringify({ ...tampered, poolId: TEST_POOL }) });
  if (bad.status !== 400) throw new Error(`tampered proof accepted: ${bad.status}`);
  console.log("tampered ciphertext rejected (proof verification failed)");

  for (const [k, p] of proofs.entries()) {
    const r = await fetch(`${base}/order`, { method: "POST", headers: publicHdr, body: JSON.stringify({ ...p, poolId: TEST_POOL }) });
    if (r.status !== 200) throw new Error(`order ${k} rejected: ${await r.text()}`);
  }
  console.log("4 valid encrypted orders queued");

  const dup = await fetch(`${base}/order`, { method: "POST", headers: publicHdr, body: JSON.stringify({ ...proofs[0], poolId: TEST_POOL }) });
  if (dup.status !== 409) throw new Error(`duplicate nullifier accepted: ${dup.status}`);
  console.log("duplicate nullifier rejected (409)");

  const unauthBatch = await fetch(`${base}/batch`, { method: "POST", headers: publicHdr, body: JSON.stringify({ poolId: TEST_POOL }) });
  if (unauthBatch.status !== 401) throw new Error("unauthenticated force batch accepted");
  console.log("unauthenticated force batch rejected (401)");

  const w = await (await fetch(`${base}/batch`, { method: "POST", headers: hdr, body: JSON.stringify({ poolId: TEST_POOL }) })).json();
  console.log("window result:", JSON.stringify(w));
  if (!w.dryRun || w.dqyes !== "30" || w.dqno !== "20") throw new Error("window net mismatch");
  console.log("PASS: server verifies proofs, holds only ciphertexts, committee decrypts only the net (30, 20).");
} finally {
  for (const p of procs) p.kill();
  rmSync(work, { recursive: true, force: true });
}
