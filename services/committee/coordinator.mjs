import { createHash } from "crypto";
import { thresholdDecrypt } from "./jubjub.mjs";
import { memberVerifyKey } from "./dkg-jubjub.mjs";
import { verifyPartial } from "./chaum-pedersen.mjs";

const unpt = (a) => [BigInt(a[0]), BigInt(a[1])];

async function post(url, path, obj, token) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${url}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          connection: "close",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(obj),
      });
      if (!r.ok) throw new Error(`${url}${path} -> ${r.status}: ${await r.text()}`);
      return r.json();
    } catch (e) {
      last = e;
      if (!String(e.cause?.code || "").startsWith("UND_ERR")) throw e;
    }
  }
  throw last;
}

async function get(url, path, token) {
  const r = await fetch(`${url}${path}`, {
    headers: { connection: "close", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (!r.ok) throw new Error(`${url}${path} -> ${r.status}`);
  return r.json();
}

export async function ensureDKG(members, t, token) {
  const statuses = {};
  let allReady = true;
  for (const [i, url] of Object.entries(members)) {
    try {
      const st = await get(url, "/dkg/status", token);
      statuses[i] = st;
      if (!st.ready) allReady = false;
    } catch {
      allReady = false;
    }
  }
  if (allReady) {
    const pks = Object.values(statuses).map((s) => JSON.stringify(s.pk));
    if (new Set(pks).size === 1) {
      const commitments = {};
      for (const [i, url] of Object.entries(members)) {
        commitments[i] = (await get(url, "/dkg/transcript", token)).commitments;
      }
      return { pk: unpt(statuses[Object.keys(statuses)[0]].pk), commitments, n: Object.keys(members).length, t, reused: true };
    }
  }
  return runDKG(members, t, token);
}

export async function runDKG(members, t, token) {
  const n = Object.keys(members).length;
  const hashes = {};
  for (const [i, url] of Object.entries(members)) {
    hashes[i] = (await post(url, "/dkg/commit", { n, t }, token)).hash;
  }
  const all = {};
  for (const [i, url] of Object.entries(members)) {
    const { commitments } = await post(url, "/dkg/reveal", {}, token);
    const h = createHash("sha256").update(JSON.stringify(commitments)).digest("hex");
    if (h !== hashes[i]) throw new Error(`member ${i} revealed commitments that do not match its commit hash`);
    all[i] = commitments;
  }
  for (const url of Object.values(members)) await post(url, "/dkg/commitments", { all }, token);
  for (const url of Object.values(members)) await post(url, "/dkg/distribute", { peers: members }, token);

  let pk = null;
  for (const [i, url] of Object.entries(members)) {
    let st;
    for (let k = 0; k < 20; k++) {
      st = await get(url, "/dkg/status", token);
      if (st.ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!st.ready) throw new Error(`member ${i} never became ready`);
    if (pk === null) pk = st.pk;
    else if (JSON.stringify(pk) !== JSON.stringify(st.pk)) throw new Error(`member ${i} computed a different pk`);
  }
  return { pk: unpt(pk), commitments: all, n, t };
}

export async function collectPartials(quorum, dkg, cipher, token) {
  const c1 = [cipher.c1[0].toString(), cipher.c1[1].toString()];
  const partials = [];
  const raw = [];
  for (const [i, url] of Object.entries(quorum)) {
    const p = await post(url, "/partial", { c1 }, token);
    const partial = {
      i: BigInt(p.i),
      d: unpt(p.d),
      proof: { a1: unpt(p.proof.a1), a2: unpt(p.proof.a2), z: BigInt(p.proof.z) },
    };
    const allCms = Object.values(dkg.commitments).map((cms) => cms.map(unpt));
    const y = memberVerifyKey(allCms, partial.i);
    if (!verifyPartial(y, cipher.c1, partial)) {
      throw new Error(`member ${i} returned an INVALID partial decryption - excluded`);
    }
    partials.push({ i: partial.i, d: partial.d });
    raw.push(p);
  }
  return { net: thresholdDecrypt(cipher, partials), partials: raw };
}

export async function decryptNet(quorum, dkg, cipher, token) {
  const { net } = await collectPartials(quorum, dkg, cipher, token);
  return net;
}

export async function attestEntry(url, payload, token) {
  return post(url, "/attest", payload, token);
}
