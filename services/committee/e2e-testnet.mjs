import { createHash } from "crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CIRC = resolve(REPO, "contracts/shielded-pool/circuits");
const SNARKJS = resolve(REPO, "circuits/node_modules/.bin/snarkjs");
const serviceUrl = process.env.COMMITTEE_URL || "https://moros-market.duckdns.org";
const marketId = process.env.MARKET_ID;
const poolId = process.env.POOL_ID;
const orders = JSON.parse(process.env.ORDERS_JSON || "[]");
const placeOrders = process.env.PLACE_ORDERS === "1";
const placeStartIndex = Number(process.env.PLACE_START_INDEX || 0);
const source = process.env.SOURCE || "deployer";

if (!poolId || orders.length < 2 || orders.length > 4) {
  throw new Error("Set POOL_ID and ORDERS_JSON with 2 to 4 already placed orders");
}
if (placeOrders && !marketId) throw new Error("MARKET_ID is required when PLACE_ORDERS=1");

function run(bin, args) {
  const result = spawnSync(bin, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${bin} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function invoke(contractId, method, args = []) {
  return run("stellar", ["contract", "invoke", "--id", contractId, "--source", source, "--network", "testnet", "--", method, ...args]);
}

function scalar(label) {
  const modulus = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
  return (BigInt(`0x${createHash("sha256").update(label).digest("hex")}`) % modulus).toString();
}

const work = mkdtempSync(resolve(tmpdir(), "moros-testnet-e2e-"));
try {
  if (marketId) {
    const registration = await fetch(`${serviceUrl}/register-pool`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId, poolId }),
    });
    if (!registration.ok) throw new Error(`pool registration failed: ${await registration.text()}`);
  }
  const { pk } = await (await fetch(`${serviceUrl}/pk`)).json();
  const sourceAddress = placeOrders ? run("stellar", ["keys", "address", source]).trim() : "";

  for (const [index, order] of orders.entries()) {
    const commitInputPath = resolve(work, `commit-input-${index}.json`);
    const commitWitnessPath = resolve(work, `commit-witness-${index}.wtns`);
    const commitWitnessJsonPath = resolve(work, `commit-witness-${index}.json`);
    writeFileSync(commitInputPath, JSON.stringify({ amount: order.amount, side: order.side, secret: order.secret, nullifier: order.nullifier }));
    run("node", [resolve(CIRC, "build/order_commit_js/generate_witness.js"), resolve(CIRC, "build/order_commit_js/order_commit.wasm"), commitInputPath, commitWitnessPath]);
    run(SNARKJS, ["wtns", "export", "json", commitWitnessPath, commitWitnessJsonPath]);
    const commitment = JSON.parse(readFileSync(commitWitnessJsonPath, "utf8"))[1];
    if (placeOrders && index >= placeStartIndex) {
      const stakeAmount = BigInt(order.stakeAmount ?? order.amount);
      invoke(poolId, "place_order", [
        "--from", sourceAddress,
        "--commitment", BigInt(commitment).toString(16).padStart(64, "0"),
        "--stake", (stakeAmount * 10_000_000n).toString(),
      ]);
      console.log(`placed order ${index + 1} of ${orders.length}`);
    }
    const membershipResponse = await fetch(`${serviceUrl}/proof/${commitment}?poolId=${poolId}`);
    if (!membershipResponse.ok) throw new Error(`order ${index} is not indexed on the registered pool`);
    const membership = await membershipResponse.json();
    if (membership.poolId !== poolId) throw new Error(`order ${index} belongs to a different pool`);
    const input = {
      orderRoot: membership.orderRoot,
      amount: order.amount,
      side: order.side,
      secret: order.secret,
      nullifier: order.nullifier,
      ryes: scalar(`yes-${order.nullifier}`),
      rno: scalar(`no-${order.nullifier}`),
      pk,
      pathIndex: membership.pathIndex,
      siblings: membership.siblings,
    };
    const inputPath = resolve(work, `input-${index}.json`);
    const witnessPath = resolve(work, `witness-${index}.wtns`);
    const proofPath = resolve(work, `proof-${index}.json`);
    const publicPath = resolve(work, `public-${index}.json`);
    writeFileSync(inputPath, JSON.stringify(input));
    run("node", [resolve(CIRC, "build/encrypt_order_js/generate_witness.js"), resolve(CIRC, "build/encrypt_order_js/encrypt_order.wasm"), inputPath, witnessPath]);
    run(SNARKJS, ["groth16", "prove", resolve(CIRC, "build/encrypt_order_final.zkey"), witnessPath, proofPath, publicPath]);
    run(SNARKJS, ["groth16", "verify", resolve(CIRC, "build/encrypt_order_vk.json"), publicPath, proofPath]);
    const publicSignals = JSON.parse(readFileSync(publicPath, "utf8"));
    if (publicSignals[0] !== commitment) throw new Error(`order ${index} commitment changed between proofs`);
    const response = await fetch(`${serviceUrl}/order`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        poolId,
        proof: JSON.parse(readFileSync(proofPath, "utf8")),
        publicSignals,
      }),
    });
    if (!response.ok) throw new Error(`order ${index} rejected: ${await response.text()}`);
    console.log(`queued order ${index + 1} of ${orders.length}`);
  }
  console.log(`queued ${orders.length} encrypted orders for pool ${poolId}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
