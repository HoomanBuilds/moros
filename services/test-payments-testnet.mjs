import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Address,
  Keypair,
  Networks,
  TransactionBuilder,
  contract,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import { poseidon2Hash } from "@zkpassport/poseidon2";
import * as snarkjs from "snarkjs";
import {
  identity,
  merkleTree,
  noteNullifier,
  noteWitness,
  outputNote,
  outputWitness,
  paymentNoteDomain,
  publicFields,
} from "../circuits/payments/fixture-lib.mjs";
import { PAYMENT_PUBLIC_SIGNALS } from "../circuits/payments/artifacts.mjs";
import { proofBytes } from "../circuits/private/artifacts.mjs";
import { cfg } from "./config.mjs";
import { configuredSecret } from "./key-config.mjs";
import { PaymentRelayService } from "./payment-relay.mjs";
import { secretScalar } from "./deployment-utils.mjs";

const PASSPHRASE = Networks.TESTNET;
const RPC_URL = process.env.MOROS_TESTNET_RPC_URL || "https://soroban-testnet.stellar.org";
const DEPLOYMENT_PATH = resolve(cfg.repo, "deployments/payments-testnet.json");
const STATE_PATH = resolve(cfg.repo, "deployments/payments-testnet.local.json");
const REPORT_PATH = resolve(cfg.repo, "deployments/payments-testnet-test.local.json");
const RUN_PATH = resolve(cfg.repo, "deployments/payments-testnet-run.local.json");
const VAULT_WASM = resolve(cfg.repo, "contracts/target/wasm32v1-none/release/payment_vault.wasm");
const VERIFIER_WASM = resolve(cfg.repo, "contracts/target/wasm32v1-none/release/payment_verifier.wasm");
const ARTIFACT_ROOT = resolve(cfg.repo, "circuits/payments-build");
const NEGATIVE_ONLY = process.env.MOROS_PAYMENT_TEST_NEGATIVE_ONLY === "1";
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const SUBORDER = 2736030358979909402780800718157159386076813975875726141021292143918197937689n;
const SOURCE_SECRET = configuredSecret({
  secret: process.env.MOROS_TESTNET_DEPLOYER_SK || "",
  identity: process.env.MOROS_TESTNET_DEPLOYER_IDENTITY || "moros-testnet-deployer",
  label: "testnet payment lifecycle source",
});
const UNAUTHORIZED_ADMIN =
  process.env.MOROS_TESTNET_UNAUTHORIZED_ADMIN || "GCTHKKHX64S7NADXPFE3XSWYHNOEOU4GY6F7UXPRYKK4ZXJ4TTVAYOMW";
let runSeed;
let randomCounter = 0;

function signingOptions(source) {
  return {
    publicKey: source.publicKey(),
    networkPassphrase: PASSPHRASE,
    rpcUrl: RPC_URL,
    signTransaction: async (transactionXdr, options = {}) => {
      const transaction = TransactionBuilder.fromXDR(
        transactionXdr,
        options.networkPassphrase || PASSPHRASE,
      );
      transaction.sign(source);
      return { signedTxXdr: transaction.toXDR(), signerAddress: source.publicKey() };
    },
  };
}

function hash(value) {
  return createHash("sha256").update(value).digest();
}

function bytes32Limbs(value) {
  const bytes = Buffer.from(value);
  if (bytes.length !== 32) throw new Error("expected 32 bytes");
  return [
    BigInt(`0x${bytes.subarray(0, 16).toString("hex")}`),
    BigInt(`0x${bytes.subarray(16).toString("hex")}`),
  ];
}

function addressLimbs(value) {
  return bytes32Limbs(hash(new Address(value).toScVal().toXDR()));
}

function fieldBytes(value) {
  return Buffer.from(BigInt(value).toString(16).padStart(64, "0"), "hex");
}

function randomField(modulus = FIELD) {
  return (BigInt(`0x${deterministicBytes().toString("hex")}`) % (modulus - 1n)) + 1n;
}

function deterministicBytes() {
  if (!runSeed) throw new Error("payment test randomness is not initialized");
  const value = createHmac("sha256", runSeed)
    .update(`moros/payments/testnet/lifecycle/${randomCounter}`)
    .digest();
  randomCounter++;
  return value;
}

function randomIdentity() {
  const spendSecret = randomField();
  const viewingSecret = randomField(SUBORDER);
  const [spendPublicKey, viewingPublicKeyX, viewingPublicKeyY] = identity(
    spendSecret,
    viewingSecret,
  );
  return {
    spendSecret,
    viewingSecret,
    public: { spendPublicKey, viewingPublicKeyX, viewingPublicKeyY },
    contract: {
      spend_public_key: spendPublicKey,
      viewing_public_key_x: viewingPublicKeyX,
      viewing_public_key_y: viewingPublicKeyY,
    },
  };
}

function contextFields({
  deployment,
  state,
  action,
  actionId,
  expiry,
  publicAccount,
  publicAmount,
  outputCount,
  emergency,
  relayFee,
  protocolFee,
  relayIdentity,
  protocolIdentity,
  attachmentHash,
  relayQuoteDigest,
}) {
  const sign = publicAmount < 0n ? 1n : 0n;
  const magnitude = publicAmount < 0n ? -publicAmount : publicAmount;
  const fields = [
    1n,
    BigInt(action),
    1n,
    ...bytes32Limbs(Buffer.from(state.networkDomain, "hex")),
    ...addressLimbs(deployment.vault),
    ...addressLimbs(deployment.usdcContract),
    ...bytes32Limbs(Buffer.from(state.verifierDomain, "hex")),
    ...bytes32Limbs(actionId),
    BigInt(expiry),
    ...(publicAccount ? addressLimbs(publicAccount) : [0n, 0n]),
    sign,
    magnitude,
    BigInt(outputCount),
    BigInt(outputCount),
    emergency ? 1n : 0n,
    0n,
    relayFee,
    protocolFee,
    relayIdentity.spendPublicKey,
    relayIdentity.viewingPublicKeyX,
    relayIdentity.viewingPublicKeyY,
    protocolIdentity.spendPublicKey,
    protocolIdentity.viewingPublicKeyX,
    protocolIdentity.viewingPublicKeyY,
    attachmentHash,
    relayQuoteDigest,
  ];
  if (fields.length !== 32) throw new Error("payment context field count mismatch");
  return fields;
}

function note({ outputIndex, context, amount, owner, payloadHash = 0n, privateData = [0n, 0n] }) {
  return outputNote({
    outputIndex,
    noteDomain: paymentNoteDomain(context),
    amount,
    spendSecret: owner.spendSecret,
    viewingSecret: owner.viewingSecret,
    noteId: randomField(),
    payloadHash,
    privateData,
    blinding: randomField(),
    ephemeralSecret: randomField(1n << 248n),
    nonce: randomField(),
  });
}

function statement({
  action,
  circuit,
  context,
  membershipRoot,
  nullifiers,
  outputs,
  attachmentHash,
  publicAmount,
}) {
  const sign = publicAmount < 0n ? 1n : 0n;
  const magnitude = publicAmount < 0n ? -publicAmount : publicAmount;
  const fields = publicFields({
    action: BigInt(action),
    context,
    membershipRoot,
    nullifiers,
    outputs,
    outputCount: BigInt(outputs.length),
    attachmentHash,
    publicAmountSign: sign,
    publicAmountMagnitude: magnitude,
  });
  return {
    fields,
    contract: {
      action: { tag: action === 0 ? "Deposit" : action === 1 ? "Transfer" : "Withdraw" },
      circuit: { tag: circuit },
      context_digest: fields.contextDigest,
      membership_root: membershipRoot,
      input_nullifiers: nullifiers,
      output_commitments: outputs.map((output) => output.commitment),
      output_envelope_hashes: outputs.map((output) => output.envelopeHash),
      attachment_hash: attachmentHash,
      public_amount: publicAmount,
    },
  };
}

async function prove(circuit, input, expectedFields) {
  const wasm = resolve(ARTIFACT_ROOT, circuit, `${circuit}_js/${circuit}.wasm`);
  const zkey = resolve(ARTIFACT_ROOT, circuit, `${circuit}.zkey`);
  const vkey = JSON.parse(readFileSync(resolve(ARTIFACT_ROOT, circuit, `${circuit}.vk.json`), "utf8"));
  const result = await snarkjs.groth16.fullProve(input, wasm, zkey);
  if (!(await snarkjs.groth16.verify(vkey, result.publicSignals, result.proof))) {
    throw new Error(`${circuit} proof failed local verification`);
  }
  const expectedSignals = PAYMENT_PUBLIC_SIGNALS.map((name) => expectedFields[name].toString());
  if (canonicalSignals(result.publicSignals) !== canonicalSignals(expectedSignals)) {
    throw new Error(`${circuit} public signals do not match the contract statement`);
  }
  return proofBytes(result.proof);
}

function canonicalSignals(values) {
  return values.map((value) => BigInt(value).toString()).join(",");
}

function transition(contractStatement, proof, outputs, attachment = Buffer.alloc(0)) {
  return {
    statement: contractStatement,
    proof,
    encrypted_outputs: outputs.map((output) => Buffer.concat(output.envelope.map(fieldBytes))),
    attachment,
  };
}

function relayQuote(relay, actionId, expiry, deployment, state) {
  const quote = relay.issueQuote({ actionId, actionExpiry: expiry });
  const digest = poseidon2Hash([
    1111n,
    ...bytes32Limbs(Buffer.from(state.networkDomain, "hex")),
    ...addressLimbs(deployment.vault),
    ...addressLimbs(deployment.usdcContract),
    ...bytes32Limbs(actionId),
    ...bytes32Limbs(quote.quoteId),
    ...bytes32Limbs(quote.signingKey),
    quote.fee,
    quote.expiry,
    quote.paymentIdentity.spendPublicKey,
    quote.paymentIdentity.viewingPublicKeyX,
    quote.paymentIdentity.viewingPublicKeyY,
  ]);
  return {
    digest,
    identity: quote.paymentIdentity,
    contract: {
      quote_id: quote.quoteId,
      signing_key: quote.signingKey,
      payment_identity: {
        spend_public_key: quote.paymentIdentity.spendPublicKey,
        viewing_public_key_x: quote.paymentIdentity.viewingPublicKeyX,
        viewing_public_key_y: quote.paymentIdentity.viewingPublicKeyY,
      },
      fee: quote.fee,
      expiry: quote.expiry,
      signature: quote.signature,
    },
  };
}

function hashFromSent(result) {
  const value = result?.sendTransactionResponse?.hash || result?.hash;
  if (!value) throw new Error("payment transaction hash is missing");
  return value;
}

async function usdcBalance(account) {
  const response = await fetch(`https://horizon-testnet.stellar.org/accounts/${account}`);
  if (!response.ok) throw new Error(`Horizon balance failed with HTTP ${response.status}`);
  const record = await response.json();
  const asset = record.balances.find(
    (balance) => balance.asset_code === "USDC" && balance.asset_issuer === "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  );
  return asset?.balance || "0.0000000";
}

async function existingCommitments(server, deployment, count) {
  if (count === 0) return [];
  const response = await server.getEvents({
    startLedger: deployment.startLedger,
    filters: [{ type: "contract", contractIds: [deployment.vault] }],
    limit: 500,
  });
  const commitments = [];
  for (const event of response.events) {
    const topic = event.topic.map(scValToNative);
    if (topic[0] !== "payment_output") continue;
    const value = scValToNative(event.value);
    const leafIndex = Number(value[1]);
    if (commitments[leafIndex] !== undefined) {
      throw new Error("duplicate testnet payment output event");
    }
    commitments[leafIndex] = BigInt(value[2]);
  }
  if (commitments.length !== count || commitments.some((value) => value === undefined)) {
    throw new Error("testnet payment output history is incomplete");
  }
  return commitments;
}

function rejectionText(error) {
  return [
    error?.message,
    error?.simulation?.error,
    error?.cause?.message,
    error?.response?.data?.error,
    String(error),
  ]
    .filter((value) => typeof value === "string" && value.length > 0)
    .join("\n");
}

async function verifyNegativePaths({
  deployment,
  state,
  source,
  verifier,
  vault,
  protocolIdentity,
  owner,
  dummy,
}) {
  const invalidAction = deterministicBytes();
  const invalidExpiry = Math.floor(Date.now() / 1_000) + 3_600;
  const invalidContext = contextFields({
    deployment,
    state,
    action: 0,
    actionId: invalidAction,
    expiry: invalidExpiry,
    publicAccount: source.publicKey(),
    publicAmount: 1n,
    outputCount: 2,
    emergency: false,
    relayFee: 0n,
    protocolFee: 0n,
    relayIdentity: protocolIdentity,
    protocolIdentity,
    attachmentHash: 0n,
    relayQuoteDigest: 0n,
  });
  const invalidOutputs = [
    note({ outputIndex: 0, context: invalidContext, amount: 1n, owner }),
    note({ outputIndex: 1, context: invalidContext, amount: 0n, owner: dummy }),
  ];
  const invalidStatement = statement({
    action: 0,
    circuit: "Deposit",
    context: invalidContext,
    membershipRoot: 0n,
    nullifiers: [],
    outputs: invalidOutputs,
    attachmentHash: 0n,
    publicAmount: 1n,
  });
  const invalidProof = Buffer.alloc(256);
  const invalidTransition = transition(invalidStatement.contract, invalidProof, invalidOutputs);
  if ((await verifier.verify({ statement: invalidStatement.contract, proof: invalidProof })).result) {
    throw new Error("payment verifier accepted an all-zero proof");
  }

  let invalidProofError = "";
  try {
    const invalidDeposit = await vault.deposit({
      source: source.publicKey(),
      action_id: invalidAction,
      expiry: BigInt(invalidExpiry),
      transition: invalidTransition,
    });
    if (rpc.Api.isSimulationError(invalidDeposit.simulation)) {
      invalidProofError = invalidDeposit.simulation.error;
    } else {
      void invalidDeposit.result;
    }
  } catch (error) {
    invalidProofError = rejectionText(error);
  }
  if (!/#13|InvalidProof|invalid proof/i.test(invalidProofError)) {
    throw new Error(`vault invalid-proof rejection was unexpected: ${invalidProofError || "no error"}`);
  }

  let unauthorizedAdminError = "";
  try {
    const unauthorizedPause = await vault.set_paused({ admin: UNAUTHORIZED_ADMIN, paused: true });
    if (rpc.Api.isSimulationError(unauthorizedPause.simulation)) {
      unauthorizedAdminError = unauthorizedPause.simulation.error;
    } else {
      void unauthorizedPause.result;
    }
  } catch (error) {
    unauthorizedAdminError = rejectionText(error);
  }
  if (!/#1|InvalidConfiguration/i.test(unauthorizedAdminError)) {
    throw new Error(`vault unauthorized-admin rejection was unexpected: ${unauthorizedAdminError || "no error"}`);
  }
  return {
    invalidProofRejected: true,
    unauthorizedAdminRejected: true,
  };
}

async function main() {
  if (!SOURCE_SECRET) throw new Error("testnet payment lifecycle source is required");
  const deployment = JSON.parse(readFileSync(DEPLOYMENT_PATH, "utf8"));
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  if (!state.complete || deployment.vault !== state.ids.vault || deployment.verifier !== state.ids.verifier) {
    throw new Error("payment deployment state is incomplete");
  }
  const source = Keypair.fromSecret(SOURCE_SECRET);
  const server = new rpc.Server(RPC_URL);
  if ((await server.getNetwork()).passphrase !== PASSPHRASE) throw new Error("RPC network mismatch");
  const verifier = await contract.Client.fromWasm(readFileSync(VERIFIER_WASM), {
    ...signingOptions(source),
    contractId: deployment.verifier,
  });
  const vault = await contract.Client.fromWasm(readFileSync(VAULT_WASM), {
    ...signingOptions(source),
    contractId: deployment.vault,
  });
  const beforeInfo = (await vault.info()).result;
  const verifierInfo = (await verifier.info()).result;
  if (
    !verifierInfo.finalized ||
    Number(verifierInfo.circuits) !== 7 ||
    beforeInfo.token !== deployment.usdcContract ||
    beforeInfo.verifier !== deployment.verifier ||
    Number(beforeInfo.tree_levels) !== 20 ||
    Number(beforeInfo.root_history_size) !== 64 ||
    BigInt(beforeInfo.liabilities) < 0n
  ) {
    throw new Error("payment contracts are not in a verified state");
  }
  if (NEGATIVE_ONLY) {
    runSeed = randomBytes(32);
    const protocolIdentity = {
      spendPublicKey: BigInt(state.protocolIdentity.spend_public_key),
      viewingPublicKeyX: BigInt(state.protocolIdentity.viewing_public_key_x),
      viewingPublicKeyY: BigInt(state.protocolIdentity.viewing_public_key_y),
    };
    const checks = await verifyNegativePaths({
      deployment,
      state,
      source,
      verifier,
      vault,
      protocolIdentity,
      owner: randomIdentity(),
      dummy: randomIdentity(),
    });
    process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`);
    return;
  }
  const baselineLiabilities = BigInt(beforeInfo.liabilities);
  const baselineLeafCount = Number(beforeInfo.next_leaf_index);
  const baselineCommitments = await existingCommitments(server, deployment, baselineLeafCount);
  if (
    baselineLeafCount > 0 &&
    merkleTree(baselineCommitments.map((commitment) => ({ commitment }))).root !==
      BigInt(beforeInfo.current_root)
  ) {
    throw new Error("testnet payment event history does not reproduce the current root");
  }
  runSeed = randomBytes(32);
  writeFileSync(RUN_PATH, `${JSON.stringify({
    status: "running",
    seed: runSeed.toString("hex"),
    baselineLiabilities: baselineLiabilities.toString(),
    baselineLeafCount,
    baselineCommitments: baselineCommitments.map(String),
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 });
  const protocolIdentity = {
    spendPublicKey: BigInt(state.protocolIdentity.spend_public_key),
    viewingPublicKeyX: BigInt(state.protocolIdentity.viewing_public_key_x),
    viewingPublicKeyY: BigInt(state.protocolIdentity.viewing_public_key_y),
  };
  const protocolOwner = {
    spendSecret: secretScalar(SOURCE_SECRET, "payments-testnet-protocol-spend"),
    viewingSecret: secretScalar(SOURCE_SECRET, "payments-testnet-protocol-view"),
  };
  const expectedProtocolIdentity = identity(
    protocolOwner.spendSecret,
    protocolOwner.viewingSecret,
  );
  if (
    expectedProtocolIdentity[0] !== protocolIdentity.spendPublicKey ||
    expectedProtocolIdentity[1] !== protocolIdentity.viewingPublicKeyX ||
    expectedProtocolIdentity[2] !== protocolIdentity.viewingPublicKeyY
  ) {
    throw new Error("testnet protocol payment identity mismatch");
  }
  const relayOwner = randomIdentity();
  const relay = new PaymentRelayService({
    vault: deployment.vault,
    token: deployment.usdcContract,
    networkDomain: Buffer.from(state.networkDomain, "hex"),
    signingSeed: Buffer.from(state.relaySigningSeed, "hex"),
    paymentIdentity: relayOwner.public,
    fee: 0n,
    submit: async () => ({ status: "unused" }),
  });
  const owner = randomIdentity();
  const dummy = randomIdentity();
  const recipient = randomIdentity();
  const amount = 1_000_000n;
  const payment = 400_000n;
  const beforeBalance = await usdcBalance(source.publicKey());
  const transactions = [];
  const allNotes = baselineCommitments.map((commitment) => ({ commitment }));

  const depositAction = deterministicBytes();
  const depositExpiry = Math.floor(Date.now() / 1_000) + 3_600;
  const depositContext = contextFields({
    deployment,
    state,
    action: 0,
    actionId: depositAction,
    expiry: depositExpiry,
    publicAccount: source.publicKey(),
    publicAmount: amount,
    outputCount: 2,
    emergency: false,
    relayFee: 0n,
    protocolFee: 0n,
    relayIdentity: protocolIdentity,
    protocolIdentity,
    attachmentHash: 0n,
    relayQuoteDigest: 0n,
  });
  const depositOutputs = [
    note({ outputIndex: 0, context: depositContext, amount, owner }),
    note({ outputIndex: 1, context: depositContext, amount: 0n, owner: dummy }),
  ];
  const depositStatement = statement({
    action: 0,
    circuit: "Deposit",
    context: depositContext,
    membershipRoot: 0n,
    nullifiers: [],
    outputs: depositOutputs,
    attachmentHash: 0n,
    publicAmount: amount,
  });
  const depositProof = await prove(
    "deposit",
    { ...depositStatement.fields, contextFields: depositContext, ...outputWitness(depositOutputs) },
    depositStatement.fields,
  );
  const depositTransition = transition(depositStatement.contract, depositProof, depositOutputs);
  const deposited = await (
    await vault.deposit({
      source: source.publicKey(),
      action_id: depositAction,
      expiry: BigInt(depositExpiry),
      transition: depositTransition,
    }, { timeoutInSeconds: 300 })
  ).signAndSend();
  transactions.push({ operation: "deposit", hash: hashFromSent(deposited) });
  allNotes.push(...depositOutputs);
  const depositRoot = merkleTree(allNotes).root;
  const afterDeposit = (await vault.info()).result;
  if (
    BigInt(afterDeposit.current_root) !== depositRoot ||
    BigInt(afterDeposit.liabilities) !== baselineLiabilities + amount
  ) {
    throw new Error("deposit state transition mismatch");
  }

  const transferAction = deterministicBytes();
  const transferExpiry = Math.floor(Date.now() / 1_000) + 3_600;
  const transferQuote = relayQuote(relay, transferAction, transferExpiry, deployment, state);
  const attachmentFields = Array.from({ length: 4 }, () => randomField());
  const attachmentHash = poseidon2Hash([1110n, ...attachmentFields]);
  const transferContext = contextFields({
    deployment,
    state,
    action: 1,
    actionId: transferAction,
    expiry: transferExpiry,
    publicAccount: null,
    publicAmount: 0n,
    outputCount: 4,
    emergency: false,
    relayFee: 0n,
    protocolFee: 0n,
    relayIdentity: transferQuote.identity,
    protocolIdentity,
    attachmentHash,
    relayQuoteDigest: transferQuote.digest,
  });
  const transferOutputs = [
    note({
      outputIndex: 0,
      context: transferContext,
      amount: payment,
      owner: recipient,
      payloadHash: randomField(),
      privateData: [attachmentHash, 0n],
    }),
    note({ outputIndex: 1, context: transferContext, amount: amount - payment, owner }),
    note({ outputIndex: 2, context: transferContext, amount: 0n, owner: relayOwner }),
    note({ outputIndex: 3, context: transferContext, amount: 0n, owner: protocolOwner }),
  ];
  const depositTree = merkleTree(allNotes);
  const transferNullifier = noteNullifier(depositOutputs[0], owner.spendSecret);
  const transferStatement = statement({
    action: 1,
    circuit: "TransferOne",
    context: transferContext,
    membershipRoot: depositTree.root,
    nullifiers: [transferNullifier],
    outputs: transferOutputs,
    attachmentHash,
    publicAmount: 0n,
  });
  const transferProof = await prove(
    "transfer_one",
    {
      ...transferStatement.fields,
      contextFields: transferContext,
      attachmentFields,
      ...noteWitness({
        notes: [depositOutputs[0]],
        spendSecrets: [owner.spendSecret],
        leafIndexes: [baselineLeafCount],
        tree: depositTree,
      }),
      ...outputWitness(transferOutputs),
    },
    transferStatement.fields,
  );
  const attachment = Buffer.concat(attachmentFields.map(fieldBytes));
  const transferTransition = transition(
    transferStatement.contract,
    transferProof,
    transferOutputs,
    attachment,
  );
  const transferred = await (
    await vault.transfer({
      action_id: transferAction,
      expiry: BigInt(transferExpiry),
      fee_epoch: 0n,
      quote: transferQuote.contract,
      transition: transferTransition,
    }, { timeoutInSeconds: 300 })
  ).signAndSend();
  transactions.push({ operation: "private transfer", hash: hashFromSent(transferred) });
  allNotes.push(...transferOutputs);
  const transferRoot = merkleTree(allNotes).root;
  const afterTransfer = (await vault.info()).result;
  if (
    BigInt(afterTransfer.current_root) !== transferRoot ||
    BigInt(afterTransfer.liabilities) !== baselineLiabilities + amount ||
    !(await vault.nullifier_spent({ nullifier: transferNullifier })).result
  ) {
    throw new Error("private transfer state transition mismatch");
  }
  const idempotentTransfer = await vault.transfer({
    action_id: transferAction,
    expiry: BigInt(transferExpiry),
    fee_epoch: 0n,
    quote: transferQuote.contract,
    transition: transferTransition,
  });
  if (Number(idempotentTransfer.result.first_leaf_index) !== baselineLeafCount + 2) {
    throw new Error("private transfer idempotency mismatch");
  }

  const withdrawalNullifiers = [];
  async function withdrawNote(inputNote, inputOwner, leafIndex) {
    const withdrawAction = deterministicBytes();
    const withdrawExpiry = Math.floor(Date.now() / 1_000) + 3_600;
    const quote = relayQuote(relay, withdrawAction, withdrawExpiry, deployment, state);
    const withdrawAmount = inputNote.amount;
    const withdrawContext = contextFields({
      deployment,
      state,
      action: 2,
      actionId: withdrawAction,
      expiry: withdrawExpiry,
      publicAccount: source.publicKey(),
      publicAmount: -withdrawAmount,
      outputCount: 3,
      emergency: false,
      relayFee: 0n,
      protocolFee: 0n,
      relayIdentity: quote.identity,
      protocolIdentity,
      attachmentHash: 0n,
      relayQuoteDigest: quote.digest,
    });
    const withdrawOutputs = [
      note({ outputIndex: 0, context: withdrawContext, amount: 0n, owner: inputOwner }),
      note({ outputIndex: 1, context: withdrawContext, amount: 0n, owner: relayOwner }),
      note({ outputIndex: 2, context: withdrawContext, amount: 0n, owner: protocolOwner }),
    ];
    const tree = merkleTree(allNotes);
    const nullifier = noteNullifier(inputNote, inputOwner.spendSecret);
    const withdrawStatement = statement({
      action: 2,
      circuit: "WithdrawOne",
      context: withdrawContext,
      membershipRoot: tree.root,
      nullifiers: [nullifier],
      outputs: withdrawOutputs,
      attachmentHash: 0n,
      publicAmount: -withdrawAmount,
    });
    const withdrawProof = await prove(
      "withdraw_one",
      {
        ...withdrawStatement.fields,
        contextFields: withdrawContext,
        ...noteWitness({
          notes: [inputNote],
          spendSecrets: [inputOwner.spendSecret],
          leafIndexes: [leafIndex],
          tree,
        }),
        ...outputWitness(withdrawOutputs),
      },
      withdrawStatement.fields,
    );
    const withdrawTransition = transition(
      withdrawStatement.contract,
      withdrawProof,
      withdrawOutputs,
    );
    const withdrawn = await (
      await vault.withdraw({
        destination: source.publicKey(),
        action_id: withdrawAction,
        expiry: BigInt(withdrawExpiry),
        emergency: false,
        fee_epoch: 0n,
        quote: quote.contract,
        transition: withdrawTransition,
      }, { timeoutInSeconds: 300 })
    ).signAndSend();
    transactions.push({ operation: "withdraw", hash: hashFromSent(withdrawn) });
    allNotes.push(...withdrawOutputs);
    withdrawalNullifiers.push(nullifier);
    if (!(await vault.nullifier_spent({ nullifier })).result) {
      throw new Error("withdrawal nullifier was not recorded");
    }
  }

  await withdrawNote(transferOutputs[0], recipient, baselineLeafCount + 2);
  await withdrawNote(transferOutputs[1], owner, baselineLeafCount + 3);
  const afterWithdraw = (await vault.info()).result;
  const finalRoot = merkleTree(allNotes).root;
  if (
    BigInt(afterWithdraw.current_root) !== finalRoot ||
    BigInt(afterWithdraw.liabilities) !== baselineLiabilities ||
    Number(afterWithdraw.next_leaf_index) !== allNotes.length ||
    !(await vault.root_accepted({ root: finalRoot })).result
  ) {
    throw new Error("withdrawal state transition mismatch");
  }

  const { invalidProofRejected, unauthorizedAdminRejected } = await verifyNegativePaths({
    deployment,
    state,
    source,
    verifier,
    vault,
    protocolIdentity,
    owner,
    dummy,
  });

  let afterBalance = await usdcBalance(source.publicKey());
  for (let attempt = 0; attempt < 10 && afterBalance !== beforeBalance; attempt++) {
    await new Promise((done) => setTimeout(done, 2_000));
    afterBalance = await usdcBalance(source.publicKey());
  }
  if (afterBalance !== beforeBalance) {
    throw new Error(`test USDC was not fully recovered: ${beforeBalance} != ${afterBalance}`);
  }
  const report = {
    network: "testnet",
    source: source.publicKey(),
    verifier: deployment.verifier,
    vault: deployment.vault,
    beforeUsdc: beforeBalance,
    afterUsdc: afterBalance,
    finalLiabilities: afterWithdraw.liabilities.toString(),
    baselineLiabilities: baselineLiabilities.toString(),
    baselineLeafCount,
    finalLeafCount: Number(afterWithdraw.next_leaf_index),
    transferNullifierSpent: true,
    withdrawalNullifiersSpent: withdrawalNullifiers.length,
    invalidProofRejected,
    unauthorizedAdminRejected,
    transactions,
  };
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(RUN_PATH, `${JSON.stringify({
    status: "complete",
    seed: runSeed.toString("hex"),
    completedAt: new Date().toISOString(),
    report,
  }, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
