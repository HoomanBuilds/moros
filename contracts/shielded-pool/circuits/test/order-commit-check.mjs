import { spawnSync } from "child_process";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";

const REPO = resolve(process.cwd(), "../../..");
const ORDER_TREE = resolve(REPO, "inspiration/zk/soroban-privacy-pools/target/release/order_tree");
const snarkjs = await import(resolve(REPO, "circuits/node_modules/snarkjs/main.js")).catch(() => import("snarkjs"));

const order = { amount: "10", side: "1", secret: "100", nullifier: "101" };
const work = mkdtempSync(resolve(tmpdir(), "oc-"));
writeFileSync(resolve(work, "o.json"), JSON.stringify([order]));

const tree = JSON.parse(spawnSync(ORDER_TREE, [resolve(work, "o.json"), "16"], { encoding: "utf8" }).stdout);
const expectedCommit = tree.orders[0].commitment;
const expectedNull = tree.orders[0].nullifierHash;

const wtnsPath = resolve(work, "w.wtns");
await snarkjs.wtns.calculate(order, resolve(process.cwd(), "build/order_commit_js/order_commit.wasm"), wtnsPath);
const w = await snarkjs.wtns.exportJson(wtnsPath);
const commit = w[1].toString();
const nh = w[2].toString();

if (commit !== expectedCommit) { console.error("commitment mismatch", commit, expectedCommit); process.exit(1); }
if (nh !== expectedNull) { console.error("nullifierHash mismatch", nh, expectedNull); process.exit(1); }
console.log("order_commit wasm matches on-chain OrderCommit: commitment + nullifierHash OK");
