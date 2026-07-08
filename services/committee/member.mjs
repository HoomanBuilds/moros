import { createServer } from "http";
import { timingSafeEqual } from "crypto";
import { G8, ID, R, add, mul, randScalar } from "./jubjub.mjs";
import { feldmanCheck } from "./dkg-jubjub.mjs";
import { provePartial } from "./chaum-pedersen.mjs";

const PORT = Number(process.env.PORT || 9711);
const INDEX = BigInt(process.env.INDEX || 1);
const TOKEN = process.env.MEMBER_TOKEN || "";

const pt = (p) => [p[0].toString(), p[1].toString()];
const unpt = (a) => [BigInt(a[0]), BigInt(a[1])];

let roster = null;
let coeffs = null;
let myCommitments = null;
let allCommitments = null;
let received = new Map();
let finalShare = null;
let pk = null;

function evalPoly(x) {
  let y = 0n, xp = 1n;
  for (const c of coeffs) {
    y = (y + c * xp) % R;
    xp = (xp * x) % R;
  }
  return y;
}

function tryFinalize() {
  if (!roster || !allCommitments || received.size < roster.n) return;
  let s = 0n;
  for (let i = 1; i <= roster.n; i++) s = (s + received.get(i)) % R;
  finalShare = { i: INDEX, s };
  pk = ID;
  for (let i = 1; i <= roster.n; i++) pk = add(pk, unpt(allCommitments[i][0]));
}

function authed(req) {
  if (!TOKEN) return true;
  const h = req.headers.authorization || "";
  const want = `Bearer ${TOKEN}`;
  return h.length === want.length && timingSafeEqual(Buffer.from(h), Buffer.from(want));
}

function body(req) {
  return new Promise((res, rej) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1 << 20) rej(new Error("too large"));
    });
    req.on("end", () => res(data ? JSON.parse(data) : {}));
    req.on("error", rej);
  });
}

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true, index: INDEX.toString() });
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });

    if (req.method === "POST" && req.url === "/dkg/init") {
      const { n, t } = await body(req);
      roster = { n, t };
      coeffs = Array.from({ length: t }, () => randScalar());
      myCommitments = coeffs.map((c) => pt(mul(G8, c)));
      received = new Map();
      allCommitments = null;
      finalShare = null;
      pk = null;
      return send(res, 200, { index: INDEX.toString(), commitments: myCommitments });
    }

    if (req.method === "POST" && req.url === "/dkg/commitments") {
      const { all } = await body(req);
      allCommitments = {};
      for (const [i, cms] of Object.entries(all)) allCommitments[Number(i)] = cms;
      if (JSON.stringify(allCommitments[Number(INDEX)]) !== JSON.stringify(myCommitments)) {
        return send(res, 400, { error: "coordinator altered my commitments" });
      }
      received.set(Number(INDEX), evalPoly(INDEX));
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && req.url === "/dkg/distribute") {
      const { peers } = await body(req);
      for (const [i, url] of Object.entries(peers)) {
        if (BigInt(i) === INDEX) continue;
        const share = evalPoly(BigInt(i));
        const r = await fetch(`${url}/dkg/share`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
          body: JSON.stringify({ from: Number(INDEX), share: share.toString() }),
        });
        if (!r.ok) return send(res, 502, { error: `peer ${i} rejected share` });
      }
      tryFinalize();
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && req.url === "/dkg/share") {
      const { from, share } = await body(req);
      if (!allCommitments || !allCommitments[from]) return send(res, 409, { error: "commitments not set" });
      const s = BigInt(share);
      if (!feldmanCheck(allCommitments[from].map(unpt), INDEX, s)) {
        return send(res, 400, { error: `invalid share from member ${from}` });
      }
      received.set(from, s);
      tryFinalize();
      return send(res, 200, { ok: true });
    }

    if (req.method === "GET" && req.url === "/dkg/status") {
      return send(res, 200, { ready: !!finalShare, pk: pk ? pt(pk) : null });
    }

    if (req.method === "POST" && req.url === "/partial") {
      if (!finalShare) return send(res, 409, { error: "dkg not complete" });
      const { c1 } = await body(req);
      const p = provePartial(finalShare, unpt(c1));
      return send(res, 200, {
        i: p.i.toString(),
        d: pt(p.d),
        proof: { a1: pt(p.proof.a1), a2: pt(p.proof.a2), z: p.proof.z.toString() },
      });
    }

    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`[member ${INDEX}] listening on ${PORT}${TOKEN ? " (token auth)" : ""}`);
});
