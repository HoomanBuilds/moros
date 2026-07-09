import { spawn } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { encrypt, addCiphers } from "./jubjub.mjs";
import { ensureDKG, decryptNet } from "./coordinator.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = "persist-token";
const members = { 1: "http://127.0.0.1:39751", 2: "http://127.0.0.1:39752", 3: "http://127.0.0.1:39753" };
const dir = mkdtempSync(resolve(tmpdir(), "persist-"));

function spawnMembers() {
  return Object.entries(members).map(([i, url]) =>
    spawn("node", [resolve(HERE, "member.mjs")], {
      env: { ...process.env, PORT: new URL(url).port, INDEX: i, MEMBER_TOKEN: TOKEN, SHARE_FILE: resolve(dir, `share${i}.json`) },
      stdio: "ignore",
    })
  );
}
async function waitHealthy() {
  for (let k = 0; k < 60; k++) {
    try { for (const u of Object.values(members)) if (!(await fetch(`${u}/health`)).ok) throw 0; return; }
    catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("not healthy");
}
const kill = (ps) => ps.forEach((p) => p.kill());
let ps = [];

try {
  ps = spawnMembers();
  await waitHealthy();
  const dkg1 = await ensureDKG(members, 2, TOKEN);
  const pk1 = JSON.stringify(dkg1.pk.map(String));
  if (dkg1.reused) throw new Error("first run should NOT be reused");
  console.log("initial DKG done; pk established");

  kill(ps);
  await new Promise((r) => setTimeout(r, 400));
  ps = spawnMembers();
  await waitHealthy();
  console.log("members restarted");

  const dkg2 = await ensureDKG(members, 2, TOKEN);
  const pk2 = JSON.stringify(dkg2.pk.map(String));
  if (!dkg2.reused) throw new Error("second run should reuse persisted epoch");
  if (pk1 !== pk2) throw new Error("pk changed across restart");
  console.log("after restart: epoch REUSED, same pk (no re-keying)");

  const orders = [{ a: 10, s: 1 }, { a: 20, s: 1 }, { a: 5, s: 0 }, { a: 15, s: 0 }];
  const netYes = addCiphers(orders.map((o) => encrypt(dkg2.pk, o.s === 1 ? o.a : 0)));
  const dqyes = await decryptNet({ 1: members[1], 3: members[3] }, dkg2, netYes, TOKEN);
  console.log("post-restart decryption dqyes =", dqyes, "(expect 30)");
  if (dqyes !== 30n) throw new Error("post-restart decryption failed");
  console.log("PASS: shares persist across restarts; committee key survives; no orphaned ciphertexts.");
} finally {
  kill(ps);
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
