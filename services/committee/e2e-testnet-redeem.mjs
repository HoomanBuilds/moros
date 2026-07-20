import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { Address, hash, xdr } from "@stellar/stellar-sdk";
import { relay } from "../relayer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CIRC = resolve(REPO, "contracts/shielded-pool/circuits");
const SNARKJS = resolve(REPO, "circuits/node_modules/.bin/snarkjs");
const serviceUrl = process.env.COMMITTEE_URL || "https://moros-market.duckdns.org";
const marketId = process.env.MARKET_ID;
const poolId = process.env.POOL_ID;
const tokenId = process.env.TOKEN_ID || "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const source = process.env.SOURCE || "deployer";
const orders = JSON.parse(process.env.ORDERS_JSON || "[]");
const recipients = (process.env.RECIPIENTS || "").split(",").filter(Boolean);

if (!marketId || !poolId || orders.length !== recipients.length || orders.length === 0) {
  throw new Error("Set MARKET_ID, POOL_ID, ORDERS_JSON, and one RECIPIENTS address per order");
}

function run(bin, args) {
  const result = spawnSync(bin, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${bin} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function invoke(contractId, method, args = []) {
  const output = run("stellar", ["contract", "invoke", "--id", contractId, "--source", source, "--network", "testnet", "--", method, ...args]);
  return output.trim().split("\n").at(-1);
}

function recipientField(address) {
  const value = xdr.ScVal.scvAddress(new Address(address).toScAddress());
  const bytes = Buffer.from(hash(value.toXDR()));
  bytes[0] &= 0x1f;
  return BigInt(`0x${bytes.toString("hex")}`).toString();
}

function balance(address) {
  return BigInt(invoke(tokenId, "balance", ["--id", address]).replaceAll('"', ""));
}

function commitmentFor(order, index, work) {
  const inputPath = resolve(work, `commit-input-${index}.json`);
  const witnessPath = resolve(work, `commit-witness-${index}.wtns`);
  const witnessJsonPath = resolve(work, `commit-witness-${index}.json`);
  writeFileSync(inputPath, JSON.stringify({ amount: order.amount, side: order.side, secret: order.secret, nullifier: order.nullifier }));
  run("node", [resolve(CIRC, "build/order_commit_js/generate_witness.js"), resolve(CIRC, "build/order_commit_js/order_commit.wasm"), inputPath, witnessPath]);
  run(SNARKJS, ["wtns", "export", "json", witnessPath, witnessJsonPath]);
  return JSON.parse(readFileSync(witnessJsonPath, "utf8"))[1];
}

const outcome = JSON.parse(invoke(marketId, "outcome"));
if (outcome !== "Yes" && outcome !== "No") throw new Error(`market is not redeemable: ${outcome}`);
const winningOutcome = outcome === "Yes" ? 1n : 0n;
const priceYes = BigInt(JSON.parse(invoke(poolId, "get_price")));
const [treasury, rawFeeBps] = JSON.parse(invoke(poolId, "fee_config"));
const feeBps = BigInt(rawFeeBps);
const scale = 1n << 32n;
const work = mkdtempSync(resolve(tmpdir(), "moros-testnet-redeem-"));

try {
  for (const [index, order] of orders.entries()) {
    const recipient = recipients[index];
    const commitment = commitmentFor(order, index, work);
    const membershipResponse = await fetch(`${serviceUrl}/proof/${commitment}?poolId=${poolId}`);
    if (!membershipResponse.ok) throw new Error(`order ${index} membership proof is unavailable`);
    const membership = await membershipResponse.json();
    if (membership.poolId !== poolId) throw new Error(`order ${index} belongs to a different pool`);

    const amount = BigInt(order.amount);
    const side = BigInt(order.side);
    const stakeAmount = BigInt(order.stakeAmount ?? order.amount);
    const sidePrice = side === 1n ? priceYes : scale - priceYes;
    const win = side === winningOutcome ? 1n : 0n;
    const fee = win * amount * (scale - sidePrice) * feeBps / 10_000n;
    const input = {
      orderRoot: membership.orderRoot,
      recipient: recipientField(recipient),
      winningOutcome: winningOutcome.toString(),
      priceYes: priceYes.toString(),
      fee: fee.toString(),
      feeBps: feeBps.toString(),
      stakeAmount: stakeAmount.toString(),
      amount: order.amount,
      side: order.side,
      secret: order.secret,
      nullifier: order.nullifier,
      pathIndex: membership.pathIndex,
      siblings: membership.siblings,
    };
    const inputPath = resolve(work, `redeem-input-${index}.json`);
    const witnessPath = resolve(work, `redeem-witness-${index}.wtns`);
    const proofPath = resolve(work, `redeem-proof-${index}.json`);
    const publicPath = resolve(work, `redeem-public-${index}.json`);
    writeFileSync(inputPath, JSON.stringify(input));
    run("node", [resolve(CIRC, "build/position_redeem_js/generate_witness.js"), resolve(CIRC, "build/position_redeem_js/position_redeem.wasm"), inputPath, witnessPath]);
    run(SNARKJS, ["groth16", "prove", resolve(CIRC, "output/position_redeem_final.zkey"), witnessPath, proofPath, publicPath]);
    run(SNARKJS, ["groth16", "verify", resolve(CIRC, "build/position_redeem_vk.json"), publicPath, proofPath]);
    const publicSignals = JSON.parse(readFileSync(publicPath, "utf8"));
    const payoutAtomic = BigInt(publicSignals[1]) * 10_000_000n / scale;
    const feeAtomic = fee * 10_000_000n / scale;
    const recipientBefore = balance(recipient);
    const treasuryBefore = balance(treasury);

    if (recipients.length > 1) {
      const wrongRecipient = recipients[(index + 1) % recipients.length];
      let rejected = false;
      try {
        relay(proofPath, publicPath, wrongRecipient, { poolId, source });
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error(`order ${index} proof was not bound to its recipient`);
    }

    const result = relay(proofPath, publicPath, recipient, { poolId, source });
    const recipientGain = balance(recipient) - recipientBefore;
    const treasuryGain = balance(treasury) - treasuryBefore;
    if (recipientGain !== payoutAtomic) throw new Error(`order ${index} payout mismatch: ${recipientGain} != ${payoutAtomic}`);
    if (treasuryGain !== feeAtomic) throw new Error(`order ${index} fee mismatch: ${treasuryGain} != ${feeAtomic}`);

    let replayRejected = false;
    try {
      relay(proofPath, publicPath, recipient, { poolId, source });
    } catch {
      replayRejected = true;
    }
    if (!replayRejected) throw new Error(`order ${index} redemption replay was accepted`);
    console.log(JSON.stringify({ index, side: order.side, won: win === 1n, payoutAtomic: payoutAtomic.toString(), feeAtomic: feeAtomic.toString(), txHash: result.txHash }));
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
