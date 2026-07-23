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
const QUANTITIES = [3n, 4n, 2n, 1n, 5n, 2n, 4n, 3n];
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
let aggregateYesC1 = IDENTITY;
let aggregateYesC2 = IDENTITY;
let aggregateNoC1 = IDENTITY;
let aggregateNoC2 = IDENTITY;
const yesAmount = [];
const noAmount = [];

for (let index = 0; index < 8; index++) {
  const sequence = FIRST_SEQUENCE + BigInt(index);
  const action = [101n + BigInt(index), 201n + BigInt(index)];
  const position = 1_001n + BigInt(index);
  const yesRandomness = 301n + BigInt(index);
  const noRandomness = 401n + BigInt(index);
  const yesC1 = multiplyPoint(BASE8, yesRandomness);
  const yesShared = multiplyPoint(COMMITTEE_KEY, 8n * yesRandomness);
  const yesQuantity = SIDES[index] === 1n ? QUANTITIES[index] : 0n;
  const yesC2 = addPoints(yesShared, multiplyPoint(BASE8, yesQuantity));
  const noC1 = multiplyPoint(BASE8, noRandomness);
  const noShared = multiplyPoint(COMMITTEE_KEY, 8n * noRandomness);
  const noQuantity = SIDES[index] === 0n ? QUANTITIES[index] : 0n;
  const noC2 = addPoints(noShared, multiplyPoint(BASE8, noQuantity));
  const encrypted = [...yesC1, ...yesC2, ...noC1, ...noC2];
  yesAmount.push(yesQuantity);
  noAmount.push(noQuantity);

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
      (SIDES[index] === 1n ? YES_CHARGE : NO_CHARGE) * QUANTITIES[index],
      FEE * QUANTITIES[index],
      PAYOUT * QUANTITIES[index],
    ]),
  );
  includedLeaves.push(
    poseidon2Hash([1013n, ...MARKET, EPOCH, sequence, position]),
  );
  aggregateYesC1 = addPoints(aggregateYesC1, yesC1);
  aggregateYesC2 = addPoints(aggregateYesC2, yesC2);
  aggregateNoC1 = addPoints(aggregateNoC1, noC1);
  aggregateNoC2 = addPoints(aggregateNoC2, noC2);
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
  aggregateCiphertext: [
    ...aggregateYesC1,
    ...aggregateYesC2,
    ...aggregateNoC1,
    ...aggregateNoC2,
  ],
  decryptionProofHash: [7n, 8n],
  committeeStatementHash: [9n, 10n],
  allocationRoot: fixedTree(allocationLeaves),
  includedRoot: fixedTree(includedLeaves),
  lotSize: SCALE,
  quote: [
    0n,
    24n,
    14n,
    10n,
    SCALE / 2n,
    SCALE / 2n,
    SCALE / 2n,
    SCALE / 2n,
    120_000_000n,
    70_000_000n,
    50_000_000n,
    YES_CHARGE,
    NO_CHARGE,
    0n,
    FEE,
    2_400_000n,
    1_200_000n,
    1_200_000n,
  ],
  committeeSecret: COMMITTEE_SECRET,
  actionId,
  positionCommitment,
  ciphertext,
  yesAmount,
  noAmount,
};

writeFileSync(new URL("batch.json", import.meta.url), `${decimalJson(fixture)}\n`);
