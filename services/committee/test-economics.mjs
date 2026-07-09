import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CIRC = resolve(REPO, "contracts/shielded-pool/circuits");
const SNARKJS = resolve(REPO, "circuits/node_modules/.bin/snarkjs");
const ORDER_TREE = resolve(REPO, "inspiration/zk/soroban-privacy-pools/target/release/order_tree");
const SCALE = 4294967296n;

function sh(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} failed: ${(r.stderr || r.stdout).slice(-400)}`);
  return r.stdout;
}
function recip(g) {
  return BigInt("0x" + createHash("sha256").update(g).digest("hex")) % SCALE;
}

const orders = [
  { amount: "10", side: "1", secret: "100", nullifier: "101" },
  { amount: "20", side: "1", secret: "102", nullifier: "103" },
  { amount: "5", side: "0", secret: "104", nullifier: "105" },
  { amount: "15", side: "0", secret: "106", nullifier: "107" },
];

const work = mkdtempSync(resolve(tmpdir(), "econ-"));
const ordersPath = resolve(work, "o.json");
writeFileSync(ordersPath, JSON.stringify(orders));
const tree = JSON.parse(sh(ORDER_TREE, [ordersPath, "16"]));

const pYes = 2254768441n;
const winningOutcome = 1n;
const fee = 1000000n;

function expected(o) {
  const amount = BigInt(o.amount);
  const side = BigInt(o.side);
  const pSide = side === 1n ? pYes : SCALE - pYes;
  const win = side === winningOutcome ? 1n : 0n;
  const entitlement = amount * (SCALE - pSide) + win * amount * SCALE;
  return entitlement - fee;
}

let poolIn = 0n;
for (const o of orders) poolIn += BigInt(o.amount) * SCALE;
let poolOut = 0n;

try {
  for (const [k, o] of orders.entries()) {
    const leaf = tree.orders[k];
    const input = {
      orderRoot: tree.orderRoot,
      recipient: recip(`recipient-${k}`).toString(),
      winningOutcome: winningOutcome.toString(),
      priceYes: pYes.toString(),
      fee: fee.toString(),
      amount: o.amount,
      side: o.side,
      secret: o.secret,
      nullifier: o.nullifier,
      pathIndex: leaf.pathIndex,
      siblings: leaf.siblings,
    };
    const inPath = resolve(work, `in${k}.json`);
    writeFileSync(inPath, JSON.stringify(input));
    sh("node", [resolve(CIRC, "build/order_redeem_v2_js/generate_witness.js"), resolve(CIRC, "build/order_redeem_v2_js/order_redeem_v2.wasm"), inPath, resolve(work, `w${k}.wtns`)]);
    sh(SNARKJS, ["groth16", "prove", resolve(CIRC, "output/order_redeem_v2_final.zkey"), resolve(work, `w${k}.wtns`), resolve(work, `p${k}.json`), resolve(work, `pub${k}.json`)]);
    sh(SNARKJS, ["groth16", "verify", resolve(CIRC, "build/order_redeem_v2_vk.json"), resolve(work, `pub${k}.json`), resolve(work, `p${k}.json`)]);
    const pub = JSON.parse(readFileSync(resolve(work, `pub${k}.json`), "utf8"));
    if (pub[0] !== leaf.nullifierHash) throw new Error(`order ${k}: nullifierHash mismatch`);
    const payout = BigInt(pub[1]);
    const exp = expected(o);
    const kind = BigInt(o.side) === winningOutcome ? "WIN " : "LOSE";
    console.log(`order ${k} ${kind} amount=${o.amount}: payout_fp=${payout} (expected ${exp}) ${payout === exp ? "OK" : "FAIL"}`);
    if (payout !== exp) throw new Error("payout mismatch");
    poolOut += payout + fee;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const b = 100n * SCALE;
function costFp(qy, qn) {
  const x = Math.exp(Number(qy) / Number(SCALE) / 100) + Math.exp(Number(qn) / Number(SCALE) / 100);
  return BigInt(Math.round(Math.log(x) * 100 * Number(SCALE)));
}
const net = costFp(30n * SCALE, 20n * SCALE) - costFp(0n, 0n);
const winningRedeemed = 30n * SCALE;
const poolBalance = poolIn + winningRedeemed - net - poolOut;
console.log(`\nsolvency (fp): stakes_in=${poolIn} + winning_shares_redeemed=${winningRedeemed} - net_to_market=${net} - payouts_out=${poolOut}`);
console.log(`pool residual = ${poolBalance} (>= 0 required; small positive = protocol margin)`);
if (poolBalance < 0n) { console.error("INSOLVENT"); process.exit(1); }
console.log("PASS: LMSR share payouts (refund + winnings - fee), winners profit, losers refunded, pool solvent.");
