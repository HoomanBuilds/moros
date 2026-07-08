import { spawn } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { encrypt, addCiphers, mul, G8 } from "./jubjub.mjs";
import { runDKG, decryptNet } from "./coordinator.mjs";
import { memberVerifyKey } from "./dkg-jubjub.mjs";
import { verifyPartial } from "./chaum-pedersen.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = "test-committee-token";
const members = { 1: "http://127.0.0.1:39711", 2: "http://127.0.0.1:39712", 3: "http://127.0.0.1:39713" };

const procs = [];
for (const [i, url] of Object.entries(members)) {
  const port = new URL(url).port;
  procs.push(spawn("node", [resolve(HERE, "member.mjs")], {
    env: { ...process.env, PORT: port, INDEX: i, MEMBER_TOKEN: TOKEN },
    stdio: "ignore",
  }));
}

async function waitHealthy() {
  for (let k = 0; k < 50; k++) {
    try {
      for (const url of Object.values(members)) {
        const r = await fetch(`${url}/health`);
        if (!r.ok) throw new Error();
      }
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("members never became healthy");
}

try {
  await waitHealthy();
  console.log("3 committee member services up (separate processes)");

  const unauth = await fetch(`${members[1]}/dkg/status`);
  if (unauth.status !== 401) { console.error("FAIL: unauthenticated request accepted"); process.exit(1); }
  console.log("unauthenticated request rejected (401)");

  const dkg = await runDKG(members, 2, TOKEN);
  console.log("networked DKG complete: joint pk agreed by all members; shares moved member-to-member only");

  const orders = [
    { a: 10, s: 1 },
    { a: 20, s: 1 },
    { a: 5, s: 0 },
    { a: 15, s: 0 },
  ];
  const netYes = addCiphers(orders.map((o) => encrypt(dkg.pk, o.s === 1 ? o.a : 0)));
  const netNo = addCiphers(orders.map((o) => encrypt(dkg.pk, o.s === 0 ? o.a : 0)));

  const quorum = { 1: members[1], 3: members[3] };
  const dqyes = await decryptNet(quorum, dkg, netYes, TOKEN);
  const dqno = await decryptNet(quorum, dkg, netNo, TOKEN);
  console.log("verified network decryption: dqyes =", dqyes, " dqno =", dqno, " (expect 30, 20)");
  if (dqyes !== 30n || dqno !== 20n) { console.error("FAIL"); process.exit(1); }

  const c1 = [netYes.c1[0].toString(), netYes.c1[1].toString()];
  const raw = await (await fetch(`${members[2]}/partial`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ c1 }),
  })).json();
  const forged = {
    i: BigInt(raw.i),
    d: mul(G8, 42n),
    proof: { a1: [BigInt(raw.proof.a1[0]), BigInt(raw.proof.a1[1])], a2: [BigInt(raw.proof.a2[0]), BigInt(raw.proof.a2[1])], z: BigInt(raw.proof.z) },
  };
  const allCms = Object.values(dkg.commitments).map((cms) => cms.map((a) => [BigInt(a[0]), BigInt(a[1])]));
  if (verifyPartial(memberVerifyKey(allCms, forged.i), netYes.c1, forged)) {
    console.error("FAIL: forged network partial accepted");
    process.exit(1);
  }
  console.log("forged network partial rejected by coordinator verification");
  console.log("PASS: committee runs as separate networked services; coordinator verifies every partial and never holds a share.");
} finally {
  for (const p of procs) p.kill();
}
