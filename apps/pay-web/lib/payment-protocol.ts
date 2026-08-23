import { Address, StrKey } from "@stellar/stellar-sdk";
import { base64UrlToBytes, bytesToBase64Url, type PaymentDeployment } from "@moros/payments-client";
import { poseidon2Hash } from "@zkpassport/poseidon2";

export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const PAYMENT_CODE_BODY_BYTES = 212;
const PAYMENT_CODE_CHECKSUM_DOMAIN = new TextEncoder().encode("moros/payment-code/checksum/v1");
const TREE_LEVELS = 20;

export type PaymentIdentityPublic = {
  spendPublicKey: bigint;
  viewingPublicKeyX: bigint;
  viewingPublicKeyY: bigint;
};

export type PaymentNote = {
  purpose: bigint;
  amount: bigint;
  spendSecret: bigint;
  viewingPublicKey: [bigint, bigint];
  noteId: bigint;
  payloadHash: bigint;
  privateData: [bigint, bigint];
  blinding: bigint;
  commitment: bigint;
  nullifier: bigint;
  leafIndex: number;
};

export type PaymentOutput = {
  purpose: bigint;
  amount: bigint;
  spendPublicKey: bigint;
  viewingPublicKey: [bigint, bigint];
  noteId: bigint;
  payloadHash: bigint;
  privateData: [bigint, bigint];
  blinding: bigint;
  ephemeralSecret: bigint;
  nonce: bigint;
  commitment: bigint;
  envelopeHash: bigint;
  envelope: bigint[];
  encrypted: Uint8Array;
};

export function bigIntFromBytes(value: Uint8Array, endian: "be" | "le" = "be"): bigint {
  const bytes = endian === "le" ? Uint8Array.from(value).reverse() : value;
  let result = 0n;
  for (const byte of bytes) result = (result << 8n) | BigInt(byte);
  return result;
}

export function bigIntBytes(value: bigint, endian: "be" | "le" = "be"): Uint8Array {
  if (value < 0n || value >= 1n << 256n) throw new Error("Payment scalar is out of range.");
  const bytes = new Uint8Array(32);
  let remaining = value;
  for (let index = 31; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
  return endian === "le" ? Uint8Array.from(bytes).reverse() : bytes;
}

export function fieldBytes(value: bigint): Uint8Array {
  if (value < 0n || value >= FIELD) throw new Error("Payment field is not canonical.");
  return bigIntBytes(value);
}

export function concatBytes(...values: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(values.reduce((total, value) => total + value.length, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

export function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomField(modulus = FIELD): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return (bigIntFromBytes(bytes) % (modulus - 1n)) + 1n;
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer));
}

function limbs(value: Uint8Array): [bigint, bigint] {
  if (value.length !== 32) throw new Error("Payment domain value must contain 32 bytes.");
  return [bigIntFromBytes(value.slice(0, 16)), bigIntFromBytes(value.slice(16))];
}

async function addressLimbs(value: string): Promise<[bigint, bigint]> {
  return limbs(await sha256(new Uint8Array(new Address(value).toScVal().toXDR())));
}

export async function contextFields(input: {
  deployment: PaymentDeployment;
  networkDomain: Uint8Array;
  verifierDomain: Uint8Array;
  action: 0 | 1 | 2;
  actionId: Uint8Array;
  expiry: number;
  publicAccount?: string;
  publicAmount: bigint;
  outputCount: number;
  feeEpoch: bigint;
  relayFee: bigint;
  protocolFee: bigint;
  relayIdentity: PaymentIdentityPublic;
  protocolIdentity: PaymentIdentityPublic;
  attachmentHash: bigint;
  relayQuoteDigest: bigint;
}): Promise<bigint[]> {
  const publicAmountSign = input.publicAmount < 0n ? 1n : 0n;
  const publicAmountMagnitude = input.publicAmount < 0n ? -input.publicAmount : input.publicAmount;
  const publicAccount = input.publicAccount
    ? await addressLimbs(input.publicAccount)
    : [0n, 0n] as [bigint, bigint];
  const fields = [
    1n,
    BigInt(input.action),
    1n,
    ...limbs(input.networkDomain),
    ...await addressLimbs(input.deployment.vault),
    ...await addressLimbs(input.deployment.usdcContract),
    ...limbs(input.verifierDomain),
    ...limbs(input.actionId),
    BigInt(input.expiry),
    ...publicAccount,
    publicAmountSign,
    publicAmountMagnitude,
    BigInt(input.outputCount),
    BigInt(input.outputCount),
    0n,
    input.feeEpoch,
    input.relayFee,
    input.protocolFee,
    input.relayIdentity.spendPublicKey,
    input.relayIdentity.viewingPublicKeyX,
    input.relayIdentity.viewingPublicKeyY,
    input.protocolIdentity.spendPublicKey,
    input.protocolIdentity.viewingPublicKeyX,
    input.protocolIdentity.viewingPublicKeyY,
    input.attachmentHash,
    input.relayQuoteDigest,
  ];
  if (fields.length !== 32) throw new Error("Payment context is malformed.");
  return fields;
}

export function paymentNoteDomain(context: bigint[]): bigint {
  return poseidon2Hash([1101n, context[3], context[4], context[5], context[6], context[7], context[8], context[2]]);
}

export function noteNullifier(note: Pick<PaymentNote, "commitment" | "noteId" | "spendSecret">, domain: bigint): bigint {
  return poseidon2Hash([1004n, domain, 1n, note.commitment, note.spendSecret, note.noteId]);
}

export function merkleNode(left: bigint, right: bigint): bigint {
  return poseidon2Hash([1005n, left, right]);
}

export function merkleTree(commitments: bigint[], levels = TREE_LEVELS) {
  const zeros = [0n];
  for (let level = 0; level < levels; level += 1) zeros.push(merkleNode(zeros[level], zeros[level]));
  const layers: bigint[][] = [[...commitments]];
  for (let level = 0; level < levels; level += 1) {
    const current = layers[level];
    const next: bigint[] = [];
    for (let index = 0; index < current.length; index += 2) {
      next.push(merkleNode(current[index], current[index + 1] ?? zeros[level]));
    }
    if (next.length === 0) next.push(zeros[level + 1]);
    layers.push(next);
  }
  return {
    root: layers[levels][0],
    path(index: number): bigint[] {
      if (!Number.isSafeInteger(index) || index < 0 || index >= commitments.length) {
        throw new Error("Payment note is outside the commitment tree.");
      }
      const siblings: bigint[] = [];
      let position = index;
      for (let level = 0; level < levels; level += 1) {
        siblings.push(layers[level][position ^ 1] ?? zeros[level]);
        position = Math.floor(position / 2);
      }
      return siblings;
    },
  };
}

export function selectPaymentNotes(notes: PaymentNote[], required: bigint): PaymentNote[] {
  if (required <= 0n) throw new Error("Payment amount must be positive.");
  const candidates = notes.filter((note) => note.amount > 0n).sort((left, right) => (
    left.amount < right.amount ? -1 : left.amount > right.amount ? 1 : left.leafIndex - right.leafIndex
  ));
  let best: PaymentNote[] | null = null;
  let bestTotal = 0n;
  const consider = (selected: PaymentNote[]) => {
    const total = selected.reduce((sum, note) => sum + note.amount, 0n);
    if (total < required) return;
    if (!best || total < bestTotal || (total === bestTotal && selected.length < best.length)) {
      best = selected;
      bestTotal = total;
    }
  };
  for (const candidate of candidates) consider([candidate]);
  let left = 0;
  let right = candidates.length - 1;
  while (left < right) {
    const pair = [candidates[left], candidates[right]];
    const total = pair[0].amount + pair[1].amount;
    if (total >= required) {
      consider(pair);
      right -= 1;
    } else {
      left += 1;
    }
  }
  if (candidates.length >= 4) consider(candidates.slice(-4));
  if (!best) throw new Error("Your private balance is split across too many notes for this payment.");
  return best;
}

export function paymentIdentityFromCode(code: string): PaymentIdentityPublic {
  if (!code.startsWith("moros_pay_")) throw new Error("Invalid Moros payment code.");
  const bytes = base64UrlToBytes(code.slice("moros_pay_".length));
  if (bytes.length !== 216) throw new Error("Invalid Moros payment code.");
  return {
    spendPublicKey: bigIntFromBytes(bytes.slice(52, 84), "le"),
    viewingPublicKeyX: bigIntFromBytes(bytes.slice(84, 116), "le"),
    viewingPublicKeyY: bigIntFromBytes(bytes.slice(116, 148), "le"),
  };
}

export async function paymentCodeForIdentity(
  templateCode: string,
  identity: PaymentIdentityPublic,
): Promise<string> {
  const source = base64UrlToBytes(templateCode.slice("moros_pay_".length));
  if (source.length !== 216) throw new Error("Invalid payment identity template.");
  const bytes = Uint8Array.from(source);
  bytes.set(bigIntBytes(identity.spendPublicKey, "le"), 52);
  bytes.set(bigIntBytes(identity.viewingPublicKeyX, "le"), 84);
  bytes.set(bigIntBytes(identity.viewingPublicKeyY, "le"), 116);
  const first = await sha256(concatBytes(PAYMENT_CODE_CHECKSUM_DOMAIN, bytes.slice(0, PAYMENT_CODE_BODY_BYTES)));
  const second = await sha256(first);
  bytes.set(second.slice(0, 4), PAYMENT_CODE_BODY_BYTES);
  return `moros_pay_${bytesToBase64Url(bytes)}`;
}

export function paymentCodeNetwork(deployment: Pick<PaymentDeployment, "network">): number {
  return deployment.network === "stellar:pubnet" ? 2 : 1;
}

export function contractBytes(contract: string): Uint8Array {
  return StrKey.decodeContract(contract);
}

export async function createPaymentOutput(input: {
  recipientCode: string;
  outputIndex: number;
  noteDomain: bigint;
  amount: bigint;
  payloadHash?: bigint;
  privateData?: [bigint, bigint];
}): Promise<PaymentOutput> {
  const core = await import("@moros/payments-crypto-web");
  await core.default();
  const noteId = randomField();
  const payloadHash = input.payloadHash ?? 0n;
  const privateData = input.privateData ?? [0n, 0n];
  const blinding = randomField();
  const ephemeralSecret = randomField(1n << 248n);
  const nonce = randomField();
  const encrypted = core.create_payment_output(
    input.recipientCode,
    input.outputIndex,
    fieldBytes(input.noteDomain),
    input.amount.toString(),
    fieldBytes(noteId),
    fieldBytes(payloadHash),
    concatBytes(fieldBytes(privateData[0]), fieldBytes(privateData[1])),
    fieldBytes(blinding),
    bigIntBytes(ephemeralSecret, "le"),
    fieldBytes(nonce),
  );
  try {
    const recipient = paymentIdentityFromCode(input.recipientCode);
    const encryptedBytes = encrypted.envelope;
    const envelope = Array.from({ length: 15 }, (_, index) => (
      bigIntFromBytes(encryptedBytes.slice(index * 32, (index + 1) * 32))
    ));
    return {
      purpose: 1n,
      amount: input.amount,
      spendPublicKey: recipient.spendPublicKey,
      viewingPublicKey: [recipient.viewingPublicKeyX, recipient.viewingPublicKeyY],
      noteId,
      payloadHash,
      privateData,
      blinding,
      ephemeralSecret,
      nonce,
      commitment: bigIntFromBytes(encrypted.commitment),
      envelopeHash: bigIntFromBytes(encrypted.envelope_hash),
      envelope,
      encrypted: encryptedBytes,
    };
  } finally {
    encrypted.free();
  }
}

export async function createPaymentAttachment(memo: string, recipientCode: string) {
  const core = await import("@moros/payments-crypto-web");
  await core.default();
  const encrypted = core.create_payment_attachment(
    memo,
    recipientCode,
    bigIntBytes(randomField(1n << 248n), "le"),
    fieldBytes(randomField()),
  );
  try {
    const bytes = encrypted.bytes;
    const fields = Array.from({ length: 4 }, (_, index) => (
      bigIntFromBytes(bytes.slice(index * 32, (index + 1) * 32))
    ));
    const hash = bigIntFromBytes(encrypted.hash);
    if (poseidon2Hash([1110n, ...fields]) !== hash) throw new Error("Payment attachment hash mismatch.");
    return { bytes, fields, hash };
  } finally {
    encrypted.free();
  }
}

export function outputWitness(outputs: PaymentOutput[]) {
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

export function noteWitness(notes: PaymentNote[], tree: ReturnType<typeof merkleTree>) {
  return {
    inPurpose: notes.map((note) => note.purpose),
    inAmount: notes.map((note) => note.amount),
    inSpendSecret: notes.map((note) => note.spendSecret),
    inViewingPublicKey: notes.map((note) => note.viewingPublicKey),
    inNoteId: notes.map((note) => note.noteId),
    inPayloadHash: notes.map((note) => note.payloadHash),
    inPrivateData: notes.map((note) => note.privateData),
    inBlinding: notes.map((note) => note.blinding),
    inLeafIndex: notes.map((note) => BigInt(note.leafIndex)),
    inSiblings: notes.map((note) => tree.path(note.leafIndex)),
  };
}

export const PAYMENT_PUBLIC_SIGNALS = [
  "action", "contextDigest", "membershipRoot", "nullifierCount",
  "nullifier0", "nullifier1", "nullifier2", "nullifier3", "outputCount",
  "outputCommitment0", "outputCommitment1", "outputCommitment2", "outputCommitment3",
  "outputEnvelopeHash0", "outputEnvelopeHash1", "outputEnvelopeHash2", "outputEnvelopeHash3",
  "attachmentHash", "publicAmountSign", "publicAmountMagnitude",
] as const;

export function publicFields(input: {
  action: 0 | 1 | 2;
  context: bigint[];
  membershipRoot: bigint;
  nullifiers: bigint[];
  outputs: PaymentOutput[];
  attachmentHash: bigint;
  publicAmount: bigint;
}) {
  const padded = (values: bigint[]) => [...values, ...Array(4 - values.length).fill(0n)] as bigint[];
  const nullifiers = padded(input.nullifiers);
  const commitments = padded(input.outputs.map((output) => output.commitment));
  const hashes = padded(input.outputs.map((output) => output.envelopeHash));
  return {
    action: BigInt(input.action),
    contextDigest: poseidon2Hash(input.context),
    membershipRoot: input.membershipRoot,
    nullifierCount: BigInt(input.nullifiers.length),
    nullifier0: nullifiers[0],
    nullifier1: nullifiers[1],
    nullifier2: nullifiers[2],
    nullifier3: nullifiers[3],
    outputCount: BigInt(input.outputs.length),
    outputCommitment0: commitments[0],
    outputCommitment1: commitments[1],
    outputCommitment2: commitments[2],
    outputCommitment3: commitments[3],
    outputEnvelopeHash0: hashes[0],
    outputEnvelopeHash1: hashes[1],
    outputEnvelopeHash2: hashes[2],
    outputEnvelopeHash3: hashes[3],
    attachmentHash: input.attachmentHash,
    publicAmountSign: input.publicAmount < 0n ? 1n : 0n,
    publicAmountMagnitude: input.publicAmount < 0n ? -input.publicAmount : input.publicAmount,
  };
}

export function transition(input: {
  action: 0 | 1 | 2;
  circuit: string;
  fields: ReturnType<typeof publicFields>;
  proof: Uint8Array;
  outputs: PaymentOutput[];
  attachment?: Uint8Array;
}) {
  const actionTag = input.action === 0 ? "Deposit" : input.action === 1 ? "Transfer" : "Withdraw";
  return {
    statement: {
      action: { tag: actionTag },
      circuit: { tag: input.circuit },
      context_digest: input.fields.contextDigest,
      membership_root: input.fields.membershipRoot,
      input_nullifiers: [input.fields.nullifier0, input.fields.nullifier1, input.fields.nullifier2, input.fields.nullifier3]
        .slice(0, Number(input.fields.nullifierCount)),
      output_commitments: input.outputs.map((output) => output.commitment),
      output_envelope_hashes: input.outputs.map((output) => output.envelopeHash),
      attachment_hash: input.fields.attachmentHash,
      public_amount: input.fields.publicAmountSign === 1n
        ? -input.fields.publicAmountMagnitude
        : input.fields.publicAmountMagnitude,
    },
    proof: input.proof,
    encrypted_outputs: input.outputs.map((output) => output.encrypted),
    attachment: input.attachment ?? new Uint8Array(),
  };
}

export async function relayQuoteDigest(input: {
  deployment: PaymentDeployment;
  networkDomain: Uint8Array;
  actionId: Uint8Array;
  quoteId: Uint8Array;
  signingKey: Uint8Array;
  fee: bigint;
  expiry: bigint;
  identity: PaymentIdentityPublic;
}): Promise<bigint> {
  return poseidon2Hash([
    1111n,
    ...limbs(input.networkDomain),
    ...await addressLimbs(input.deployment.vault),
    ...await addressLimbs(input.deployment.usdcContract),
    ...limbs(input.actionId),
    ...limbs(input.quoteId),
    ...limbs(input.signingKey),
    input.fee,
    input.expiry,
    input.identity.spendPublicKey,
    input.identity.viewingPublicKeyX,
    input.identity.viewingPublicKeyY,
  ]);
}
