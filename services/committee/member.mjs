import { createServer } from "http";
import { timingSafeEqual, createHash } from "crypto";
import { writeFileSync, readFileSync, existsSync, renameSync } from "fs";
import { Address, Keypair, Networks, authorizeEntry, scValToNative, xdr } from "@stellar/stellar-sdk";
import { G8, ID, R, add, mul, randScalar, thresholdDecrypt } from "./jubjub.mjs";
import { feldmanCheck, memberVerifyKey } from "./dkg-jubjub.mjs";
import { provePartial, verifyPartial } from "./chaum-pedersen.mjs";

const PORT = Number(process.env.PORT || 9711);
const INDEX = BigInt(process.env.INDEX || 1);
const TOKEN = process.env.MEMBER_TOKEN || "";
const TARGET = process.env.ATTEST_TARGET || process.env.MARKET || "";
const TARGETS = new Set((process.env.ATTEST_TARGETS || TARGET).split(",").map((s) => s.trim()).filter(Boolean));
const ATTEST_ANY = process.env.ATTEST_ANY === "1";
const METHOD = process.env.ATTEST_METHOD || "apply_batch_committee";
const DQ_OFFSET = Number(process.env.ATTEST_DQ_OFFSET || 2);
const NET_BOUND = Number(process.env.NET_BOUND || 4294967296);
const S = 1n << 32n;
const kp = process.env.MEMBER_SK ? Keypair.fromSecret(process.env.MEMBER_SK) : null;
const SHARE_FILE = process.env.SHARE_FILE || "";

const pt = (p) => [p[0].toString(), p[1].toString()];
const unpt = (a) => [BigInt(a[0]), BigInt(a[1])];

let roster = null;
let coeffs = null;
let myCommitments = null;
let allCommitments = null;
let received = new Map();
let finalShare = null;
let pk = null;

function persist() {
  if (!SHARE_FILE || !finalShare) return;
  const data = {
    index: INDEX.toString(),
    share: finalShare.s.toString(),
    pk: pt(pk),
    roster,
    commitments: allCommitments,
  };
  const tmp = `${SHARE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  renameSync(tmp, SHARE_FILE);
}

function restore() {
  if (!SHARE_FILE || !existsSync(SHARE_FILE)) return;
  const d = JSON.parse(readFileSync(SHARE_FILE, "utf8"));
  if (BigInt(d.index) !== INDEX) return;
  finalShare = { i: INDEX, s: BigInt(d.share) };
  pk = unpt(d.pk);
  roster = d.roster;
  allCommitments = {};
  for (const [i, cms] of Object.entries(d.commitments)) allCommitments[Number(i)] = cms;
  console.log(`[member ${INDEX}] restored persisted share; DKG epoch resumed`);
}

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
  persist();
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
    if (req.method === "GET" && req.url === "/health") {
      return send(res, 200, { ok: true, index: INDEX.toString(), address: kp ? kp.publicKey() : null });
    }
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });

    if (req.method === "POST" && req.url === "/dkg/commit") {
      if (finalShare && SHARE_FILE) {
        return send(res, 409, { error: "member already has a persisted key; refuse to re-key" });
      }
      const { n, t } = await body(req);
      roster = { n, t };
      coeffs = Array.from({ length: t }, () => randScalar());
      myCommitments = coeffs.map((c) => pt(mul(G8, c)));
      received = new Map();
      allCommitments = null;
      finalShare = null;
      pk = null;
      const hash = createHash("sha256").update(JSON.stringify(myCommitments)).digest("hex");
      return send(res, 200, { index: INDEX.toString(), hash });
    }

    if (req.method === "POST" && req.url === "/dkg/reveal") {
      if (!myCommitments) return send(res, 409, { error: "not in commit phase" });
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

    if (req.method === "GET" && req.url === "/dkg/transcript") {
      if (!allCommitments) return send(res, 409, { error: "no transcript" });
      return send(res, 200, { commitments: allCommitments[Number(INDEX)] });
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

    if (req.method === "POST" && req.url === "/attest") {
      if (!finalShare) return send(res, 409, { error: "dkg not complete" });
      if (!kp || (TARGETS.size === 0 && !ATTEST_ANY)) return send(res, 409, { error: "MEMBER_SK or ATTEST_TARGET not configured" });
      const { entryXdr, validUntilLedger, cipherYes, cipherNo, partialsYes, partialsNo, dqyes, dqno } = await body(req);

      const allCms = [];
      for (let i = 1; i <= roster.n; i++) allCms.push(allCommitments[i].map(unpt));
      const verifyNet = (cipherRaw, partialsRaw, expect) => {
        const cipher = { c1: unpt(cipherRaw.c1), c2: unpt(cipherRaw.c2) };
        const partials = [];
        for (const p of partialsRaw) {
          const partial = {
            i: BigInt(p.i),
            d: unpt(p.d),
            proof: { a1: unpt(p.proof.a1), a2: unpt(p.proof.a2), z: BigInt(p.proof.z) },
          };
          if (!verifyPartial(memberVerifyKey(allCms, partial.i), cipher.c1, partial)) return false;
          partials.push({ i: partial.i, d: partial.d });
        }
        return thresholdDecrypt(cipher, partials, NET_BOUND) === BigInt(expect);
      };
      if (!verifyNet(cipherYes, partialsYes, dqyes)) return send(res, 400, { error: "dqyes does not match verified decryption" });
      if (!verifyNet(cipherNo, partialsNo, dqno)) return send(res, 400, { error: "dqno does not match verified decryption" });

      const entry = xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, "base64");
      const fn = entry.rootInvocation().function();
      if (fn.switch() !== xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn()) {
        return send(res, 400, { error: "not a contract invocation" });
      }
      const inv = fn.contractFn();
      const entryTarget = Address.fromScAddress(inv.contractAddress()).toString();
      if (!ATTEST_ANY && !TARGETS.has(entryTarget)) {
        return send(res, 400, { error: "entry targets a contract not in this member's allowed set" });
      }
      if (inv.functionName().toString() !== METHOD) {
        return send(res, 400, { error: "entry calls a different function" });
      }
      const args = inv.args();
      if (scValToNative(args[DQ_OFFSET]) !== BigInt(dqyes) * S || scValToNative(args[DQ_OFFSET + 1]) !== BigInt(dqno) * S) {
        return send(res, 400, { error: "entry net does not match verified net" });
      }
      const cred = Address.fromScAddress(entry.credentials().address().address()).toString();
      if (cred !== kp.publicKey()) return send(res, 400, { error: "entry is not for this member" });

      const signed = await authorizeEntry(entry, kp, Number(validUntilLedger), Networks.TESTNET);
      console.log(`[member ${INDEX}] attested net (${dqyes}, ${dqno}) for ${entryTarget}`);
      return send(res, 200, { signedEntryXdr: signed.toXDR("base64") });
    }

    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

restore();
server.listen(PORT, () => {
  console.log(`[member ${INDEX}] listening on ${PORT}${TOKEN ? " (token auth)" : ""}${finalShare ? " (key restored)" : ""}`);
});
