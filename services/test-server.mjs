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
procs.push(
  spawn("node", [resolve(HERE, "server.mjs")], {
    env: {
      ...process.env, PORT: String(SPORT), SERVICE_TOKEN: STOKEN, MEMBER_TOKEN: MTOKEN,
      MEMBERS: memberUrls.join(","), THRESHOLD: "2", BATCH_N: "4", WINDOW_MS: "600000",
      DRY_RUN: "1",
    },
    stdio: ["ignore", "inherit", "inherit"],
  })
);

const base = `http://127.0.0.1:${SPORT}`;
const hdr = { "content-type": "application/json", authorization: `Bearer ${STOKEN}` };
const work = mkdtempSync(resolve(tmpdir(), "server-test-"));

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

  const orders = [
    { amount: "10", side: "1", secret: "100", nullifier: "101" },
    { amount: "20", side: "1", secret: "102", nullifier: "103" },
    { amount: "5", side: "0", secret: "104", nullifier: "105" },
    { amount: "15", side: "0", secret: "106", nullifier: "107" },
  ];
  const proofs = [];
  for (const [k, o] of orders.entries()) {
    const rnd = () => {
      const b = createHash("sha256").update(`sv-${k}-${Math.random()}`).digest("hex");
      return (BigInt("0x" + b) % 6554484396890773809930967563523245729705921265872317281365359162392183254199n).toString();
    };
    const inPath = resolve(work, `in${k}.json`);
    writeFileSync(inPath, JSON.stringify({ ...o, ryes: rnd(), rno: rnd(), pk }));
    sh("node", [resolve(CIRC, "build/encrypt_order_js/generate_witness.js"), resolve(CIRC, "build/encrypt_order_js/encrypt_order.wasm"), inPath, resolve(work, `w${k}.wtns`)]);
    sh(SNARKJS, ["groth16", "prove", resolve(CIRC, "build/encrypt_order_final.zkey"), resolve(work, `w${k}.wtns`), resolve(work, `p${k}.json`), resolve(work, `pub${k}.json`)]);
    proofs.push({
      proof: JSON.parse(readFileSync(resolve(work, `p${k}.json`), "utf8")),
      publicSignals: JSON.parse(readFileSync(resolve(work, `pub${k}.json`), "utf8")),
    });
  }
  console.log("4 order proofs generated client-side (secrets never sent)");

  const un = await fetch(`${base}/order`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(proofs[0]) });
  if (un.status !== 401) throw new Error("unauthenticated order accepted");
  console.log("unauthenticated /order rejected (401)");

  const tampered = structuredClone(proofs[0]);
  tampered.publicSignals[2] = "12345";
  const bad = await fetch(`${base}/order`, { method: "POST", headers: hdr, body: JSON.stringify(tampered) });
  if (bad.status !== 400) throw new Error(`tampered proof accepted: ${bad.status}`);
  console.log("tampered ciphertext rejected (proof verification failed)");

  for (const [k, p] of proofs.entries()) {
    const r = await fetch(`${base}/order`, { method: "POST", headers: hdr, body: JSON.stringify(p) });
    if (r.status !== 200) throw new Error(`order ${k} rejected: ${await r.text()}`);
  }
  console.log("4 valid encrypted orders queued");

  const dup = await fetch(`${base}/order`, { method: "POST", headers: hdr, body: JSON.stringify(proofs[0]) });
  if (dup.status !== 409) throw new Error(`duplicate nullifier accepted: ${dup.status}`);
  console.log("duplicate nullifier rejected (409)");

  const w = await (await fetch(`${base}/batch`, { method: "POST", headers: hdr })).json();
  console.log("window result:", JSON.stringify(w));
  if (!w.dryRun || w.dqyes !== "30" || w.dqno !== "20") throw new Error("window net mismatch");
  console.log("PASS: server verifies proofs, holds only ciphertexts, committee decrypts only the net (30, 20).");
} finally {
  for (const p of procs) p.kill();
  rmSync(work, { recursive: true, force: true });
}
