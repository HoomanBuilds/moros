import { writeFileSync } from "node:fs";
import {
  addPoints,
  decimalJson,
  merkleNode,
  multiplyPoint,
  poseidon2Hash,
} from "./privacy-fixture-lib.mjs";

const BASE8 = [
  5299619240641551281634865583518297030282874472190772894086521144482721001553n,
  16950150798460657717958625567821834550301663161624707787222815936182638968203n,
];
const IDENTITY = [0n, 1n];
const SCALE = 1n << 32n;
const MARKET = [20n, 21n];
const EPOCH = 3n;
const FIRST_SEQUENCE = 41n;
const COMMITTEE_EPOCH = 2n;
const COMMITTEE_SECRET = 12_345n;
const COMMITTEE_KEY = multiplyPoint(BASE8, COMMITTEE_SECRET);
const SIDES = [1n, 0n, 1n, 0n, 1n, 0n, 1n, 0n];
const YES_CHARGE = 5_000_000n;
const NO_CHARGE = 5_000_000n;
const FEE = 100_000n;
const PAYOUT = 10_000_000n;

function fixedTree(firstLeaves) {
  let nodes = [...firstLeaves, ...Array(64 - firstLeaves.length).fill(0n)];
  while (nodes.length > 1) {
    const next = [];
    for (let index = 0; index < nodes.length; index += 2) {
      next.push(merkleNode(nodes[index], nodes[index + 1]));
    }
    nodes = next;
  }
  return nodes[0];
}

const actionId = [];
const positionCommitment = [];
const ciphertext = [];
const acceptedLeaves = [];
const allocationLeaves = [];
const includedLeaves = [];
let aggregateC1 = IDENTITY;
let aggregateC2 = IDENTITY;

for (let index = 0; index < 8; index++) {
  const sequence = FIRST_SEQUENCE + BigInt(index);
  const action = [101n + BigInt(index), 201n + BigInt(index)];
  const position = 1_001n + BigInt(index);
  const randomness = 301n + BigInt(index);
  const c1 = multiplyPoint(BASE8, randomness);
  const shared = multiplyPoint(COMMITTEE_KEY, 8n * randomness);
  const message = SIDES[index] === 1n ? BASE8 : IDENTITY;
  const c2 = addPoints(shared, message);
  const encrypted = [...c1, ...c2];

  actionId.push(action);
  positionCommitment.push(position);
  ciphertext.push(encrypted);
  acceptedLeaves.push(
    poseidon2Hash([
      1009n,
      ...MARKET,
      EPOCH,
      sequence,
      ...action,
      position,
      ...encrypted,
      COMMITTEE_EPOCH,
    ]),
  );
  allocationLeaves.push(
    poseidon2Hash([
      1012n,
      ...MARKET,
      EPOCH,
      sequence,
      position,
      SIDES[index],
      SIDES[index] === 1n ? YES_CHARGE : NO_CHARGE,
      FEE,
      PAYOUT,
    ]),
  );
  includedLeaves.push(
    poseidon2Hash([1013n, ...MARKET, EPOCH, sequence, position]),
  );
  aggregateC1 = addPoints(aggregateC1, c1);
  aggregateC2 = addPoints(aggregateC2, c2);
}

const fixture = {
  networkDomain: [1n, 2n],
  vault: [3n, 4n],
  market: MARKET,
  epoch: EPOCH,
  acceptedRoot: fixedTree(acceptedLeaves),
  acceptedCount: 8n,
  firstSequence: FIRST_SEQUENCE,
  lastSequence: FIRST_SEQUENCE + 7n,
  committeeEpoch: COMMITTEE_EPOCH,
  committeeConfigHash: [5n, 6n],
  committeePublicKey: COMMITTEE_KEY,
  aggregateCiphertext: [...aggregateC1, ...aggregateC2],
  decryptionProofHash: [7n, 8n],
  committeeStatementHash: [9n, 10n],
  allocationRoot: fixedTree(allocationLeaves),
  includedRoot: fixedTree(includedLeaves),
  lotSize: SCALE,
  quote: [
    0n,
    8n,
    4n,
    4n,
    SCALE / 2n,
    SCALE / 2n,
    SCALE / 2n,
    SCALE / 2n,
    40_000_000n,
    20_000_000n,
    20_000_000n,
    YES_CHARGE,
    NO_CHARGE,
    0n,
    FEE,
    800_000n,
    400_000n,
    400_000n,
  ],
  committeeSecret: COMMITTEE_SECRET,
  actionId,
  positionCommitment,
  ciphertext,
};

writeFileSync(new URL("batch.json", import.meta.url), `${decimalJson(fixture)}\n`);
