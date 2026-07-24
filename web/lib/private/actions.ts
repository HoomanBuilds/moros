"use client";

import { poseidon2Hash } from "@zkpassport/poseidon2";
import { unlockPositionBackup } from "@/lib/positions/backup";
import {
  getPrivateConfig,
  getPrivateAllocation,
  getPrivateLiquidityExits,
  getPrivateTree,
  registerPrivateLiquidityExit,
  type PrivateDeploymentConfig,
} from "./client";
import {
  readPrivateContract,
  relayPrivateContractCall,
  sendPrivateWalletCall,
} from "./contract";
import {
  addPoints,
  addressLimbs,
  appendFour,
  appendOne,
  appendPair,
  bytes32Limbs,
  createOutputNote,
  createOutputNoteForRecipient,
  decryptAllocationWitness,
  fieldsToEnvelope,
  hexToBytes,
  membershipPath,
  merkleTree,
  merkleNode,
  multiplyPoint,
  noteDomain,
  noteNullifier,
  operationContextFields,
  randomPrivateScalar,
  type OwnedPrivateNote,
  type PrivateOutput,
  type PrivateTree,
  type Point,
} from "./primitives";
import { provePrivateAction } from "./prover";
import { waitForPrivateBatch } from "./batch-window";
import {
  liquidPrivateTotal,
  selectConsolidationPair,
  selectSmallestSufficientNote,
} from "./note-selection";
import { nextPrivateOrderSequence } from "./order-sequence";
import { calculateExecutedPositionAmounts } from "./position-accounting";
import {
  openPrivateWallet,
  type OwnedIndexedNote,
  type PrivateWalletSnapshot,
} from "./wallet";

const MAX_NOTE_AMOUNT = (1n << 60n) - 1n;
const VIRTUAL_ASSETS = 1_000_000n;
const VIRTUAL_SHARES = 1_000_000n;
const Q32 = 1n << 32n;
const USDC_SCALE = 10_000_000n;
const ACCEPTED_TREE_LEVELS = 6;
const BABYJUB_BASE8: Point = [
  5299619240641551281634865583518297030282874472190772894086521144482721001553n,
  16950150798460657717958625567821834550301663161624707787222815936182638968203n,
];

function formatPrivateAtomic(amount: bigint): string {
  const whole = amount / USDC_SCALE;
  const fraction = (amount % USDC_SCALE)
    .toString()
    .padStart(7, "0")
    .replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

type PrivateTransition = {
  proof: Uint8Array;
  membership_root: bigint;
  append_root: bigint;
  new_root: bigint;
  input_nullifiers: bigint[];
  output_commitments: bigint[];
  encrypted_outputs: Uint8Array[];
};

export type LiquidityVaultInfo = {
  share_controller: string;
  target_assets: bigint;
  funded_assets: bigint;
  total_shares: bigint;
  locked_shares: bigint;
  terminal_assets: bigint;
  funding_deadline: bigint;
  activation_cutoff: bigint;
  decimals: number;
  phase: string | { tag: string };
  market?: string;
  state_version: bigint;
};

export type PooledLiquidityInfo = {
  token: string;
  factory: string;
  shared_vault: string;
  governance: string;
  policy: {
    deposit_cap: bigint;
    max_active_allocations: number;
    max_deployed_bps: number;
    max_market_bps: number;
    max_group_bps: number;
    minimum_idle_bps: number;
    withdrawal_window: bigint;
    max_withdrawal_bps: number;
  };
  idle_assets: bigint;
  total_shares: bigint;
  deployed_principal: bigint;
  active_allocations: number;
  queue_head: bigint;
  queue_tail: bigint;
  pending_candidates: number;
  allocation_cursor: bigint;
  state_version: bigint;
  withdrawal_window_started_at: bigint;
  withdrawal_window_limit: bigint;
  withdrawal_window_used: bigint;
};

export type PooledLiquidityNav = {
  deposit_nav: bigint;
  withdrawal_nav: bigint;
  idle_assets: bigint;
  funding_assets: bigint;
  terminal_assets: bigint;
  active_floor_assets: bigint;
  active_ceiling_assets: bigint;
  conditional_fees_excluded: bigint;
  immediate_assets: bigint;
  limiter_resets_at: bigint;
};

export type PooledRedemptionPreview = {
  shares: bigint;
  assets: bigint;
  immediate_assets: bigint;
  can_redeem_now: boolean;
  limiter_resets_at: bigint;
  state_version: bigint;
};

type PrivateMarketRegistration = {
  current_epoch: bigint;
  lot_size: bigint;
  maximum_batch_size: number;
  minimum_side_count: number;
  fee_bps: number;
  lp_fee_share_bps: number;
  maximum_price_movement: bigint;
  rules_hash: Uint8Array;
  expiry: bigint;
  finalized: boolean;
};

type LiquidityExitPaymentDestination = {
  commitment: Uint8Array;
  spend_public_key: bigint;
  viewing_public_key_x: bigint;
  viewing_public_key_y: bigint;
  note_id: bigint;
  blinding: bigint;
};

type LiquidityExitIntent = {
  shares_remaining: bigint;
  minimum_payment_remaining: bigint;
  destination: Uint8Array;
  payment_destination: LiquidityExitPaymentDestination;
  expiry: bigint;
  status: string | { tag: string };
};

type LiquidityMarketSnapshot = {
  state_version: bigint;
  equity_if_yes: bigint;
  equity_if_no: bigint;
  conditional_lp_fees: bigint;
  updated_at: bigint;
};

type PrivateEpoch = {
  epoch: bigint;
  market_state_version: bigint;
  accepted_root: bigint;
  accepted_count: number;
  first_sequence: bigint;
  last_sequence: bigint;
  cutoff: bigint;
  refund_at: bigint;
  committee_epoch: bigint;
  committee_config_hash: Uint8Array;
  committee_public_key_x: bigint;
  committee_public_key_y: bigint;
  phase: string | { tag: string };
};

type EncryptedOrder = {
  yes_c1_x: bigint;
  yes_c1_y: bigint;
  yes_c2_x: bigint;
  yes_c2_y: bigint;
  no_c1_x: bigint;
  no_c1_y: bigint;
  no_c2_x: bigint;
  no_c2_y: bigint;
};

type PrivateOrderRecord = {
  sequence: bigint;
  action_id: Uint8Array;
  position_commitment: bigint;
  encrypted_order: EncryptedOrder;
  status?: unknown;
};

type PrivateBatchQuote = {
  state_version: bigint;
  batch_size: number;
  yes_count: number;
  no_count: number;
  pre_yes_price: bigint;
  post_yes_price: bigint;
  yes_price: bigint;
  no_price: bigint;
  aggregate_market_charge: bigint;
  yes_market_cost: bigint;
  no_market_cost: bigint;
  yes_charge_per_position: bigint;
  no_charge_per_position: bigint;
  rounding_contribution: bigint;
  fee_per_position: bigint;
  fee_escrow: bigint;
  conditional_lp_fee: bigint;
  conditional_protocol_fee: bigint;
};

type PrivateBatchRecord = {
  allocation_root: bigint;
  accepted_root: bigint;
  quote: PrivateBatchQuote;
};

type PrivateMarketAccounting = {
  finalized_outcome: string | { tag: string };
};

type PrivateOrderBinding = {
  epoch: bigint;
  market_state_version: bigint;
  position_commitment: bigint;
  lot_size: bigint;
  fee_bps: number;
  maximum_batch_size: number;
  minimum_side_count: number;
  maximum_price_movement: bigint;
  rules_hash: Uint8Array;
  refund_at: bigint;
  committee_epoch: bigint;
  committee_config_hash: Uint8Array;
  committee_public_key_x: bigint;
  committee_public_key_y: bigint;
  encrypted_order: EncryptedOrder;
  old_accepted_root: bigint;
  new_accepted_root: bigint;
  accepted_leaf_index: number;
  sequence: bigint;
};

export async function getPrivateOrderUnitReserve(
  address: string,
  market: string,
): Promise<bigint> {
  const config = await getPrivateConfig();
  const registration = await readPrivateContract<
    PrivateMarketRegistration | undefined
  >(
    config.contracts.sharedVault,
    address,
    "registration",
    { market },
  );
  if (!registration || registration.finalized) {
    throw new Error("Private market registration is unavailable");
  }
  const payout = ceilDiv(registration.lot_size * USDC_SCALE, Q32);
  const maximumFee = ceilDiv(
    registration.lot_size * BigInt(registration.fee_bps) * USDC_SCALE,
    Q32 * 40_000n,
  );
  return payout + maximumFee;
}

function actionId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function actionExpiry(): bigint {
  return BigInt(Math.floor(Date.now() / 1_000) + 20 * 60);
}

function privateDomain(
  config: PrivateDeploymentConfig,
  contextFields: bigint[],
): bigint {
  if (contextFields.length !== 46) throw new Error("Private context is invalid");
  const domain = noteDomain(contextFields);
  if (domain === 0n || config.privacy.treeLevels !== 20) {
    throw new Error("Private note domain is invalid");
  }
  return domain;
}

function stringifyWitness(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stringifyWitness);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [key, stringifyWitness(field)]),
    );
  }
  return value;
}

function expectedActionSignals({
  action,
  contextDigest,
  membershipRoot,
  appendRoot,
  newRoot,
  nullifiers,
  outputs,
  firstLeafIndex,
  publicAmount,
}: {
  action: bigint;
  contextDigest: bigint;
  membershipRoot: bigint;
  appendRoot: bigint;
  newRoot: bigint;
  nullifiers: bigint[];
  outputs: PrivateOutput[];
  firstLeafIndex: number;
  publicAmount: bigint;
}): bigint[] {
  return [
    action,
    contextDigest,
    membershipRoot,
    appendRoot,
    newRoot,
    BigInt(nullifiers.length),
    nullifiers[0] ?? 0n,
    nullifiers[1] ?? 0n,
    outputs[0].commitment,
    outputs[1].commitment,
    outputs[0].envelopeHash,
    outputs[1].envelopeHash,
    BigInt(firstLeafIndex),
    publicAmount < 0n ? 1n : 0n,
    publicAmount < 0n ? -publicAmount : publicAmount,
  ];
}

function expectedFourOutputSignals({
  action,
  contextDigest,
  membershipRoot,
  appendRoot,
  newRoot,
  nullifiers,
  outputs,
  firstLeafIndex,
}: {
  action: bigint;
  contextDigest: bigint;
  membershipRoot: bigint;
  appendRoot: bigint;
  newRoot: bigint;
  nullifiers: [bigint, bigint];
  outputs: [PrivateOutput, PrivateOutput, PrivateOutput, PrivateOutput];
  firstLeafIndex: number;
}): bigint[] {
  return [
    action,
    contextDigest,
    membershipRoot,
    appendRoot,
    newRoot,
    2n,
    nullifiers[0],
    nullifiers[1],
    0n,
    ...outputs.map((output) => output.commitment),
    ...outputs.map((output) => output.envelopeHash),
    BigInt(firstLeafIndex),
    0n,
    0n,
  ];
}

function assertSignals(actual: bigint[], expected: bigint[]): void {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error("Private proof public signals do not match the requested action");
  }
}

function transition(
  proof: Uint8Array,
  tree: PrivateTree,
  nextRoot: bigint,
  nullifiers: bigint[],
  outputs: PrivateOutput[],
): PrivateTransition {
  return {
    proof,
    membership_root: tree.root,
    append_root: tree.root,
    new_root: nextRoot,
    input_nullifiers: nullifiers,
    output_commitments: outputs.map((output) => output.commitment),
    encrypted_outputs: outputs.map((output) => fieldsToEnvelope(output.envelope)),
  };
}

function outputSecrets() {
  return {
    noteId: randomPrivateScalar(),
    blinding: randomPrivateScalar(),
    ephemeralSecret: randomPrivateScalar(),
    nonce: randomPrivateScalar(),
  };
}

function outputFields(outputs: PrivateOutput[]) {
  return {
    outPurpose: outputs.map((output) => output.purpose),
    outAmount: outputs.map((output) => output.amount),
    outSpendPublicKey: outputs.map((output) => output.spendPublicKey),
    outViewingPublicKey: outputs.map((output) => output.viewingPublicKey),
    outNoteId: outputs.map((output) => output.noteId),
    outPayloadHash: outputs.map((output) => output.payloadHash),
    outPrivateData: outputs.map((output) => output.privateData),
    outBlinding: outputs.map((output) => output.blinding),
    outEphemeralSecret: outputs.map((output) => output.ephemeralSecret),
    outNonce: outputs.map((output) => output.nonce),
    outEnvelope: outputs.map((output) => output.envelope),
  };
}

function inputFields(
  inputs: OwnedIndexedNote[],
  tree: PrivateTree,
) {
  return {
    inPurpose: inputs.map((input) => input.purpose),
    inAmount: inputs.map((input) => input.amount),
    inSpendSecret: inputs.map((input) => input.spendSecret),
    inViewingPublicKey: inputs.map((input) => input.viewingPublicKey),
    inNoteId: inputs.map((input) => input.noteId),
    inPayloadHash: inputs.map((input) => input.payloadHash),
    inPrivateData: inputs.map((input) => input.privateData),
    inBlinding: inputs.map((input) => input.blinding),
    inLeafIndex: inputs.map((input) => BigInt(input.leafIndex)),
    inSiblings: inputs.map((input) => membershipPath(tree, input.leafIndex)),
  };
}

function assertAmount(amount: bigint): void {
  if (amount <= 0n || amount > MAX_NOTE_AMOUNT) {
    throw new Error("Private USDC amount is outside the supported range");
  }
}

function fieldFromBytes(value: Uint8Array): bigint {
  const [high, low] = bytes32Limbs(value);
  return high * (1n << 128n) + low;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

async function freshTree(config: PrivateDeploymentConfig): Promise<PrivateTree> {
  const snapshot = await getPrivateTree();
  if (
    snapshot.vaultId !== config.contracts.sharedVault ||
    snapshot.levels !== config.privacy.treeLevels
  ) {
    throw new Error("Private tree does not match the configured vault");
  }
  const tree = merkleTree(snapshot.commitments.map(BigInt), snapshot.levels);
  if (tree.root !== BigInt(snapshot.currentRoot)) {
    throw new Error("Private tree failed local verification");
  }
  return tree;
}

export async function shieldUsdc(
  address: string,
  amount: bigint,
  onStatus?: (status: string) => void,
): Promise<string> {
  assertAmount(amount);
  onStatus?.("Reading the shared vault");
  const config = await getPrivateConfig();
  const tree = await freshTree(config);
  const keys = await unlockPositionBackup(address);
  const id = actionId();
  const expiry = actionExpiry();
  const contextFields = await operationContextFields({
    networkDomain: config.networkDomain,
    vault: config.contracts.sharedVault,
    token: config.collateral.contract,
    verifierDomain: config.verifierDomain,
    action: 0n,
    actionId: id,
    publicAccount: address,
    publicAmount: amount,
    expiry,
    bindingKind: 0n,
  });
  const domain = privateDomain(config, contextFields);
  const outputs = [
    createOutputNote({
      outputIndex: 0,
      domain,
      purpose: 1n,
      amount,
      spendSecret: keys.noteSpendSecret,
      viewingSecret: keys.noteViewingSecret,
      ...outputSecrets(),
    }),
    createOutputNote({
      outputIndex: 1,
      domain,
      purpose: 0n,
      amount: 0n,
      spendSecret: keys.noteSpendSecret,
      viewingSecret: keys.noteViewingSecret,
      ...outputSecrets(),
    }),
  ];
  const appended = appendPair(tree, [
    outputs[0].commitment,
    outputs[1].commitment,
  ]);
  const contextDigest = poseidon2Hash(contextFields);
  const witness = {
    action: 0n,
    contextDigest,
    membershipRoot: tree.root,
    appendRoot: tree.root,
    newRoot: appended.newRoot,
    nullifierCount: 0n,
    nullifier0: 0n,
    nullifier1: 0n,
    outputCommitment0: outputs[0].commitment,
    outputCommitment1: outputs[1].commitment,
    outputEnvelopeHash0: outputs[0].envelopeHash,
    outputEnvelopeHash1: outputs[1].envelopeHash,
    firstLeafIndex: BigInt(appended.firstLeafIndex),
    publicAmountSign: 0n,
    publicAmountMagnitude: amount,
    contextFields,
    ...outputFields(outputs),
    appendSiblings: appended.siblings,
  };
  onStatus?.("Generating the deposit proof");
  const proved = await provePrivateAction(
    "deposit",
    stringifyWitness(witness) as Record<string, unknown>,
  );
  assertSignals(proved.publicSignals, expectedActionSignals({
    action: 0n,
    contextDigest,
    membershipRoot: tree.root,
    appendRoot: tree.root,
    newRoot: appended.newRoot,
    nullifiers: [],
    outputs,
    firstLeafIndex: appended.firstLeafIndex,
    publicAmount: amount,
  }));
  onStatus?.("Authorizing the public USDC deposit");
  return sendPrivateWalletCall(
    config.contracts.sharedVault,
    address,
    "deposit",
    {
      from: address,
      amount,
      action_id: hexToBytes(id),
      expiry,
      transition: transition(proved.proof, tree, appended.newRoot, [], outputs),
    },
  );
}

export async function withdrawPrivateUsdc(
  address: string,
  amount: bigint,
  onStatus?: (status: string) => void,
): Promise<string> {
  assertAmount(amount);
  onStatus?.("Preparing private USDC withdrawal");
  const { wallet, note: input } = await privateWalletWithSpendableNote(
    address,
    amount,
    onStatus,
  );
  const id = actionId();
  const expiry = actionExpiry();
  const contextFields = await operationContextFields({
    networkDomain: wallet.config.networkDomain,
    vault: wallet.config.contracts.sharedVault,
    token: wallet.config.collateral.contract,
    verifierDomain: wallet.config.verifierDomain,
    action: 2n,
    actionId: id,
    publicAccount: address,
    publicAmount: -amount,
    expiry,
    bindingKind: 0n,
  });
  const domain = privateDomain(wallet.config, contextFields);
  const change = input.amount - amount;
  const outputs = [
    createOutputNote({
      outputIndex: 0,
      domain,
      purpose: change === 0n ? 0n : 1n,
      amount: change,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      ...outputSecrets(),
    }),
    createOutputNote({
      outputIndex: 1,
      domain,
      purpose: 0n,
      amount: 0n,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      ...outputSecrets(),
    }),
  ];
  const appended = appendPair(wallet.tree, [
    outputs[0].commitment,
    outputs[1].commitment,
  ]);
  const nullifier = noteNullifier(input, input.spendSecret, 1n);
  const contextDigest = poseidon2Hash(contextFields);
  const witness = {
    action: 2n,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: appended.newRoot,
    nullifierCount: 1n,
    nullifier0: nullifier,
    nullifier1: 0n,
    outputCommitment0: outputs[0].commitment,
    outputCommitment1: outputs[1].commitment,
    outputEnvelopeHash0: outputs[0].envelopeHash,
    outputEnvelopeHash1: outputs[1].envelopeHash,
    firstLeafIndex: BigInt(appended.firstLeafIndex),
    publicAmountSign: 1n,
    publicAmountMagnitude: amount,
    contextFields,
    ...inputFields([input], wallet.tree),
    ...outputFields(outputs),
    appendSiblings: appended.siblings,
  };
  onStatus?.("Generating the private withdrawal proof");
  const proved = await provePrivateAction(
    "withdraw",
    stringifyWitness(witness) as Record<string, unknown>,
  );
  assertSignals(proved.publicSignals, expectedActionSignals({
    action: 2n,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: appended.newRoot,
    nullifiers: [nullifier],
    outputs,
    firstLeafIndex: appended.firstLeafIndex,
    publicAmount: -amount,
  }));
  onStatus?.("Relaying the public USDC withdrawal");
  return relayPrivateContractCall(
    wallet.config.contracts.sharedVault,
    address,
    "withdraw",
    {
      recipient: address,
      amount,
      action_id: hexToBytes(id),
      expiry,
      transition: transition(
        proved.proof,
        wallet.tree,
        appended.newRoot,
        [nullifier],
        outputs,
      ),
    },
  );
}

function selectFundingInputs(
  notes: OwnedIndexedNote[],
  amount: bigint,
): [OwnedIndexedNote, OwnedIndexedNote] {
  const candidates = notes.filter((note) =>
    note.purpose === 0n || note.purpose === 1n ||
    note.purpose === 6n || note.purpose === 7n
  );
  for (let left = 0; left < candidates.length; left++) {
    for (let right = left + 1; right < candidates.length; right++) {
      if (candidates[left].amount + candidates[right].amount >= amount) {
        return [candidates[left], candidates[right]];
      }
    }
  }
  throw new Error("Shield enough USDC before funding this market");
}

async function waitForIndexedPrivateOutput(
  address: string,
  commitment: bigint,
): Promise<PrivateWalletSnapshot> {
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const wallet = await openPrivateWallet(address);
    if (wallet.notes.some((note) => note.commitment === commitment)) {
      return wallet;
    }
  }
  throw new Error("Private transfer confirmed, but the new note is not indexed yet");
}

async function consolidatePrivateNotes(
  address: string,
  wallet: PrivateWalletSnapshot,
  inputs: [OwnedIndexedNote, OwnedIndexedNote],
  onStatus?: (status: string) => void,
): Promise<PrivateWalletSnapshot> {
  onStatus?.("Consolidating encrypted private notes");
  const id = actionId();
  const expiry = actionExpiry();
  const contextFields = await operationContextFields({
    networkDomain: wallet.config.networkDomain,
    vault: wallet.config.contracts.sharedVault,
    token: wallet.config.collateral.contract,
    verifierDomain: wallet.config.verifierDomain,
    action: 1n,
    actionId: id,
    publicAmount: 0n,
    expiry,
    bindingKind: 0n,
  });
  const domain = privateDomain(wallet.config, contextFields);
  const amount = inputs[0].amount + inputs[1].amount;
  const outputs = [
    createOutputNote({
      outputIndex: 0,
      domain,
      purpose: 1n,
      amount,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      ...outputSecrets(),
    }),
    createOutputNote({
      outputIndex: 1,
      domain,
      purpose: 0n,
      amount: 0n,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      ...outputSecrets(),
    }),
  ];
  const appended = appendPair(wallet.tree, [
    outputs[0].commitment,
    outputs[1].commitment,
  ]);
  const nullifiers = inputs.map((note) =>
    noteNullifier(note, note.spendSecret, 1n)
  );
  const contextDigest = poseidon2Hash(contextFields);
  const witness = {
    action: 1n,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: appended.newRoot,
    nullifierCount: 2n,
    nullifier0: nullifiers[0],
    nullifier1: nullifiers[1],
    outputCommitment0: outputs[0].commitment,
    outputCommitment1: outputs[1].commitment,
    outputEnvelopeHash0: outputs[0].envelopeHash,
    outputEnvelopeHash1: outputs[1].envelopeHash,
    firstLeafIndex: BigInt(appended.firstLeafIndex),
    publicAmountSign: 0n,
    publicAmountMagnitude: 0n,
    contextFields,
    ...inputFields(inputs, wallet.tree),
    ...outputFields(outputs),
    appendSiblings: appended.siblings,
  };
  const proved = await provePrivateAction(
    "transfer",
    stringifyWitness(witness) as Record<string, unknown>,
  );
  assertSignals(proved.publicSignals, expectedActionSignals({
    action: 1n,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: appended.newRoot,
    nullifiers,
    outputs,
    firstLeafIndex: appended.firstLeafIndex,
    publicAmount: 0n,
  }));
  onStatus?.("Relaying private note consolidation");
  await relayPrivateContractCall(
    wallet.config.contracts.sharedVault,
    address,
    "private_transfer",
    {
      action_id: hexToBytes(id),
      expiry,
      transition: transition(
        proved.proof,
        wallet.tree,
        appended.newRoot,
        nullifiers,
        outputs,
      ),
    },
  );
  onStatus?.("Waiting for consolidated private balance");
  return waitForIndexedPrivateOutput(address, outputs[0].commitment);
}

async function privateWalletWithSpendableNote(
  address: string,
  amount: bigint,
  onStatus?: (status: string) => void,
): Promise<{
  wallet: PrivateWalletSnapshot;
  note: OwnedIndexedNote;
}> {
  let wallet = await openPrivateWallet(address);
  for (let attempt = 0; attempt < 64; attempt++) {
    const note = selectSmallestSufficientNote(wallet.notes, amount);
    if (note) return { wallet, note };
    if (liquidPrivateTotal(wallet.notes) < amount) {
      throw new Error("Add enough private USDC in Portfolio before continuing");
    }
    const pair = selectConsolidationPair(wallet.notes);
    if (!pair) {
      throw new Error("Private balance could not be consolidated for this amount");
    }
    wallet = await consolidatePrivateNotes(address, wallet, pair, onStatus);
  }
  throw new Error("Private balance needs too many consolidation steps");
}

function phaseName(value: LiquidityVaultInfo["phase"]): string {
  return typeof value === "string" ? value : value.tag;
}

export async function getLiquidityVaultInfo(
  address: string,
  liquidityVaultId: string,
): Promise<LiquidityVaultInfo> {
  return readPrivateContract<LiquidityVaultInfo>(
    liquidityVaultId,
    address,
    "info",
  );
}

export async function getPooledLiquidityState(
  address: string,
): Promise<{
  poolId: string;
  info: PooledLiquidityInfo;
  nav: PooledLiquidityNav;
}> {
  const config = await getPrivateConfig();
  const [info, nav] = await Promise.all([
    readPrivateContract<PooledLiquidityInfo>(
      config.contracts.liquidityPool,
      address,
      "info",
    ),
    readPrivateContract<PooledLiquidityNav>(
      config.contracts.liquidityPool,
      address,
      "nav",
    ),
  ]);
  if (
    info.token !== config.collateral.contract ||
    info.factory !== config.contracts.factory ||
    info.shared_vault !== config.contracts.sharedVault
  ) {
    throw new Error("The pooled liquidity vault is not wired to this deployment");
  }
  return { poolId: config.contracts.liquidityPool, info, nav };
}

export async function previewPooledLiquidityRedemption(
  address: string,
  shares: bigint,
): Promise<PooledRedemptionPreview> {
  assertAmount(shares);
  const config = await getPrivateConfig();
  return readPrivateContract<PooledRedemptionPreview>(
    config.contracts.liquidityPool,
    address,
    "preview_redeem",
    { shares },
  );
}

async function fundLiquidity(
  address: string,
  liquidityVaultId: string,
  requestedAmount: bigint,
  onStatus?: (status: string) => void,
): Promise<{ hash: string; assets: bigint; shares: bigint }> {
  assertAmount(requestedAmount);
  onStatus?.("Reading private balance and LP vault");
  const config = await getPrivateConfig();
  let amount = requestedAmount;
  let shares: bigint;
  let stateVersion: bigint;
  if (liquidityVaultId === config.contracts.liquidityPool) {
    const state = await getPooledLiquidityState(address);
    shares = await readPrivateContract<bigint>(
      liquidityVaultId,
      address,
      "preview_deposit",
      { assets: amount },
    );
    stateVersion = state.info.state_version;
  } else {
    const info = await getLiquidityVaultInfo(address, liquidityVaultId);
    if (phaseName(info.phase) !== "Funding") {
      throw new Error("This market is no longer accepting initial liquidity");
    }
    const remaining = info.target_assets - info.funded_assets;
    amount = requestedAmount < remaining ? requestedAmount : remaining;
    shares = amount * (info.total_shares + VIRTUAL_SHARES)
      / (info.funded_assets + VIRTUAL_ASSETS);
    stateVersion = info.state_version;
  }
  assertAmount(amount);
  assertAmount(shares);
  const { wallet, note: input } = await privateWalletWithSpendableNote(
    address,
    amount,
    onStatus,
  );
  const inputTotal = input.amount;
  const id = actionId();
  const expiry = actionExpiry();
  const liquidityAddressFields = await addressLimbs(liquidityVaultId);
  const liquidityPayload = poseidon2Hash([1011n, ...liquidityAddressFields]);
  const baseContext = await operationContextFields({
    networkDomain: wallet.config.networkDomain,
    vault: wallet.config.contracts.sharedVault,
    token: wallet.config.collateral.contract,
    verifierDomain: wallet.config.verifierDomain,
    action: 6n,
    actionId: id,
    publicAmount: -amount,
    market: liquidityVaultId,
    expiry,
    bindingKind: 1n,
    bindingFields: Array<bigint>(24).fill(0n),
  });
  const domain = privateDomain(wallet.config, baseContext);
  const change = inputTotal - amount;
  const outputs = [
    createOutputNote({
      outputIndex: 0,
      domain,
      purpose: change === 0n ? 0n : 1n,
      amount: change,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      ...outputSecrets(),
    }),
    createOutputNote({
      outputIndex: 1,
      domain,
      purpose: 3n,
      amount: shares,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      payloadHash: liquidityPayload,
      ...outputSecrets(),
    }),
  ];
  const bindingFields = Array<bigint>(24).fill(0n);
  bindingFields[0] = liquidityAddressFields[0];
  bindingFields[1] = liquidityAddressFields[1];
  bindingFields[2] = outputs[1].commitment;
  bindingFields[3] = shares;
  bindingFields[4] = amount;
  bindingFields[5] = stateVersion;
  const contextFields = await operationContextFields({
    networkDomain: wallet.config.networkDomain,
    vault: wallet.config.contracts.sharedVault,
    token: wallet.config.collateral.contract,
    verifierDomain: wallet.config.verifierDomain,
    action: 6n,
    actionId: id,
    publicAmount: -amount,
    market: liquidityVaultId,
    expiry,
    bindingKind: 1n,
    bindingFields,
  });
  const append = appendPair(wallet.tree, [
    outputs[0].commitment,
    outputs[1].commitment,
  ]);
  const nullifiers = [noteNullifier(input, input.spendSecret, 1n)];
  const contextDigest = poseidon2Hash(contextFields);
  const witness = {
    action: 6n,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: append.newRoot,
    nullifierCount: 1n,
    nullifier0: nullifiers[0],
    nullifier1: 0n,
    outputCommitment0: outputs[0].commitment,
    outputCommitment1: outputs[1].commitment,
    outputEnvelopeHash0: outputs[0].envelopeHash,
    outputEnvelopeHash1: outputs[1].envelopeHash,
    firstLeafIndex: BigInt(append.firstLeafIndex),
    publicAmountSign: 1n,
    publicAmountMagnitude: amount,
    contextFields,
    ...inputFields([input], wallet.tree),
    ...outputFields(outputs),
    appendSiblings: append.siblings,
  };
  onStatus?.("Generating the private LP proof");
  const proved = await provePrivateAction(
    "liquidity_fund",
    stringifyWitness(witness) as Record<string, unknown>,
  );
  assertSignals(proved.publicSignals, expectedActionSignals({
    action: 6n,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: append.newRoot,
    nullifiers,
    outputs,
    firstLeafIndex: append.firstLeafIndex,
    publicAmount: -amount,
  }));
  onStatus?.("Relaying the unlinkable LP transaction");
  const hash = await relayPrivateContractCall(
    wallet.config.contracts.sharedVault,
    address,
    "fund_liquidity",
    {
      liquidity_vault: liquidityVaultId,
      amount,
      expected_shares: shares,
      share_commitment: hexToBytes(outputs[1].commitment.toString(16).padStart(64, "0")),
      expected_version: stateVersion,
      action_id: hexToBytes(id),
      expiry,
      transition: transition(
        proved.proof,
        wallet.tree,
        append.newRoot,
        nullifiers,
        outputs,
      ),
    },
  );
  return { hash, assets: amount, shares };
}

export async function fundPooledLiquidity(
  address: string,
  requestedAmount: bigint,
  onStatus?: (status: string) => void,
): Promise<{ hash: string; assets: bigint; shares: bigint }> {
  const config = await getPrivateConfig();
  return fundLiquidity(
    address,
    config.contracts.liquidityPool,
    requestedAmount,
    onStatus,
  );
}

export async function fundMarketLiquidity(
  address: string,
  liquidityVaultId: string,
  requestedAmount: bigint,
  onStatus?: (status: string) => void,
): Promise<{ hash: string; assets: bigint; shares: bigint }> {
  return fundLiquidity(address, liquidityVaultId, requestedAmount, onStatus);
}

export type OwnedLiquidityShare = {
  commitment: bigint;
  shares: bigint;
  liquidityVaultId: string;
};

export async function getOwnedLiquidityShares(
  address: string,
  liquidityVaultIds: string[],
  snapshot?: PrivateWalletSnapshot,
): Promise<OwnedLiquidityShare[]> {
  const wallet = snapshot ?? await openPrivateWallet(address);
  const payloads = new Map<string, string>();
  for (const liquidityVaultId of liquidityVaultIds) {
    const fields = await addressLimbs(liquidityVaultId);
    payloads.set(
      poseidon2Hash([1011n, ...fields]).toString(),
      liquidityVaultId,
    );
  }
  return wallet.notes.flatMap((note) => {
    if (note.purpose !== 3n) return [];
    const liquidityVaultId = payloads.get(note.payloadHash.toString());
    return liquidityVaultId
      ? [{
          commitment: note.commitment,
          shares: note.amount,
          liquidityVaultId,
        }]
      : [];
  });
}

export async function withdrawLiquidity({
  address,
  liquidityVaultId,
  shareCommitment,
  shares,
  onStatus,
}: {
  address: string;
  liquidityVaultId: string;
  shareCommitment: bigint;
  shares: bigint;
  onStatus?: (status: string) => void;
}): Promise<{ hash: string; assets: bigint; remainingShares: bigint }> {
  assertAmount(shares);
  onStatus?.("Reading the private LP position");
  const wallet = await openPrivateWallet(address);
  const liquidityFields = await addressLimbs(liquidityVaultId);
  const liquidityPayload = poseidon2Hash([1011n, ...liquidityFields]);
  const note = wallet.notes.find((candidate) =>
    candidate.purpose === 3n &&
    candidate.commitment === shareCommitment &&
    candidate.payloadHash === liquidityPayload
  );
  if (!note || shares > note.amount) {
    throw new Error("The private LP share note is unavailable");
  }
  const config = await getPrivateConfig();
  let terminal = false;
  let assets: bigint;
  let stateVersion: bigint;
  if (liquidityVaultId === config.contracts.liquidityPool) {
    const preview = await readPrivateContract<PooledRedemptionPreview>(
      liquidityVaultId,
      address,
      "preview_redeem",
      { shares },
    );
    if (!preview.can_redeem_now) {
      const available = formatPrivateAtomic(preview.immediate_assets);
      const resets = new Date(Number(preview.limiter_resets_at) * 1_000)
        .toLocaleString();
      throw new Error(
        `This share note is larger than the current ${available} USDC immediate exit capacity. The limit resets ${resets}.`,
      );
    }
    assets = preview.assets;
    stateVersion = preview.state_version;
  } else {
    const info = await getLiquidityVaultInfo(address, liquidityVaultId);
    const phase = phaseName(info.phase);
    terminal = phase === "Cancelled" || phase === "Settled";
    if (!terminal && phase !== "Funding" && phase !== "Ready") {
      throw new Error("Active LP shares require a replacement exit");
    }
    const assetsAvailable = terminal
      ? info.terminal_assets
      : info.funded_assets;
    assets = shares === info.total_shares
      ? assetsAvailable
      : shares * assetsAvailable / info.total_shares;
    stateVersion = info.state_version;
  }
  assertAmount(assets);
  const remainingShares = note.amount - shares;
  const id = actionId();
  const expiry = actionExpiry();
  const proofAction = terminal ? 8n : 7n;
  const staticContext = await operationContextFields({
    networkDomain: wallet.config.networkDomain,
    vault: wallet.config.contracts.sharedVault,
    token: wallet.config.collateral.contract,
    verifierDomain: wallet.config.verifierDomain,
    action: proofAction,
    actionId: id,
    publicAmount: assets,
    market: liquidityVaultId,
    expiry,
    bindingKind: 1n,
    bindingFields: Array<bigint>(24).fill(0n),
  });
  const domain = privateDomain(wallet.config, staticContext);
  const outputs = [
    createOutputNote({
      outputIndex: 0,
      domain,
      purpose: 1n,
      amount: assets,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      ...outputSecrets(),
    }),
    createOutputNote({
      outputIndex: 1,
      domain,
      purpose: remainingShares === 0n ? 0n : 3n,
      amount: remainingShares,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      payloadHash: remainingShares === 0n ? 0n : liquidityPayload,
      ...outputSecrets(),
    }),
  ];
  const bindingFields = Array<bigint>(24).fill(0n);
  bindingFields[0] = liquidityFields[0];
  bindingFields[1] = liquidityFields[1];
  bindingFields[2] = outputs[1].commitment;
  bindingFields[3] = shares;
  bindingFields[4] = assets;
  bindingFields[5] = stateVersion;
  const contextFields = await operationContextFields({
    networkDomain: wallet.config.networkDomain,
    vault: wallet.config.contracts.sharedVault,
    token: wallet.config.collateral.contract,
    verifierDomain: wallet.config.verifierDomain,
    action: proofAction,
    actionId: id,
    publicAmount: assets,
    market: liquidityVaultId,
    expiry,
    bindingKind: 1n,
    bindingFields,
  });
  const appended = appendPair(wallet.tree, [
    outputs[0].commitment,
    outputs[1].commitment,
  ]);
  const nullifier = noteNullifier(note, note.spendSecret, 2n);
  const contextDigest = poseidon2Hash(contextFields);
  const witness = {
    action: proofAction,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: appended.newRoot,
    nullifierCount: 1n,
    nullifier0: nullifier,
    nullifier1: 0n,
    outputCommitment0: outputs[0].commitment,
    outputCommitment1: outputs[1].commitment,
    outputEnvelopeHash0: outputs[0].envelopeHash,
    outputEnvelopeHash1: outputs[1].envelopeHash,
    firstLeafIndex: BigInt(appended.firstLeafIndex),
    publicAmountSign: 0n,
    publicAmountMagnitude: assets,
    contextFields,
    ...inputFields([note], wallet.tree),
    ...outputFields(outputs),
    appendSiblings: appended.siblings,
  };
  onStatus?.("Generating the private LP withdrawal proof");
  const proved = await provePrivateAction(
    terminal ? "liquidity_redeem" : "liquidity_exit",
    stringifyWitness(witness) as Record<string, unknown>,
  );
  assertSignals(proved.publicSignals, expectedActionSignals({
    action: proofAction,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: appended.newRoot,
    nullifiers: [nullifier],
    outputs,
    firstLeafIndex: appended.firstLeafIndex,
    publicAmount: assets,
  }));
  onStatus?.("Relaying the unlinkable LP withdrawal");
  const hash = await relayPrivateContractCall(
    wallet.config.contracts.sharedVault,
    address,
    terminal ? "redeem_liquidity" : "unfund_liquidity",
    {
      liquidity_vault: liquidityVaultId,
      shares,
      expected_assets: assets,
      remaining_share_commitment: hexToBytes(
        outputs[1].commitment.toString(16).padStart(64, "0"),
      ),
      expected_version: stateVersion,
      action_id: hexToBytes(id),
      expiry,
      transition: transition(
        proved.proof,
        wallet.tree,
        appended.newRoot,
        [nullifier],
        outputs,
      ),
    },
  );
  return { hash, assets, remainingShares };
}

export type PrivateLiquidityExitOffer = {
  market: string;
  liquidityVaultId: string;
  exitId: string;
  status: string;
  shares: bigint;
  minimumPayment: bigint;
  expiry: bigint;
  equityFloor: bigint;
  equityCeiling: bigint;
  stateVersion: bigint;
  owned: boolean;
  receiptCommitment?: bigint;
};

async function liquidityExitState(
  address: string,
  market: string,
  liquidityVaultId: string,
  exitId: string,
): Promise<{
  intent: LiquidityExitIntent;
  snapshot: LiquidityMarketSnapshot;
  info: LiquidityVaultInfo;
  registration: PrivateMarketRegistration;
}> {
  const encodedExitId = hexToBytes(exitId);
  const config = await getPrivateConfig();
  const [intent, snapshot, info, registration] = await Promise.all([
    readPrivateContract<LiquidityExitIntent | undefined>(
      liquidityVaultId,
      address,
      "exit_intent",
      { exit_id: encodedExitId },
    ),
    readPrivateContract<LiquidityMarketSnapshot | undefined>(
      liquidityVaultId,
      address,
      "market_snapshot",
    ),
    getLiquidityVaultInfo(address, liquidityVaultId),
    readPrivateContract<PrivateMarketRegistration | undefined>(
      config.contracts.sharedVault,
      address,
      "registration",
      { market },
    ),
  ]);
  if (
    !intent ||
    !snapshot ||
    !registration ||
    info.market !== market ||
    info.share_controller !== config.contracts.sharedVault
  ) {
    throw new Error("The private LP exit is not wired to this market");
  }
  return { intent, snapshot, info, registration };
}

export async function getPrivateLiquidityExitOffers(
  address: string,
  market?: string,
  snapshot?: PrivateWalletSnapshot,
): Promise<PrivateLiquidityExitOffer[]> {
  const [wallet, entries] = await Promise.all([
    snapshot ?? openPrivateWallet(address),
    getPrivateLiquidityExits({ market }),
  ]);
  const vaultFields = new Map<string, Point>();
  const result: PrivateLiquidityExitOffer[] = [];
  for (const entry of entries) {
    if (!entry.intent || !entry.snapshot) continue;
    if (
      !/^\d+$/u.test(entry.intent.shares_remaining) ||
      !/^\d+$/u.test(entry.intent.minimum_payment_remaining) ||
      !/^\d+$/u.test(entry.intent.expiry) ||
      !/^\d+$/u.test(entry.stateVersion || "") ||
      !/^[0-9a-f]{64}$/u.test(entry.intent.destination)
    ) {
      throw new Error("Private liquidity exit terms are invalid");
    }
    let liquidityFields = vaultFields.get(entry.liquidityVault);
    if (!liquidityFields) {
      liquidityFields = await addressLimbs(entry.liquidityVault);
      vaultFields.set(entry.liquidityVault, liquidityFields);
    }
    const exitPayload = poseidon2Hash([
      1014n,
      ...liquidityFields,
      ...bytes32Limbs(hexToBytes(entry.exitId)),
    ]);
    const destination = BigInt(`0x${entry.intent.destination}`);
    const receipt = wallet.notes.find((note) =>
      note.purpose === 9n &&
      note.commitment === destination &&
      note.payloadHash === exitPayload
    );
    const equityIfYes = BigInt(entry.snapshot.equity_if_yes);
    const equityIfNo = BigInt(entry.snapshot.equity_if_no);
    result.push({
      market: entry.market,
      liquidityVaultId: entry.liquidityVault,
      exitId: entry.exitId,
      status: entry.status,
      shares: BigInt(entry.intent.shares_remaining),
      minimumPayment: BigInt(entry.intent.minimum_payment_remaining),
      expiry: BigInt(entry.intent.expiry),
      equityFloor: equityIfYes < equityIfNo ? equityIfYes : equityIfNo,
      equityCeiling: equityIfYes > equityIfNo ? equityIfYes : equityIfNo,
      stateVersion: BigInt(entry.stateVersion!),
      owned: Boolean(receipt),
      receiptCommitment: receipt?.commitment,
    });
  }
  return result;
}

export async function getLiquidityExitQuote({
  address,
  market,
  liquidityVaultId,
  shares,
}: {
  address: string;
  market: string;
  liquidityVaultId: string;
  shares: bigint;
}): Promise<{ floor: bigint; ceiling: bigint }> {
  assertAmount(shares);
  const [snapshot, info] = await Promise.all([
    readPrivateContract<LiquidityMarketSnapshot | undefined>(
      liquidityVaultId,
      address,
      "market_snapshot",
    ),
    getLiquidityVaultInfo(address, liquidityVaultId),
  ]);
  if (
    !snapshot ||
    info.market !== market ||
    phaseName(info.phase) !== "Active" ||
    info.total_shares <= 0n
  ) {
    throw new Error("The active LP valuation is unavailable");
  }
  const equityFloor = snapshot.equity_if_yes < snapshot.equity_if_no
    ? snapshot.equity_if_yes
    : snapshot.equity_if_no;
  const equityCeiling = snapshot.equity_if_yes > snapshot.equity_if_no
    ? snapshot.equity_if_yes
    : snapshot.equity_if_no;
  return {
    floor: shares * equityFloor / info.total_shares,
    ceiling: shares * equityCeiling / info.total_shares,
  };
}

export async function requestLiquidityExit({
  address,
  market,
  liquidityVaultId,
  shareCommitment,
  shares,
  minimumPayment,
  exitExpiry,
  onStatus,
}: {
  address: string;
  market: string;
  liquidityVaultId: string;
  shareCommitment: bigint;
  shares: bigint;
  minimumPayment: bigint;
  exitExpiry: bigint;
  onStatus?: (status: string) => void;
}): Promise<{
  hash: string;
  exitId: string;
  registrationPending: boolean;
}> {
  assertAmount(shares);
  assertAmount(minimumPayment);
  onStatus?.("Reading the active LP position");
  const wallet = await openPrivateWallet(address);
  const liquidityFields = await addressLimbs(liquidityVaultId);
  const liquidityPayload = poseidon2Hash([1011n, ...liquidityFields]);
  const note = wallet.notes.find((candidate) =>
    candidate.purpose === 3n &&
    candidate.commitment === shareCommitment &&
    candidate.payloadHash === liquidityPayload
  );
  if (!note || shares > note.amount) {
    throw new Error("The private LP share note is unavailable");
  }
  const [info, registration] = await Promise.all([
    getLiquidityVaultInfo(address, liquidityVaultId),
    readPrivateContract<PrivateMarketRegistration | undefined>(
      wallet.config.contracts.sharedVault,
      address,
      "registration",
      { market },
    ),
  ]);
  const now = BigInt(Math.floor(Date.now() / 1_000));
  if (
    !registration ||
    registration.finalized ||
    info.market !== market ||
    info.share_controller !== wallet.config.contracts.sharedVault ||
    phaseName(info.phase) !== "Active" ||
    exitExpiry <= now ||
    exitExpiry > registration.expiry
  ) {
    throw new Error("This market is not accepting active LP exit offers");
  }

  const id = actionId();
  const exitId = actionId();
  const expiry = actionExpiry();
  const baseContext = await operationContextFields({
    networkDomain: wallet.config.networkDomain,
    vault: wallet.config.contracts.sharedVault,
    token: wallet.config.collateral.contract,
    verifierDomain: wallet.config.verifierDomain,
    action: 11n,
    actionId: id,
    publicAmount: 0n,
    market,
    expiry,
    bindingKind: 6n,
    bindingFields: Array<bigint>(24).fill(0n),
  });
  const domain = privateDomain(wallet.config, baseContext);
  const paymentDestination = createOutputNote({
    outputIndex: 0,
    domain,
    purpose: 1n,
    amount: minimumPayment,
    spendSecret: wallet.keys.noteSpendSecret,
    viewingSecret: wallet.keys.noteViewingSecret,
    ...outputSecrets(),
  });
  const remainingShares = note.amount - shares;
  const exitPayload = poseidon2Hash([
    1014n,
    ...liquidityFields,
    ...bytes32Limbs(hexToBytes(exitId)),
  ]);
  const outputs: [PrivateOutput, PrivateOutput] = [
    createOutputNote({
      outputIndex: 0,
      domain,
      purpose: remainingShares === 0n ? 0n : 3n,
      amount: remainingShares,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      payloadHash: remainingShares === 0n ? 0n : liquidityPayload,
      ...outputSecrets(),
    }),
    createOutputNote({
      outputIndex: 1,
      domain,
      purpose: 9n,
      amount: shares,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      payloadHash: exitPayload,
      privateData: [minimumPayment, exitExpiry],
      ...outputSecrets(),
    }),
  ];
  const bindingFields = Array<bigint>(24).fill(0n);
  const exitFields = bytes32Limbs(hexToBytes(exitId));
  const destinationFields = bytes32Limbs(
    hexToBytes(outputs[1].commitment.toString(16).padStart(64, "0")),
  );
  const paymentFields = bytes32Limbs(
    hexToBytes(paymentDestination.commitment.toString(16).padStart(64, "0")),
  );
  [
    ...liquidityFields,
    ...exitFields,
    shares,
    minimumPayment,
    ...destinationFields,
    exitExpiry,
    info.state_version,
    ...paymentFields,
    paymentDestination.spendPublicKey,
    ...paymentDestination.viewingPublicKey,
    paymentDestination.noteId,
    paymentDestination.blinding,
  ].forEach((value, index) => {
    bindingFields[index] = value;
  });
  const contextFields = await operationContextFields({
    networkDomain: wallet.config.networkDomain,
    vault: wallet.config.contracts.sharedVault,
    token: wallet.config.collateral.contract,
    verifierDomain: wallet.config.verifierDomain,
    action: 11n,
    actionId: id,
    publicAmount: 0n,
    market,
    expiry,
    bindingKind: 6n,
    bindingFields,
  });
  const appended = appendPair(wallet.tree, [
    outputs[0].commitment,
    outputs[1].commitment,
  ]);
  const nullifier = noteNullifier(note, note.spendSecret, 2n);
  const contextDigest = poseidon2Hash(contextFields);
  const witness = {
    action: 11n,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: appended.newRoot,
    nullifierCount: 1n,
    nullifier0: nullifier,
    nullifier1: 0n,
    outputCommitment0: outputs[0].commitment,
    outputCommitment1: outputs[1].commitment,
    outputEnvelopeHash0: outputs[0].envelopeHash,
    outputEnvelopeHash1: outputs[1].envelopeHash,
    firstLeafIndex: BigInt(appended.firstLeafIndex),
    publicAmountSign: 0n,
    publicAmountMagnitude: 0n,
    contextFields,
    ...inputFields([note], wallet.tree),
    ...outputFields(outputs),
    appendSiblings: appended.siblings,
  };
  onStatus?.("Generating the private exit offer proof");
  const proved = await provePrivateAction(
    "exit_request",
    stringifyWitness(witness) as Record<string, unknown>,
  );
  assertSignals(proved.publicSignals, expectedActionSignals({
    action: 11n,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: appended.newRoot,
    nullifiers: [nullifier],
    outputs,
    firstLeafIndex: appended.firstLeafIndex,
    publicAmount: 0n,
  }));
  onStatus?.("Publishing the unlinkable LP exit offer");
  const hash = await relayPrivateContractCall(
    wallet.config.contracts.sharedVault,
    address,
    "request_liquidity_exit",
    {
      market,
      liquidity_vault: liquidityVaultId,
      exit_id: hexToBytes(exitId),
      shares,
      minimum_payment: minimumPayment,
      destination: hexToBytes(
        outputs[1].commitment.toString(16).padStart(64, "0"),
      ),
      payment_destination: {
        commitment: hexToBytes(
          paymentDestination.commitment.toString(16).padStart(64, "0"),
        ),
        spend_public_key: paymentDestination.spendPublicKey,
        viewing_public_key_x: paymentDestination.viewingPublicKey[0],
        viewing_public_key_y: paymentDestination.viewingPublicKey[1],
        note_id: paymentDestination.noteId,
        blinding: paymentDestination.blinding,
      },
      exit_expiry: exitExpiry,
      expected_version: info.state_version,
      action_id: hexToBytes(id),
      action_expiry: expiry,
      transition: transition(
        proved.proof,
        wallet.tree,
        appended.newRoot,
        [nullifier],
        outputs,
      ),
    },
  );
  let registrationPending = false;
  try {
    await registerPrivateLiquidityExit({
      market,
      liquidityVault: liquidityVaultId,
      exitId,
    });
  } catch {
    registrationPending = true;
  }
  return { hash, exitId, registrationPending };
}

export async function cancelLiquidityExit({
  address,
  market,
  liquidityVaultId,
  exitId,
  onStatus,
}: {
  address: string;
  market: string;
  liquidityVaultId: string;
  exitId: string;
  onStatus?: (status: string) => void;
}): Promise<string> {
  onStatus?.("Reading the private exit receipt");
  const [wallet, state] = await Promise.all([
    openPrivateWallet(address),
    liquidityExitState(address, market, liquidityVaultId, exitId),
  ]);
  if (phaseName(state.intent.status) !== "Open") {
    throw new Error("This LP exit offer is no longer open");
  }
  const liquidityFields = await addressLimbs(liquidityVaultId);
  const exitFields = bytes32Limbs(hexToBytes(exitId));
  const exitPayload = poseidon2Hash([1014n, ...liquidityFields, ...exitFields]);
  const destination = fieldFromBytes(state.intent.destination);
  const receipt = wallet.notes.find((note) =>
    note.purpose === 9n &&
    note.commitment === destination &&
    note.payloadHash === exitPayload &&
    note.amount === state.intent.shares_remaining
  );
  if (!receipt) throw new Error("The private LP exit receipt is unavailable");

  const id = actionId();
  const expiry = actionExpiry();
  const bindingFields = Array<bigint>(24).fill(0n);
  [
    ...liquidityFields,
    ...exitFields,
    state.intent.shares_remaining,
    state.intent.minimum_payment_remaining,
    ...bytes32Limbs(state.intent.destination),
    state.intent.expiry,
    state.info.state_version,
  ].forEach((value, index) => {
    bindingFields[index] = value;
  });
  const contextFields = await operationContextFields({
    networkDomain: wallet.config.networkDomain,
    vault: wallet.config.contracts.sharedVault,
    token: wallet.config.collateral.contract,
    verifierDomain: wallet.config.verifierDomain,
    action: 12n,
    actionId: id,
    publicAmount: 0n,
    market,
    expiry,
    bindingKind: 7n,
    bindingFields,
  });
  const domain = privateDomain(wallet.config, contextFields);
  const liquidityPayload = poseidon2Hash([1011n, ...liquidityFields]);
  const outputs: [PrivateOutput, PrivateOutput] = [
    createOutputNote({
      outputIndex: 0,
      domain,
      purpose: 3n,
      amount: state.intent.shares_remaining,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      payloadHash: liquidityPayload,
      ...outputSecrets(),
    }),
    createOutputNote({
      outputIndex: 1,
      domain,
      purpose: 0n,
      amount: 0n,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      ...outputSecrets(),
    }),
  ];
  const appended = appendPair(wallet.tree, [
    outputs[0].commitment,
    outputs[1].commitment,
  ]);
  const nullifier = noteNullifier(receipt, receipt.spendSecret, 5n);
  const contextDigest = poseidon2Hash(contextFields);
  const witness = {
    action: 12n,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: appended.newRoot,
    nullifierCount: 1n,
    nullifier0: nullifier,
    nullifier1: 0n,
    outputCommitment0: outputs[0].commitment,
    outputCommitment1: outputs[1].commitment,
    outputEnvelopeHash0: outputs[0].envelopeHash,
    outputEnvelopeHash1: outputs[1].envelopeHash,
    firstLeafIndex: BigInt(appended.firstLeafIndex),
    publicAmountSign: 0n,
    publicAmountMagnitude: 0n,
    contextFields,
    ...inputFields([receipt], wallet.tree),
    ...outputFields(outputs),
    appendSiblings: appended.siblings,
  };
  onStatus?.("Generating the private exit cancellation proof");
  const proved = await provePrivateAction(
    "exit_cancel",
    stringifyWitness(witness) as Record<string, unknown>,
  );
  assertSignals(proved.publicSignals, expectedActionSignals({
    action: 12n,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: appended.newRoot,
    nullifiers: [nullifier],
    outputs,
    firstLeafIndex: appended.firstLeafIndex,
    publicAmount: 0n,
  }));
  onStatus?.("Relaying the private exit cancellation");
  return relayPrivateContractCall(
    wallet.config.contracts.sharedVault,
    address,
    "cancel_liquidity_exit",
    {
      market,
      liquidity_vault: liquidityVaultId,
      exit_id: hexToBytes(exitId),
      expected_version: state.info.state_version,
      action_id: hexToBytes(id),
      action_expiry: expiry,
      transition: transition(
        proved.proof,
        wallet.tree,
        appended.newRoot,
        [nullifier],
        outputs,
      ),
    },
  );
}

export async function matchLiquidityExit({
  address,
  market,
  liquidityVaultId,
  exitId,
  onStatus,
}: {
  address: string;
  market: string;
  liquidityVaultId: string;
  exitId: string;
  onStatus?: (status: string) => void;
}): Promise<{ hash: string; shares: bigint; payment: bigint }> {
  onStatus?.("Verifying the current LP risk snapshot");
  const [wallet, state] = await Promise.all([
    openPrivateWallet(address),
    liquidityExitState(address, market, liquidityVaultId, exitId),
  ]);
  const shares = state.intent.shares_remaining;
  const payment = state.intent.minimum_payment_remaining;
  assertAmount(shares);
  assertAmount(payment);
  if (
    phaseName(state.intent.status) !== "Open" ||
    phaseName(state.info.phase) !== "Active" ||
    state.registration.finalized ||
    BigInt(Math.floor(Date.now() / 1_000)) > state.intent.expiry
  ) {
    throw new Error("This LP exit offer is no longer fillable");
  }
  const inputs = selectFundingInputs(wallet.notes, payment);
  const inputTotal = inputs[0].amount + inputs[1].amount;
  const id = actionId();
  const expiry = actionExpiry();
  const liquidityFields = await addressLimbs(liquidityVaultId);
  const liquidityPayload = poseidon2Hash([1011n, ...liquidityFields]);
  const exitFields = bytes32Limbs(hexToBytes(exitId));
  const paymentDestination = state.intent.payment_destination;
  const baseContext = await operationContextFields({
    networkDomain: wallet.config.networkDomain,
    vault: wallet.config.contracts.sharedVault,
    token: wallet.config.collateral.contract,
    verifierDomain: wallet.config.verifierDomain,
    action: 13n,
    actionId: id,
    publicAmount: 0n,
    market,
    expiry,
    bindingKind: 8n,
    bindingFields: Array<bigint>(24).fill(0n),
  });
  const domain = privateDomain(wallet.config, baseContext);
  const change = inputTotal - payment;
  const outputs: [PrivateOutput, PrivateOutput, PrivateOutput, PrivateOutput] = [
    createOutputNoteForRecipient({
      outputIndex: 0,
      domain,
      purpose: 1n,
      amount: payment,
      spendPublicKey: paymentDestination.spend_public_key,
      viewingPublicKey: [
        paymentDestination.viewing_public_key_x,
        paymentDestination.viewing_public_key_y,
      ],
      noteId: paymentDestination.note_id,
      blinding: paymentDestination.blinding,
      ephemeralSecret: randomPrivateScalar(),
      nonce: randomPrivateScalar(),
    }),
    createOutputNote({
      outputIndex: 1,
      domain,
      purpose: 3n,
      amount: shares,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      payloadHash: liquidityPayload,
      ...outputSecrets(),
    }),
    createOutputNote({
      outputIndex: 2,
      domain,
      purpose: change === 0n ? 0n : 1n,
      amount: change,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      ...outputSecrets(),
    }),
    createOutputNote({
      outputIndex: 3,
      domain,
      purpose: 0n,
      amount: 0n,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      ...outputSecrets(),
    }),
  ];
  if (
    outputs[0].commitment !==
      fieldFromBytes(paymentDestination.commitment)
  ) {
    throw new Error("The LP seller payment template is invalid");
  }
  const maximumStateAge = 300n;
  const bindingFields = Array<bigint>(24).fill(0n);
  [
    ...liquidityFields,
    ...exitFields,
    shares,
    payment,
    ...bytes32Limbs(paymentDestination.commitment),
    paymentDestination.spend_public_key,
    paymentDestination.viewing_public_key_x,
    paymentDestination.viewing_public_key_y,
    paymentDestination.note_id,
    paymentDestination.blinding,
    state.snapshot.state_version,
    state.snapshot.equity_if_yes,
    state.snapshot.equity_if_no,
    state.snapshot.conditional_lp_fees,
    state.snapshot.updated_at,
    maximumStateAge,
    state.info.state_version,
    state.registration.expiry,
  ].forEach((value, index) => {
    bindingFields[index] = value;
  });
  const contextFields = await operationContextFields({
    networkDomain: wallet.config.networkDomain,
    vault: wallet.config.contracts.sharedVault,
    token: wallet.config.collateral.contract,
    verifierDomain: wallet.config.verifierDomain,
    action: 13n,
    actionId: id,
    publicAmount: 0n,
    market,
    expiry,
    bindingKind: 8n,
    bindingFields,
  });
  const appended = appendFour(wallet.tree, outputs.map((output) =>
    output.commitment
  ) as [bigint, bigint, bigint, bigint]);
  const nullifiers = inputs.map((note) =>
    noteNullifier(note, note.spendSecret, 1n)
  ) as [bigint, bigint];
  const contextDigest = poseidon2Hash(contextFields);
  const witness = {
    action: 13n,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: appended.newRoot,
    nullifierCount: 2n,
    nullifier0: nullifiers[0],
    nullifier1: nullifiers[1],
    nullifier2: 0n,
    outputCommitment0: outputs[0].commitment,
    outputCommitment1: outputs[1].commitment,
    outputCommitment2: outputs[2].commitment,
    outputCommitment3: outputs[3].commitment,
    outputEnvelopeHash0: outputs[0].envelopeHash,
    outputEnvelopeHash1: outputs[1].envelopeHash,
    outputEnvelopeHash2: outputs[2].envelopeHash,
    outputEnvelopeHash3: outputs[3].envelopeHash,
    firstLeafIndex: BigInt(appended.firstLeafIndex),
    publicAmountSign: 0n,
    publicAmountMagnitude: 0n,
    contextFields,
    ...inputFields(inputs, wallet.tree),
    ...outputFields(outputs),
    middleRoot: appended.middleRoot,
    appendSiblings0: appended.siblings0,
    appendSiblings1: appended.siblings1,
  };
  onStatus?.("Generating the private LP replacement proof");
  const proved = await provePrivateAction(
    "exit_match",
    stringifyWitness(witness) as Record<string, unknown>,
  );
  assertSignals(proved.publicSignals, expectedFourOutputSignals({
    action: 13n,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: appended.newRoot,
    nullifiers,
    outputs,
    firstLeafIndex: appended.firstLeafIndex,
  }));
  onStatus?.("Relaying the private LP replacement");
  const hash = await relayPrivateContractCall(
    wallet.config.contracts.sharedVault,
    address,
    "match_liquidity_exit",
    {
      market,
      liquidity_vault: liquidityVaultId,
      exit_id: hexToBytes(exitId),
      shares,
      payment,
      market_state_version: state.snapshot.state_version,
      equity_if_yes: state.snapshot.equity_if_yes,
      equity_if_no: state.snapshot.equity_if_no,
      conditional_lp_fees: state.snapshot.conditional_lp_fees,
      state_updated_at: state.snapshot.updated_at,
      maximum_state_age: maximumStateAge,
      expected_version: state.info.state_version,
      action_id: hexToBytes(id),
      action_expiry: expiry,
      transition: transition(
        proved.proof,
        wallet.tree,
        appended.newRoot,
        nullifiers,
        outputs,
      ),
    },
  );
  return { hash, shares, payment };
}

async function nextOrderSequence(
  config: PrivateDeploymentConfig,
  address: string,
  market: string,
  epoch: PrivateEpoch,
): Promise<bigint> {
  const priorEpochs: PrivateEpoch[] = [];
  let priorNumber = epoch.epoch;
  while (epoch.accepted_count === 0 && priorNumber > 0n) {
    priorNumber--;
    const prior = await readPrivateContract<PrivateEpoch | undefined>(
      config.contracts.sharedVault,
      address,
      "epoch",
      { market, epoch_number: priorNumber },
    );
    if (!prior || prior.epoch !== priorNumber) {
      throw new Error("Prior private epoch is unavailable");
    }
    priorEpochs.push(prior);
    if (prior.last_sequence > 0n) break;
  }
  return nextPrivateOrderSequence(epoch, priorEpochs);
}

async function acceptedLeaf(
  market: string,
  epoch: bigint,
  record: PrivateOrderRecord,
  committeeEpoch: bigint,
): Promise<bigint> {
  return poseidon2Hash([
    1009n,
    ...await addressLimbs(market),
    epoch,
    record.sequence,
    ...bytes32Limbs(record.action_id),
    record.position_commitment,
    record.encrypted_order.yes_c1_x,
    record.encrypted_order.yes_c1_y,
    record.encrypted_order.yes_c2_x,
    record.encrypted_order.yes_c2_y,
    record.encrypted_order.no_c1_x,
    record.encrypted_order.no_c1_y,
    record.encrypted_order.no_c2_x,
    record.encrypted_order.no_c2_y,
    committeeEpoch,
  ]);
}

async function acceptedAppend(
  config: PrivateDeploymentConfig,
  address: string,
  market: string,
  epoch: PrivateEpoch,
  candidate: {
    sequence: bigint;
    actionId: Uint8Array;
    positionCommitment: bigint;
    encryptedOrder: EncryptedOrder;
  },
) {
  const leaves: bigint[] = [];
  if (epoch.accepted_count > 0) {
    for (
      let sequence = epoch.first_sequence;
      sequence <= epoch.last_sequence;
      sequence++
    ) {
      const record = await readPrivateContract<PrivateOrderRecord | undefined>(
        config.contracts.sharedVault,
        address,
        "order",
        { market, sequence },
      );
      if (!record) throw new Error("Private epoch order history is incomplete");
      leaves.push(await acceptedLeaf(
        market,
        epoch.epoch,
        record,
        epoch.committee_epoch,
      ));
    }
  }
  if (leaves.length !== epoch.accepted_count) {
    throw new Error("Private epoch order count is inconsistent");
  }
  const tree = merkleTree(leaves, ACCEPTED_TREE_LEVELS);
  if (tree.root !== epoch.accepted_root) {
    throw new Error("Private epoch accepted root failed local verification");
  }
  const leaf = await acceptedLeaf(
    market,
    epoch.epoch,
    {
      sequence: candidate.sequence,
      action_id: candidate.actionId,
      position_commitment: candidate.positionCommitment,
      encrypted_order: candidate.encryptedOrder,
    },
    epoch.committee_epoch,
  );
  return appendOne(tree, leaf);
}

function encryptedQuantity(
  committeePublicKey: Point,
  side: 0 | 1,
  quantity: bigint,
  yesRandomness: bigint,
  noRandomness: bigint,
): EncryptedOrder {
  const yesC1 = multiplyPoint(BABYJUB_BASE8, yesRandomness);
  const noC1 = multiplyPoint(BABYJUB_BASE8, noRandomness);
  const yesShared = multiplyPoint(committeePublicKey, 8n * yesRandomness);
  const noShared = multiplyPoint(committeePublicKey, 8n * noRandomness);
  const yesMessage = multiplyPoint(BABYJUB_BASE8, side === 1 ? quantity : 0n);
  const noMessage = multiplyPoint(BABYJUB_BASE8, side === 0 ? quantity : 0n);
  const yesC2 = addPoints(yesShared, yesMessage);
  const noC2 = addPoints(noShared, noMessage);
  return {
    yes_c1_x: yesC1[0],
    yes_c1_y: yesC1[1],
    yes_c2_x: yesC2[0],
    yes_c2_y: yesC2[1],
    no_c1_x: noC1[0],
    no_c1_y: noC1[1],
    no_c2_x: noC2[0],
    no_c2_y: noC2[1],
  };
}

function encryptedOrderFields(order: EncryptedOrder): bigint[] {
  return [
    order.yes_c1_x,
    order.yes_c1_y,
    order.yes_c2_x,
    order.yes_c2_y,
    order.no_c1_x,
    order.no_c1_y,
    order.no_c2_x,
    order.no_c2_y,
  ];
}

function orderBindingFields(binding: PrivateOrderBinding): bigint[] {
  return [
    binding.epoch,
    binding.market_state_version,
    binding.position_commitment,
    binding.lot_size,
    BigInt(binding.fee_bps),
    BigInt(binding.maximum_batch_size),
    BigInt(binding.minimum_side_count),
    binding.maximum_price_movement,
    ...bytes32Limbs(binding.rules_hash),
    binding.refund_at,
    binding.committee_epoch,
    ...bytes32Limbs(binding.committee_config_hash),
    binding.committee_public_key_x,
    binding.committee_public_key_y,
    poseidon2Hash([1016n, ...encryptedOrderFields(binding.encrypted_order)]),
    binding.old_accepted_root,
    binding.new_accepted_root,
    BigInt(binding.accepted_leaf_index),
    binding.sequence,
    0n,
    0n,
    0n,
  ];
}

export async function placePrivateOrder({
  address,
  market,
  side,
  quantity,
  onStatus,
}: {
  address: string;
  market: string;
  side: 0 | 1;
  quantity: bigint;
  onStatus?: (status: string) => void;
}): Promise<{
  hash: string;
  positionCommitment: bigint;
  positionNullifier: bigint;
  executionChangeNullifier: bigint;
  encryptionRandomness: bigint;
  epoch: bigint;
  sequence: bigint;
  positionBudget: bigint;
  lotSize: bigint;
}> {
  if (quantity <= 0n || quantity > 1_000n) {
    throw new Error("Private position quantity must be between 1 and 1,000");
  }
  onStatus?.("Reading the private market epoch");
  let wallet = await openPrivateWallet(address);
  const { registration, epoch } = await waitForPrivateBatch<
    PrivateMarketRegistration,
    PrivateEpoch
  >({
    read: async () => {
      const currentRegistration =
        await readPrivateContract<PrivateMarketRegistration | undefined>(
          wallet.config.contracts.sharedVault,
          address,
          "registration",
          { market },
        );
      if (!currentRegistration || currentRegistration.finalized) {
        return { registration: currentRegistration };
      }
      const currentEpoch =
        await readPrivateContract<PrivateEpoch | undefined>(
          wallet.config.contracts.sharedVault,
          address,
          "epoch",
          {
            market,
            epoch_number: currentRegistration.current_epoch,
          },
        );
      return {
        registration: currentRegistration,
        epoch: currentEpoch,
      };
    },
    onWait: () => onStatus?.("Waiting for the next private batch"),
  });
  const payout = ceilDiv(registration.lot_size * USDC_SCALE, Q32);
  const maximumFee = ceilDiv(
    registration.lot_size * BigInt(registration.fee_bps) * USDC_SCALE,
    Q32 * 40_000n,
  );
  const positionBudget = (payout + maximumFee) * quantity;
  assertAmount(positionBudget);
  const spendable = await privateWalletWithSpendableNote(
    address,
    positionBudget,
    onStatus,
  );
  wallet = spendable.wallet;
  const input = spendable.note;
  const inputTotal = input.amount;
  const sequence = await nextOrderSequence(
    wallet.config,
    address,
    market,
    epoch,
  );
  const id = actionId();
  const idBytes = hexToBytes(id);
  const encryptionRandomness = randomPrivateScalar();
  const noEncryptionRandomness = randomPrivateScalar();
  const encryptedOrder = encryptedQuantity(
    [
      epoch.committee_public_key_x,
      epoch.committee_public_key_y,
    ],
    side,
    quantity,
    encryptionRandomness,
    noEncryptionRandomness,
  );
  const marketFields = await addressLimbs(market);
  const positionPayload = poseidon2Hash([
    1010n,
    ...marketFields,
    epoch.epoch,
    ...bytes32Limbs(registration.rules_hash),
    registration.lot_size,
  ]);
  const staticContext = await operationContextFields({
    networkDomain: wallet.config.networkDomain,
    vault: wallet.config.contracts.sharedVault,
    token: wallet.config.collateral.contract,
    verifierDomain: wallet.config.verifierDomain,
    action: 3n,
    actionId: id,
    publicAmount: 0n,
    market,
    expiry: epoch.refund_at,
    bindingKind: 2n,
    bindingFields: Array<bigint>(24).fill(0n),
  });
  const domain = privateDomain(wallet.config, staticContext);
  const change = inputTotal - positionBudget;
  const outputs = [
    createOutputNote({
      outputIndex: 0,
      domain,
      purpose: change === 0n ? 0n : 1n,
      amount: change,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      ...outputSecrets(),
    }),
    createOutputNote({
      outputIndex: 1,
      domain,
      purpose: 2n,
      amount: positionBudget,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      payloadHash: positionPayload,
      privateData: [BigInt(side), sequence * 1_024n + quantity],
      ...outputSecrets(),
    }),
  ];
  const accepted = await acceptedAppend(
    wallet.config,
    address,
    market,
    epoch,
    {
      sequence,
      actionId: idBytes,
      positionCommitment: outputs[1].commitment,
      encryptedOrder,
    },
  );
  const binding = await readPrivateContract<PrivateOrderBinding>(
    wallet.config.contracts.sharedVault,
    address,
    "order_binding",
    {
      market,
      epoch_number: epoch.epoch,
      action_id: idBytes,
      position_commitment: outputs[1].commitment,
      encrypted_order: encryptedOrder,
    },
  );
  if (
    binding.sequence !== sequence ||
    binding.position_commitment !== outputs[1].commitment ||
    binding.old_accepted_root !== accepted.appendRoot ||
    binding.new_accepted_root !== accepted.newRoot ||
    binding.accepted_leaf_index !== accepted.leafIndex
  ) {
    throw new Error("Private order binding changed while the order was prepared");
  }
  const contextFields = await operationContextFields({
    networkDomain: wallet.config.networkDomain,
    vault: wallet.config.contracts.sharedVault,
    token: wallet.config.collateral.contract,
    verifierDomain: wallet.config.verifierDomain,
    action: 3n,
    actionId: id,
    publicAmount: 0n,
    market,
    expiry: binding.refund_at,
    bindingKind: 2n,
    bindingFields: orderBindingFields(binding),
  });
  const appended = appendPair(wallet.tree, [
    outputs[0].commitment,
    outputs[1].commitment,
  ]);
  const nullifiers = [noteNullifier(input, input.spendSecret, 1n)];
  const contextDigest = poseidon2Hash(contextFields);
  const witness = {
    action: 3n,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: appended.newRoot,
    nullifierCount: 1n,
    nullifier0: nullifiers[0],
    nullifier1: 0n,
    outputCommitment0: outputs[0].commitment,
    outputCommitment1: outputs[1].commitment,
    outputEnvelopeHash0: outputs[0].envelopeHash,
    outputEnvelopeHash1: outputs[1].envelopeHash,
    firstLeafIndex: BigInt(appended.firstLeafIndex),
    publicAmountSign: 0n,
    publicAmountMagnitude: 0n,
    contextFields,
    side: BigInt(side),
    quantity,
    yesEncryptionRandomness: encryptionRandomness,
    noEncryptionRandomness,
    ciphertext: encryptedOrderFields(encryptedOrder),
    acceptedSiblings: accepted.siblings,
    ...inputFields([input], wallet.tree),
    ...outputFields(outputs),
    appendSiblings: appended.siblings,
  };
  onStatus?.("Generating the private order proof");
  const proved = await provePrivateAction(
    "order",
    stringifyWitness(witness) as Record<string, unknown>,
  );
  assertSignals(proved.publicSignals, expectedActionSignals({
    action: 3n,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: appended.newRoot,
    nullifiers,
    outputs,
    firstLeafIndex: appended.firstLeafIndex,
    publicAmount: 0n,
  }));
  onStatus?.("Relaying the encrypted order");
  const hash = await relayPrivateContractCall(
    wallet.config.contracts.sharedVault,
    address,
    "accept_order",
    {
      market,
      epoch_number: binding.epoch,
      action_id: idBytes,
      position_commitment: outputs[1].commitment,
      encrypted_order: encryptedOrder,
      transition: transition(
        proved.proof,
        wallet.tree,
        appended.newRoot,
        nullifiers,
        outputs,
      ),
    },
  );
  return {
    hash,
    positionCommitment: outputs[1].commitment,
    positionNullifier: noteNullifier(
      {
        ...outputs[1],
      },
      wallet.keys.noteSpendSecret,
      4n,
    ),
    executionChangeNullifier: noteNullifier(
      {
        ...outputs[1],
      },
      wallet.keys.noteSpendSecret,
      3n,
    ),
    encryptionRandomness,
    epoch: epoch.epoch,
    sequence,
    positionBudget,
    lotSize: registration.lot_size,
  };
}

function enumName(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.tag === "string") return record.tag;
    const key = Object.keys(record)[0];
    if (key) return key;
  }
  throw new Error("Private contract returned an unknown enum value");
}

function quoteBindingFields(quote: PrivateBatchQuote): bigint[] {
  return [
    quote.state_version,
    BigInt(quote.batch_size),
    BigInt(quote.yes_count),
    BigInt(quote.no_count),
    quote.pre_yes_price,
    quote.post_yes_price,
    quote.yes_price,
    quote.no_price,
    quote.aggregate_market_charge,
    quote.yes_market_cost,
    quote.no_market_cost,
    quote.yes_charge_per_position,
    quote.no_charge_per_position,
    quote.rounding_contribution,
    quote.fee_per_position,
    quote.fee_escrow,
    quote.conditional_lp_fee,
    quote.conditional_protocol_fee,
  ];
}

function membershipRoot(
  leaf: bigint,
  siblings: bigint[],
  leafIndex: number,
): bigint {
  let root = leaf;
  let index = leafIndex;
  for (const sibling of siblings) {
    root = (index & 1) === 0
      ? merkleNode(root, sibling)
      : merkleNode(sibling, root);
    index = Math.floor(index / 2);
  }
  return root;
}

async function acceptedWitness(
  config: PrivateDeploymentConfig,
  address: string,
  market: string,
  epoch: PrivateEpoch,
  sequence: bigint,
) {
  const records: PrivateOrderRecord[] = [];
  for (
    let current = epoch.first_sequence;
    current <= epoch.last_sequence;
    current++
  ) {
    const record = await readPrivateContract<PrivateOrderRecord | undefined>(
      config.contracts.sharedVault,
      address,
      "order",
      { market, sequence: current },
    );
    if (!record || record.sequence !== current) {
      throw new Error("Private accepted-order history is incomplete");
    }
    records.push(record);
  }
  const leaves = await Promise.all(records.map((record) =>
    acceptedLeaf(market, epoch.epoch, record, epoch.committee_epoch)
  ));
  const tree = merkleTree(leaves, ACCEPTED_TREE_LEVELS);
  if (tree.root !== epoch.accepted_root) {
    throw new Error("Private accepted-order root failed local verification");
  }
  const leafIndex = Number(sequence - epoch.first_sequence);
  if (
    !Number.isSafeInteger(leafIndex) ||
    leafIndex < 0 ||
    leafIndex >= records.length
  ) {
    throw new Error("Private position sequence is outside its epoch");
  }
  return {
    record: records[leafIndex],
    leafIndex,
    siblings: membershipPath(tree, leafIndex),
  };
}

async function allocationWitness({
  market,
  epoch,
  batch,
  positionCommitment,
  sequence,
  side,
  quantity,
  encryptionRandomness,
}: {
  market: string;
  epoch: PrivateEpoch;
  batch: PrivateBatchRecord;
  positionCommitment: bigint;
  sequence: bigint;
  side: bigint;
  quantity: bigint;
  encryptionRandomness: bigint;
}) {
  const encrypted = await getPrivateAllocation(
    market,
    epoch.epoch,
    positionCommitment,
  );
  const sharedSecret = multiplyPoint(
    [epoch.committee_public_key_x, epoch.committee_public_key_y],
    8n * encryptionRandomness,
  );
  const witness = decryptAllocationWitness(
    encrypted.envelope.map(BigInt),
    sharedSecret,
  );
  const marketFields = await addressLimbs(market);
  if (
    witness.market[0] !== marketFields[0] ||
    witness.market[1] !== marketFields[1] ||
    witness.epoch !== epoch.epoch ||
    witness.sequence !== sequence ||
    witness.positionCommitment !== positionCommitment ||
    witness.side !== side ||
    witness.siblings.length !== ACCEPTED_TREE_LEVELS
  ) {
    throw new Error("Private allocation witness does not match this position");
  }
  const leaf = poseidon2Hash([
    1012n,
    ...marketFields,
    epoch.epoch,
    sequence,
    positionCommitment,
    side,
    witness.charge,
    witness.fee,
    witness.payout,
  ]);
  if (
    membershipRoot(leaf, witness.siblings, witness.leafIndex) !==
    batch.allocation_root
  ) {
    throw new Error("Private allocation witness failed local root verification");
  }
  const expectedChargePerUnit = side === 1n
    ? batch.quote.yes_charge_per_position
    : batch.quote.no_charge_per_position;
  if (
    witness.charge !== expectedChargePerUnit * quantity ||
    witness.fee !== batch.quote.fee_per_position * quantity
  ) {
    throw new Error("Private allocation witness does not match the batch quote");
  }
  return witness;
}

function positionInputFields(
  note: OwnedIndexedNote,
  tree: PrivateTree,
) {
  return {
    inPurpose: note.purpose,
    inAmount: note.amount,
    inSpendSecret: note.spendSecret,
    inViewingPublicKey: note.viewingPublicKey,
    inNoteId: note.noteId,
    inPayloadHash: note.payloadHash,
    inPrivateData: note.privateData,
    inBlinding: note.blinding,
    inLeafIndex: BigInt(note.leafIndex),
    inSiblings: membershipPath(tree, note.leafIndex),
  };
}

export type PrivatePositionAction = "recover-change" | "claim" | "refund";

export type PrivatePositionChainState = {
  orderStatus: string;
  epochPhase: string;
  outcome: "LIVE" | "YES" | "NO" | "VOID";
  changeRecovered: boolean;
  terminalSpent: boolean;
  action: PrivatePositionAction | null;
  changeAmount: bigint;
  terminalAmount: bigint;
};

export async function getPrivatePositionState({
  address,
  market,
  epochNumber,
  sequence,
  positionCommitment,
  side,
  quantity,
  positionBudget,
  executionChangeNullifier,
  terminalNullifier,
}: {
  address: string;
  market: string;
  epochNumber: bigint;
  sequence: bigint;
  positionCommitment: bigint;
  side: 0 | 1;
  quantity: bigint;
  positionBudget: bigint;
  executionChangeNullifier: bigint;
  terminalNullifier: bigint;
}): Promise<PrivatePositionChainState> {
  const config = await getPrivateConfig();
  const [registration, epoch, order, accounting, changeRecovered, terminalSpent] =
    await Promise.all([
      readPrivateContract<PrivateMarketRegistration | undefined>(
        config.contracts.sharedVault,
        address,
        "registration",
        { market },
      ),
      readPrivateContract<PrivateEpoch | undefined>(
        config.contracts.sharedVault,
        address,
        "epoch",
        { market, epoch_number: epochNumber },
      ),
      readPrivateContract<PrivateOrderRecord | undefined>(
        config.contracts.sharedVault,
        address,
        "order",
        { market, sequence },
      ),
      readPrivateContract<PrivateMarketAccounting | undefined>(
        config.contracts.sharedVault,
        address,
        "accounting",
        { market },
      ),
      readPrivateContract<boolean>(
        config.contracts.sharedVault,
        address,
        "is_spent",
        { nullifier: executionChangeNullifier },
      ),
      readPrivateContract<boolean>(
        config.contracts.sharedVault,
        address,
        "is_spent",
        { nullifier: terminalNullifier },
      ),
    ]);
  if (
    !registration ||
    !epoch ||
    !order ||
    !accounting ||
    epoch.epoch !== epochNumber ||
    order.sequence !== sequence ||
    order.position_commitment !== positionCommitment
  ) {
    throw new Error("Private position state does not match the activity record");
  }
  if (quantity <= 0n || quantity > 1_000n) {
    throw new Error("Private position quantity is invalid");
  }
  const orderStatus = enumName(order.status);
  const epochPhase = enumName(epoch.phase);
  const settlement = enumName(accounting.finalized_outcome);
  const outcome = settlement === "Yes"
    ? "YES"
    : settlement === "No"
      ? "NO"
      : settlement === "Void"
        ? "VOID"
        : "LIVE";
  let changeAmount = 0n;
  let terminalAmount = 0n;
  if (orderStatus === "Executed") {
    const batch = await readPrivateContract<PrivateBatchRecord | undefined>(
      config.contracts.sharedVault,
      address,
      "batch",
      { market, epoch_number: epochNumber },
    );
    if (!batch) throw new Error("Private batch record is unavailable");
    const chargePerUnit = side === 1
      ? batch.quote.yes_charge_per_position
      : batch.quote.no_charge_per_position;
    const amounts = calculateExecutedPositionAmounts({
      positionBudget,
      quantity,
      chargePerUnit,
      feePerUnit: batch.quote.fee_per_position,
      payoutPerUnit: ceilDiv(registration.lot_size * USDC_SCALE, Q32),
      winner:
        (side === 1 && outcome === "YES") ||
        (side === 0 && outcome === "NO"),
      voided: outcome === "VOID",
    });
    changeAmount = amounts.changeAmount;
    terminalAmount = amounts.terminalAmount;
  } else if (epochPhase === "Refundable") {
    terminalAmount = positionBudget;
  }
  const action = terminalSpent
    ? null
    : orderStatus === "Pending" && epochPhase === "Refundable"
      ? "refund"
      : orderStatus === "Executed" && !changeRecovered
        ? "recover-change"
        : outcome === "VOID"
          ? "refund"
          : (
              (side === 1 && outcome === "YES") ||
              (side === 0 && outcome === "NO")
            )
            ? "claim"
            : null;
  return {
    orderStatus,
    epochPhase,
    outcome,
    changeRecovered,
    terminalSpent,
    action,
    changeAmount,
    terminalAmount,
  };
}

export async function runPrivatePositionAction({
  address,
  market,
  epochNumber,
  sequence,
  positionCommitment,
  side,
  encryptionRandomness,
  action,
  onStatus,
}: {
  address: string;
  market: string;
  epochNumber: bigint;
  sequence: bigint;
  positionCommitment: bigint;
  side: 0 | 1;
  encryptionRandomness: bigint;
  action: PrivatePositionAction;
  onStatus?: (status: string) => void;
}): Promise<{ hash: string; amount: bigint }> {
  onStatus?.("Reading the private position");
  const wallet = await openPrivateWallet(address);
  const note = wallet.notes.find((candidate) =>
    candidate.purpose === 2n &&
    candidate.commitment === positionCommitment
  );
  if (!note) {
    throw new Error("The private position note is unavailable or already settled");
  }
  if (
    note.privateData[0] !== BigInt(side) ||
    note.privateData[1] / 1_024n !== sequence
  ) {
    throw new Error("The encrypted activity record does not match the position note");
  }
  const [registration, epoch, accounting] = await Promise.all([
    readPrivateContract<PrivateMarketRegistration | undefined>(
      wallet.config.contracts.sharedVault,
      address,
      "registration",
      { market },
    ),
    readPrivateContract<PrivateEpoch | undefined>(
      wallet.config.contracts.sharedVault,
      address,
      "epoch",
      { market, epoch_number: epochNumber },
    ),
    readPrivateContract<PrivateMarketAccounting | undefined>(
      wallet.config.contracts.sharedVault,
      address,
      "accounting",
      { market },
    ),
  ]);
  if (!registration || !epoch || !accounting || epoch.epoch !== epochNumber) {
    throw new Error("Private market settlement state is unavailable");
  }
  const accepted = await acceptedWitness(
    wallet.config,
    address,
    market,
    epoch,
    sequence,
  );
  if (accepted.record.position_commitment !== positionCommitment) {
    throw new Error("Private position commitment does not match its order");
  }
  const quantity = note.privateData[1] % 1_024n;
  if (quantity <= 0n || quantity > 1_000n) {
    throw new Error("Private position quantity is invalid");
  }
  const epochPhase = enumName(epoch.phase);
  const outcomeName = enumName(accounting.finalized_outcome);
  const outcome = outcomeName === "Yes"
    ? 1n
    : outcomeName === "No"
      ? 2n
      : outcomeName === "Void"
        ? 3n
        : 0n;
  const acceptedMode = action === "refund" && epochPhase === "Refundable";
  if (
    (action === "recover-change" && epochPhase !== "Executed") ||
    (action === "claim" && ![1n, 2n].includes(outcome)) ||
    (
      action === "refund" &&
      !acceptedMode &&
      !(epochPhase === "Executed" && outcome === 3n)
    )
  ) {
    throw new Error("This private position action is not currently available");
  }
  const batch = acceptedMode
    ? undefined
    : await readPrivateContract<PrivateBatchRecord | undefined>(
        wallet.config.contracts.sharedVault,
        address,
        "batch",
        { market, epoch_number: epochNumber },
      );
  if (!acceptedMode && !batch) {
    throw new Error("Private batch allocation is unavailable");
  }
  const allocation = batch
    ? await allocationWitness({
        market,
        epoch,
        batch,
        positionCommitment,
        sequence,
        side: BigInt(side),
        quantity,
        encryptionRandomness,
      })
    : undefined;
  const nullifierDomain = action === "recover-change" ? 3n : 4n;
  if (note.spentDomains.includes(nullifierDomain)) {
    throw new Error("This private position action was already completed");
  }
  const outputAmount = action === "recover-change"
    ? note.amount - allocation!.charge - allocation!.fee
    : action === "claim"
      ? (
          (side === 1 && outcome === 1n) ||
          (side === 0 && outcome === 2n)
        )
        ? allocation!.payout
        : 0n
      : acceptedMode
        ? note.amount
        : allocation!.charge + allocation!.fee;
  if (outputAmount < 0n || outputAmount > MAX_NOTE_AMOUNT) {
    throw new Error("Private position output amount is invalid");
  }
  const proofAction = action === "recover-change"
    ? 9n
    : action === "claim"
      ? 4n
      : 5n;
  const id = actionId();
  const expiry = actionExpiry();
  const bindingFields = acceptedMode
    ? [
        epoch.epoch,
        epoch.accepted_root,
        ...Array<bigint>(22).fill(0n),
      ]
    : [
        epoch.epoch,
        batch!.allocation_root,
        action === "recover-change" ? 0n : outcome,
        ...quoteBindingFields(batch!.quote),
        registration.lot_size,
        0n,
        0n,
      ];
  const contextFields = await operationContextFields({
    networkDomain: wallet.config.networkDomain,
    vault: wallet.config.contracts.sharedVault,
    token: wallet.config.collateral.contract,
    verifierDomain: wallet.config.verifierDomain,
    action: proofAction,
    actionId: id,
    publicAmount: 0n,
    market,
    expiry,
    bindingKind: acceptedMode ? 3n : 4n,
    bindingFields,
  });
  const domain = privateDomain(wallet.config, contextFields);
  const outputPurpose = action === "recover-change"
    ? outputAmount === 0n ? 0n : 1n
    : action === "claim"
      ? outputAmount === 0n ? 0n : 7n
      : 6n;
  const outputs = [
    createOutputNote({
      outputIndex: 0,
      domain,
      purpose: outputPurpose,
      amount: outputAmount,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      ...outputSecrets(),
    }),
    createOutputNote({
      outputIndex: 1,
      domain,
      purpose: 0n,
      amount: 0n,
      spendSecret: wallet.keys.noteSpendSecret,
      viewingSecret: wallet.keys.noteViewingSecret,
      ...outputSecrets(),
    }),
  ];
  const appended = appendPair(wallet.tree, [
    outputs[0].commitment,
    outputs[1].commitment,
  ]);
  const nullifier = noteNullifier(
    note,
    note.spendSecret,
    nullifierDomain,
  );
  const contextDigest = poseidon2Hash(contextFields);
  const witness = {
    action: proofAction,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: appended.newRoot,
    nullifierCount: 1n,
    nullifier0: nullifier,
    nullifier1: 0n,
    outputCommitment0: outputs[0].commitment,
    outputCommitment1: outputs[1].commitment,
    outputEnvelopeHash0: outputs[0].envelopeHash,
    outputEnvelopeHash1: outputs[1].envelopeHash,
    firstLeafIndex: BigInt(appended.firstLeafIndex),
    publicAmountSign: 0n,
    publicAmountMagnitude: 0n,
    contextFields,
    acceptedActionId: bytes32Limbs(accepted.record.action_id),
    acceptedCiphertext: encryptedOrderFields(accepted.record.encrypted_order),
    acceptedCommitteeEpoch: epoch.committee_epoch,
    acceptedLeafIndex: BigInt(accepted.leafIndex),
    acceptedSiblings: accepted.siblings,
    allocationLeafIndex: BigInt(allocation?.leafIndex ?? 0),
    allocationSiblings: allocation?.siblings ??
      Array<bigint>(ACCEPTED_TREE_LEVELS).fill(0n),
    ...positionInputFields(note, wallet.tree),
    ...outputFields(outputs),
    appendSiblings: appended.siblings,
  };
  onStatus?.("Generating the private settlement proof");
  const artifact = action === "recover-change"
    ? "execution_change"
    : action === "claim"
      ? "claim"
      : "refund";
  const proved = await provePrivateAction(
    artifact,
    stringifyWitness(witness) as Record<string, unknown>,
  );
  assertSignals(proved.publicSignals, expectedActionSignals({
    action: proofAction,
    contextDigest,
    membershipRoot: wallet.tree.root,
    appendRoot: wallet.tree.root,
    newRoot: appended.newRoot,
    nullifiers: [nullifier],
    outputs,
    firstLeafIndex: appended.firstLeafIndex,
    publicAmount: 0n,
  }));
  onStatus?.("Relaying the unlinkable settlement");
  const method = action === "recover-change"
    ? "recover_execution_change"
    : action === "claim"
      ? "claim_position"
      : "refund_order";
  const hash = await relayPrivateContractCall(
    wallet.config.contracts.sharedVault,
    address,
    method,
    {
      market,
      epoch_number: epochNumber,
      action_id: hexToBytes(id),
      action_expiry: expiry,
      transition: transition(
        proved.proof,
        wallet.tree,
        appended.newRoot,
        [nullifier],
        outputs,
      ),
    },
  );
  return { hash, amount: outputAmount };
}

export function privateBalanceNotes(
  notes: Array<OwnedPrivateNote>,
): bigint {
  return notes
    .filter((note) => [1n, 6n, 7n].includes(note.purpose))
    .reduce((total, note) => total + note.amount, 0n);
}
