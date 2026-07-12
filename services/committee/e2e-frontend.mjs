import { spawnSync } from "child_process";
import { randomBytes } from "crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { dealerSetup, addCiphers, partialDecrypt, thresholdDecrypt, randScalar } from "./jubjub.mjs";
import { createIndexer } from "../indexer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CIRC = resolve(REPO, "contracts/shielded-pool/circuits");
const FORK = resolve(REPO, "inspiration/zk/soroban-privacy-pools");
const ORDER_TREE = resolve(FORK, "target/release/order_tree");
const SNARKJS = resolve(REPO, "circuits/node_modules/.bin/snarkjs");
const [MARKET, POOL] = readFileSync("/tmp/fresh_ids.txt", "utf8").trim().split(/\s+/);
const RPC = "https://soroban-testnet.stellar.org";
const NET = "testnet";
const DEC_ATOMIC = 10000000n;

function sh(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} ${args[0]} failed: ${(r.stderr || r.stdout).slice(-500)}`);
  return r.stdout;
}
const hex32 = (dec) => BigInt(dec).toString(16).padStart(64, "0");

console.log("[1] committee key (dealer) + order");
const committee = dealerSetup(3, 2);
const pkDec = [committee.pk[0].toString(), committee.pk[1].toString()];
const rnd = () => BigInt("0x" + randomBytes(30).toString("hex")).toString();
const order = { amount: "7", side: "1", secret: rnd(), nullifier: rnd() };

console.log("[2] compute commitment (order_tree tool)");
const work = mkdtempSync(resolve(tmpdir(), "e2ef-"));
writeFileSync(resolve(work, "o.json"), JSON.stringify([order]));
const tree = JSON.parse(sh(ORDER_TREE, [resolve(work, "o.json"), "16"]));
const commitmentDec = tree.orders[0].commitment;
console.log("    commitment", commitmentDec.slice(0, 16) + "...");

console.log("[3] place_order on-chain (fresh pool with OrderPlaced event)");
sh("stellar", ["contract", "invoke", "--id", POOL, "--source", "deployer", "--network", NET, "--",
  "place_order", "--from", sh("stellar", ["keys", "address", "deployer"]).trim(),
  "--commitment", hex32(commitmentDec), "--stake", (BigInt(order.amount) * DEC_ATOMIC).toString()]);
const onchainRoot = sh("stellar", ["contract", "invoke", "--id", POOL, "--source", "deployer", "--network", NET, "--", "get_order_root"]).trim().replace(/"/g, "");
console.log("    placed; on-chain order root", onchainRoot.slice(0, 12) + "...");

console.log("[4] indexer reads OrderPlaced + serves the membership proof");
const indexer = createIndexer({ rpcUrl: RPC, poolId: POOL });
let proof = null;
for (let k = 0; k < 20; k++) {
  await indexer.poll();
  proof = indexer.proofFor(commitmentDec);
  if (proof) break;
  await new Promise((r) => setTimeout(r, 3000));
}
if (!proof) { console.error("FAIL: indexer never served a proof for the placed commitment"); process.exit(1); }
if (BigInt(proof.orderRoot) !== BigInt("0x" + onchainRoot)) {
  console.error("FAIL: indexer orderRoot != on-chain order root", proof.orderRoot, BigInt("0x" + onchainRoot).toString());
  process.exit(1);
}
console.log("    indexer proof: pathIndex", proof.pathIndex, "siblings", proof.siblings.length, "root matches on-chain");

console.log("[5] prove encrypt_order in-browser-equivalent with the REAL indexer siblings");
const inp = { orderRoot: proof.orderRoot, ...order, ryes: randScalar().toString(), rno: randScalar().toString(), pk: pkDec, pathIndex: proof.pathIndex, siblings: proof.siblings };
writeFileSync(resolve(work, "in.json"), JSON.stringify(inp));
sh("node", [resolve(CIRC, "build/encrypt_order_js/generate_witness.js"), resolve(CIRC, "build/encrypt_order_js/encrypt_order.wasm"), resolve(work, "in.json"), resolve(work, "w.wtns")]);
sh(SNARKJS, ["groth16", "prove", resolve(CIRC, "build/encrypt_order_final.zkey"), resolve(work, "w.wtns"), resolve(work, "p.json"), resolve(work, "pub.json")]);
const ok = sh(SNARKJS, ["groth16", "verify", resolve(CIRC, "build/encrypt_order_vk.json"), resolve(work, "pub.json"), resolve(work, "p.json")]);
if (!/OK/.test(ok)) { console.error("FAIL: proof did not verify"); process.exit(1); }
const pub = JSON.parse(readFileSync(resolve(work, "pub.json"), "utf8"));
if (pub[0] !== commitmentDec) { console.error("FAIL: proof commitment != placed commitment"); process.exit(1); }
if (pub[10] !== proof.orderRoot) { console.error("FAIL: proof orderRoot != indexer root"); process.exit(1); }

console.log("[6] committee decrypts the ciphertext to the order amount");
const cyes = { c1: [BigInt(pub[2]), BigInt(pub[3])], c2: [BigInt(pub[4]), BigInt(pub[5])] };
const net = addCiphers([cyes]);
const quorum = [committee.shares[0], committee.shares[2]];
const dq = thresholdDecrypt(net, quorum.map((s) => partialDecrypt(s, net)));
rmSync(work, { recursive: true, force: true });
if (dq !== BigInt(order.amount)) { console.error("FAIL: committee net != amount", dq, order.amount); process.exit(1); }
console.log("    committee decrypted YES net =", dq, "(expected", order.amount + ")");
console.log("PASS: place_order -> OrderPlaced event -> indexer membership proof -> encrypt_order proof verifies, commitment+root match on-chain, committee-decryptable. Full private-bet chain validated.");
process.exit(0);
