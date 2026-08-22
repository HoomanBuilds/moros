import { poseidon2Hash } from "@zkpassport/poseidon2";

const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const A = 168700n;
const D = 168696n;
const BASE8 = [
  5299619240641551281634865583518297030282874472190772894086521144482721001553n,
  16950150798460657717958625567821834550301663161624707787222815936182638968203n,
];
const TREE_LEVELS = 20;

function mod(value) {
  const reduced = value % FIELD;
  return reduced < 0n ? reduced + FIELD : reduced;
}

function power(base, exponent) {
  let result = 1n;
  let current = mod(base);
  let remaining = exponent;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = mod(result * current);
    current = mod(current * current);
    remaining >>= 1n;
  }
  return result;
}

function inverse(value) {
  if (mod(value) === 0n) throw new Error("division by zero");
  return power(value, FIELD - 2n);
}

function addPoints(left, right) {
  const [x1, y1] = left;
  const [x2, y2] = right;
  const product = mod(x1 * x2 * y1 * y2);
  return [
    mod((x1 * y2 + y1 * x2) * inverse(1n + D * product)),
    mod((y1 * y2 - A * x1 * x2) * inverse(1n - D * product)),
  ];
}

function multiplyPoint(point, scalar) {
  let result = [0n, 1n];
  let addend = point;
  let remaining = scalar;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = addPoints(result, addend);
    addend = addPoints(addend, addend);
    remaining >>= 1n;
  }
  return result;
}

function spendPublicKey(secret) {
  return poseidon2Hash([1002n, secret]);
}

function viewingPublicKey(secret) {
  return multiplyPoint(BASE8, secret);
}

function paymentNoteDomain(context) {
  return poseidon2Hash([
    1101n,
    context[3],
    context[4],
    context[5],
    context[6],
    context[7],
    context[8],
    context[2],
  ]);
}

function noteCommitment(note) {
  return poseidon2Hash([
    1003n,
    note.noteDomain,
    note.purpose,
    note.amount,
    note.spendPublicKey,
    note.viewingPublicKey[0],
    note.viewingPublicKey[1],
    note.noteId,
    note.payloadHash,
    note.privateData[0],
    note.privateData[1],
    note.blinding,
  ]);
}

function noteNullifier(note, spendSecret) {
  return poseidon2Hash([
    1004n,
    note.noteDomain,
    1n,
    note.commitment,
    spendSecret,
    note.noteId,
  ]);
}

function outputNote({
  outputIndex,
  noteDomain,
  amount,
  spendSecret,
  viewingSecret,
  noteId,
  payloadHash = 0n,
  privateData = [0n, 0n],
  blinding,
  ephemeralSecret,
  nonce,
}) {
  const purpose = 1n;
  const recipientSpendPublicKey = spendPublicKey(spendSecret);
  const recipientViewingPublicKey = viewingPublicKey(viewingSecret);
  const ephemeralPublicKey = multiplyPoint(BASE8, ephemeralSecret);
  const sharedSecret = multiplyPoint(
    multiplyPoint(recipientViewingPublicKey, 8n),
    ephemeralSecret,
  );
  const plaintext = [
    purpose,
    amount,
    recipientSpendPublicKey,
    recipientViewingPublicKey[0],
    recipientViewingPublicKey[1],
    noteId,
    payloadHash,
    privateData[0],
    privateData[1],
    blinding,
  ];
  const ciphertext = plaintext.map((value, index) =>
    mod(
      value +
        poseidon2Hash([
          1006n,
          sharedSecret[0],
          sharedSecret[1],
          nonce,
          BigInt(outputIndex),
          BigInt(index),
        ]),
    ),
  );
  const authentication = poseidon2Hash([
    1007n,
    sharedSecret[0],
    sharedSecret[1],
    nonce,
    BigInt(outputIndex),
    ...plaintext,
  ]);
  const envelope = [1n, ...ephemeralPublicKey, nonce, ...ciphertext, authentication];
  const note = {
    noteDomain,
    purpose,
    amount,
    spendPublicKey: recipientSpendPublicKey,
    viewingPublicKey: recipientViewingPublicKey,
    noteId,
    payloadHash,
    privateData,
    blinding,
    ephemeralSecret,
    nonce,
    envelope,
  };
  return {
    ...note,
    commitment: noteCommitment(note),
    envelopeHash: poseidon2Hash([1008n, ...envelope]),
  };
}

function merkleNode(left, right) {
  return poseidon2Hash([1005n, left, right]);
}

function merkleTree(notes) {
  const zeros = [0n];
  for (let level = 0; level < TREE_LEVELS; level++) {
    zeros.push(merkleNode(zeros[level], zeros[level]));
  }
  const layers = [notes.map(({ commitment }) => commitment)];
  for (let level = 0; level < TREE_LEVELS; level++) {
    const current = layers[level];
    const next = [];
    for (let index = 0; index < current.length; index += 2) {
      next.push(merkleNode(current[index], current[index + 1] ?? zeros[level]));
    }
    if (next.length === 0) next.push(zeros[level + 1]);
    layers.push(next);
  }
  return {
    root: layers[TREE_LEVELS][0],
    path(index) {
      const siblings = [];
      let position = index;
      for (let level = 0; level < TREE_LEVELS; level++) {
        siblings.push(layers[level][position ^ 1] ?? zeros[level]);
        position = Math.floor(position / 2);
      }
      return siblings;
    },
  };
}

function identity(spendSecret, viewingSecret) {
  return [spendPublicKey(spendSecret), ...viewingPublicKey(viewingSecret)];
}

function baseContext({
  action,
  publicAccount = [0n, 0n],
  publicAmountSign,
  publicAmountMagnitude,
  outputCount,
  emergency,
  relayFee,
  protocolFee,
  relayIdentity,
  protocolIdentity,
  attachmentHash,
}) {
  const context = [
    1n,
    action,
    1n,
    101n,
    102n,
    103n,
    104n,
    105n,
    106n,
    107n,
    108n,
    109n,
    110n,
    20_000n,
    ...publicAccount,
    publicAmountSign,
    publicAmountMagnitude,
    outputCount,
    outputCount,
    emergency,
    0n,
    relayFee,
    protocolFee,
    ...relayIdentity,
    ...protocolIdentity,
    attachmentHash,
    111n,
  ];
  if (context.length !== 32) throw new Error("invalid payment context shape");
  return context;
}

function makeInputs(context, inputCount) {
  const noteDomain = paymentNoteDomain(context);
  const spendSecrets = [];
  const notes = [];
  for (let index = 0; index < inputCount; index++) {
    const offset = BigInt(index * 20);
    const spendSecret = 201n + offset;
    spendSecrets.push(spendSecret);
    notes.push(
      outputNote({
        outputIndex: index,
        noteDomain,
        amount: 100_000_000n + BigInt(index) * 10_000_000n,
        spendSecret,
        viewingSecret: 202n + offset,
        noteId: 203n + offset,
        blinding: 204n + offset,
        ephemeralSecret: 205n + offset,
        nonce: 206n + offset,
      }),
    );
  }
  const tree = merkleTree(notes);
  return { notes, spendSecrets, tree };
}

function noteWitness(inputs) {
  return {
    inPurpose: inputs.notes.map((note) => note.purpose),
    inAmount: inputs.notes.map((note) => note.amount),
    inSpendSecret: inputs.spendSecrets,
    inViewingPublicKey: inputs.notes.map((note) => note.viewingPublicKey),
    inNoteId: inputs.notes.map((note) => note.noteId),
    inPayloadHash: inputs.notes.map((note) => note.payloadHash),
    inPrivateData: inputs.notes.map((note) => note.privateData),
    inBlinding: inputs.notes.map((note) => note.blinding),
    inLeafIndex: inputs.notes.map((_, index) => BigInt(index)),
    inSiblings: inputs.notes.map((_, index) => inputs.tree.path(index)),
  };
}

function outputWitness(outputs) {
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

function publicFields({
  action,
  context,
  membershipRoot,
  nullifiers,
  outputs,
  outputCount,
  attachmentHash,
  publicAmountSign,
  publicAmountMagnitude,
}) {
  const padded = (values) => [...values, ...Array(4 - values.length).fill(0n)];
  return {
    action,
    contextDigest: poseidon2Hash(context),
    membershipRoot,
    nullifierCount: BigInt(nullifiers.length),
    nullifier0: padded(nullifiers)[0],
    nullifier1: padded(nullifiers)[1],
    nullifier2: padded(nullifiers)[2],
    nullifier3: padded(nullifiers)[3],
    outputCount,
    outputCommitment0: padded(outputs.map((output) => output.commitment))[0],
    outputCommitment1: padded(outputs.map((output) => output.commitment))[1],
    outputCommitment2: padded(outputs.map((output) => output.commitment))[2],
    outputCommitment3: padded(outputs.map((output) => output.commitment))[3],
    outputEnvelopeHash0: padded(outputs.map((output) => output.envelopeHash))[0],
    outputEnvelopeHash1: padded(outputs.map((output) => output.envelopeHash))[1],
    outputEnvelopeHash2: padded(outputs.map((output) => output.envelopeHash))[2],
    outputEnvelopeHash3: padded(outputs.map((output) => output.envelopeHash))[3],
    attachmentHash,
    publicAmountSign,
    publicAmountMagnitude,
  };
}

export function depositFixture() {
  const amount = 100_000_000n;
  const relayIdentity = identity(301n, 302n);
  const protocolIdentity = identity(311n, 312n);
  const context = baseContext({
    action: 0n,
    publicAccount: [113n, 114n],
    publicAmountSign: 0n,
    publicAmountMagnitude: amount,
    outputCount: 2n,
    emergency: 0n,
    relayFee: 0n,
    protocolFee: 0n,
    relayIdentity,
    protocolIdentity,
    attachmentHash: 0n,
  });
  const noteDomain = paymentNoteDomain(context);
  const outputs = [
    outputNote({
      outputIndex: 0,
      noteDomain,
      amount,
      spendSecret: 401n,
      viewingSecret: 402n,
      noteId: 403n,
      blinding: 404n,
      ephemeralSecret: 405n,
      nonce: 406n,
    }),
    outputNote({
      outputIndex: 1,
      noteDomain,
      amount: 0n,
      spendSecret: 411n,
      viewingSecret: 412n,
      noteId: 413n,
      blinding: 414n,
      ephemeralSecret: 415n,
      nonce: 416n,
    }),
  ];
  return {
    ...publicFields({
      action: 0n,
      context,
      membershipRoot: 0n,
      nullifiers: [],
      outputs,
      outputCount: 2n,
      attachmentHash: 0n,
      publicAmountSign: 0n,
      publicAmountMagnitude: amount,
    }),
    contextFields: context,
    ...outputWitness(outputs),
  };
}

export function transferFixture(inputCount) {
  const relayIdentity = identity(501n, 502n);
  const protocolIdentity = identity(511n, 512n);
  const attachmentFields = [601n, 602n, 603n, 604n];
  const attachmentHash = poseidon2Hash([1110n, ...attachmentFields]);
  const relayFee = 1_000_000n;
  const protocolFee = 2_000_000n;
  const context = baseContext({
    action: 1n,
    publicAmountSign: 0n,
    publicAmountMagnitude: 0n,
    outputCount: 4n,
    emergency: 0n,
    relayFee,
    protocolFee,
    relayIdentity,
    protocolIdentity,
    attachmentHash,
  });
  const inputs = makeInputs(context, inputCount);
  const totalInput = inputs.notes.reduce((sum, note) => sum + note.amount, 0n);
  const recipientAmount = totalInput / 2n;
  const amounts = [
    recipientAmount,
    totalInput - recipientAmount - relayFee - protocolFee,
    relayFee,
    protocolFee,
  ];
  const recipients = [
    [701n, 702n],
    [711n, 712n],
    [501n, 502n],
    [511n, 512n],
  ];
  const noteDomain = paymentNoteDomain(context);
  const outputs = recipients.map(([spendSecret, viewingSecret], index) =>
    outputNote({
      outputIndex: index,
      noteDomain,
      amount: amounts[index],
      spendSecret,
      viewingSecret,
      noteId: 720n + BigInt(index),
      payloadHash: index === 0 ? 730n : 0n,
      privateData: index === 0 ? [attachmentHash, 0n] : [0n, 0n],
      blinding: 740n + BigInt(index),
      ephemeralSecret: 750n + BigInt(index),
      nonce: 760n + BigInt(index),
    }),
  );
  const nullifiers = inputs.notes.map((note, index) =>
    noteNullifier(note, inputs.spendSecrets[index]),
  );
  return {
    ...publicFields({
      action: 1n,
      context,
      membershipRoot: inputs.tree.root,
      nullifiers,
      outputs,
      outputCount: 4n,
      attachmentHash,
      publicAmountSign: 0n,
      publicAmountMagnitude: 0n,
    }),
    contextFields: context,
    attachmentFields,
    ...noteWitness(inputs),
    ...outputWitness(outputs),
  };
}

export function withdrawFixture(inputCount, emergency = false) {
  const relayIdentity = identity(801n, 802n);
  const protocolIdentity = identity(811n, 812n);
  const relayFee = emergency ? 0n : 1_000_000n;
  const protocolFee = emergency ? 0n : 2_000_000n;
  const outputCount = emergency ? 0n : 3n;
  const initialContext = baseContext({
    action: 2n,
    publicAccount: [115n, 116n],
    publicAmountSign: 1n,
    publicAmountMagnitude: 1n,
    outputCount,
    emergency: emergency ? 1n : 0n,
    relayFee,
    protocolFee,
    relayIdentity,
    protocolIdentity,
    attachmentHash: 0n,
  });
  const inputs = makeInputs(initialContext, inputCount);
  const totalInput = inputs.notes.reduce((sum, note) => sum + note.amount, 0n);
  const withdrawal = emergency ? totalInput : totalInput / 2n;
  const context = baseContext({
    action: 2n,
    publicAccount: [115n, 116n],
    publicAmountSign: 1n,
    publicAmountMagnitude: withdrawal,
    outputCount,
    emergency: emergency ? 1n : 0n,
    relayFee,
    protocolFee,
    relayIdentity,
    protocolIdentity,
    attachmentHash: 0n,
  });
  const rebuiltInputs = makeInputs(context, inputCount);
  const change = emergency ? 0n : totalInput - withdrawal - relayFee - protocolFee;
  const amounts = [change, relayFee, protocolFee];
  const recipients = [
    [901n, 902n],
    [801n, 802n],
    [811n, 812n],
  ];
  const noteDomain = paymentNoteDomain(context);
  const privateOutputs = recipients.map(([spendSecret, viewingSecret], index) =>
    outputNote({
      outputIndex: index,
      noteDomain,
      amount: amounts[index],
      spendSecret,
      viewingSecret,
      noteId: 920n + BigInt(index),
      blinding: 930n + BigInt(index),
      ephemeralSecret: 940n + BigInt(index),
      nonce: 950n + BigInt(index),
    }),
  );
  const publicOutputs = emergency ? [] : privateOutputs;
  const nullifiers = rebuiltInputs.notes.map((note, index) =>
    noteNullifier(note, rebuiltInputs.spendSecrets[index]),
  );
  return {
    ...publicFields({
      action: 2n,
      context,
      membershipRoot: rebuiltInputs.tree.root,
      nullifiers,
      outputs: publicOutputs,
      outputCount,
      attachmentHash: 0n,
      publicAmountSign: 1n,
      publicAmountMagnitude: withdrawal,
    }),
    contextFields: context,
    ...noteWitness(rebuiltInputs),
    ...outputWitness(privateOutputs),
  };
}

export function stringifyFixture(value) {
  return JSON.stringify(
    value,
    (_, field) => (typeof field === "bigint" ? field.toString() : field),
    2,
  );
}
