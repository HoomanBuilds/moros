import {
  createPrivateKey,
  createPublicKey,
  createHash,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
import {
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const PAYMENT_ENVELOPE_BYTES = 480;
const PAYMENT_ATTACHMENT_BYTES = 128;
const PAYMENT_PROOF_BYTES = 256;
const MAX_RELAY_ARGUMENT_BYTES = 196_608;
const MAX_ACTION_LIFETIME_SECONDS = 3_600;
const MAX_PAYMENT_AMOUNT = (1n << 120n) - 1n;
const BN254_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const PAYMENT_RELAY_METHODS = Object.freeze({
  transfer: Object.freeze({
    argumentCount: 5,
    actionIndex: 0,
    expiryIndex: 1,
    quoteIndex: 3,
    transitionIndex: 4,
    feeEpochIndex: 2,
    actionCode: 1,
  }),
  withdraw: Object.freeze({
    argumentCount: 7,
    actionIndex: 1,
    expiryIndex: 2,
    emergencyIndex: 3,
    quoteIndex: 5,
    transitionIndex: 6,
    feeEpochIndex: 4,
    destinationIndex: 0,
    actionCode: 2,
  }),
});

function requireBytes(value, length, label) {
  if (!Buffer.isBuffer(value) || value.length !== length) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function requireBigInt(value, minimum, maximum, label) {
  if (typeof value !== "bigint" || value < minimum || value > maximum) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function symbol(value) {
  return nativeToScVal(value, { type: "symbol" });
}

function map(entries) {
  return xdr.ScVal.scvMap(
    Object.entries(entries)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => new xdr.ScMapEntry({ key: symbol(key), val: value })),
  );
}

function bytes(value) {
  return nativeToScVal(value, { type: "bytes" });
}

function unsignedQuoteScVal(quote) {
  return map({
    action_id: bytes(quote.actionId),
    expiry: nativeToScVal(quote.expiry, { type: "u64" }),
    fee: nativeToScVal(quote.fee, { type: "i128" }),
    network_domain: bytes(quote.networkDomain),
    payment_identity: map({
      spend_public_key: nativeToScVal(quote.paymentIdentity.spendPublicKey, { type: "u256" }),
      viewing_public_key_x: nativeToScVal(quote.paymentIdentity.viewingPublicKeyX, { type: "u256" }),
      viewing_public_key_y: nativeToScVal(quote.paymentIdentity.viewingPublicKeyY, { type: "u256" }),
    }),
    quote_id: bytes(quote.quoteId),
    signing_key: bytes(quote.signingKey),
    token: new Address(quote.token).toScVal(),
    vault: new Address(quote.vault).toScVal(),
  });
}

export function relayQuoteMessage(quote) {
  return unsignedQuoteScVal(quote).toXDR();
}

export function encodeRelayQuote(quote) {
  return map({
    expiry: nativeToScVal(quote.expiry, { type: "u64" }),
    fee: nativeToScVal(quote.fee, { type: "i128" }),
    payment_identity: map({
      spend_public_key: nativeToScVal(quote.paymentIdentity.spendPublicKey, { type: "u256" }),
      viewing_public_key_x: nativeToScVal(quote.paymentIdentity.viewingPublicKeyX, { type: "u256" }),
      viewing_public_key_y: nativeToScVal(quote.paymentIdentity.viewingPublicKeyY, { type: "u256" }),
    }),
    quote_id: bytes(quote.quoteId),
    signature: bytes(quote.signature),
    signing_key: bytes(quote.signingKey),
  });
}

function privateKeyFromSeed(seed) {
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

function publicKeyBytes(privateKey) {
  const encoded = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return Buffer.from(encoded).subarray(-32);
}

function parseCanonicalScVal(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_RELAY_ARGUMENT_BYTES) {
    throw new Error("invalid relay argument");
  }
  try {
    const decoded = xdr.ScVal.fromXDR(value, "base64");
    if (decoded.toXDR("base64") !== value) throw new Error("noncanonical XDR");
    return decoded;
  } catch {
    throw new Error("invalid relay argument");
  }
}

function requireScValType(value, type, label) {
  if (value.switch().name !== type) throw new Error(`invalid ${label}`);
  return value;
}

function requireObjectShape(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid ${label}`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function requireField(value, label, allowZero = true) {
  const field = requireBigInt(value, allowZero ? 0n : 1n, BN254_SCALAR_FIELD - 1n, label);
  return field;
}

function normalizePaymentIdentity(identity) {
  requireObjectShape(
    identity,
    ["spendPublicKey", "viewingPublicKeyX", "viewingPublicKeyY"],
    "relay payment identity",
  );
  return {
    spendPublicKey: requireField(identity.spendPublicKey, "relay spend public key", false),
    viewingPublicKeyX: requireField(identity.viewingPublicKeyX, "relay viewing public key x", false),
    viewingPublicKeyY: requireField(identity.viewingPublicKeyY, "relay viewing public key y", false),
  };
}

function parseTransition(value, expectedAction) {
  const scMap = requireScValType(value, "scvMap", "transition");
  if (scMap.map().length !== 4) throw new Error("invalid transition");
  const transition = requireObjectShape(
    scValToNative(scMap),
    ["attachment", "encrypted_outputs", "proof", "statement"],
    "transition",
  );
  requireBytes(transition.proof, PAYMENT_PROOF_BYTES, "payment proof");
  if (!Array.isArray(transition.encrypted_outputs)) throw new Error("invalid encrypted outputs");
  for (const envelope of transition.encrypted_outputs) {
    requireBytes(envelope, PAYMENT_ENVELOPE_BYTES, "payment envelope");
  }
  const statement = requireObjectShape(
    transition.statement,
    [
      "action",
      "attachment_hash",
      "circuit",
      "context_digest",
      "input_nullifiers",
      "membership_root",
      "output_commitments",
      "output_envelope_hashes",
      "public_amount",
    ],
    "payment statement",
  );
  if (Number(statement.action) !== expectedAction) {
    throw new Error("payment action does not match relay method");
  }
  requireBytes(
    transition.attachment,
    expectedAction === 1 ? PAYMENT_ATTACHMENT_BYTES : 0,
    "payment attachment",
  );
  const expectedOutputs = expectedAction === 1 ? 4 : 3;
  const expectedInputsByCircuit = expectedAction === 1
    ? new Map([[1, 1], [2, 2], [3, 4]])
    : new Map([[4, 1], [5, 2], [6, 4]]);
  const expectedInputs = expectedInputsByCircuit.get(Number(statement.circuit));
  if (
    expectedInputs === undefined ||
    !Array.isArray(statement.input_nullifiers) ||
    statement.input_nullifiers.length !== expectedInputs ||
    transition.encrypted_outputs.length !== expectedOutputs ||
    !Array.isArray(statement.output_commitments) ||
    statement.output_commitments.length !== expectedOutputs ||
    !Array.isArray(statement.output_envelope_hashes) ||
    statement.output_envelope_hashes.length !== expectedOutputs
  ) {
    throw new Error("invalid payment output shape");
  }
  requireField(statement.context_digest, "payment context digest");
  requireField(statement.membership_root, "payment membership root");
  requireField(statement.attachment_hash, "payment attachment hash");
  if (
    (expectedAction === 1 && statement.attachment_hash === 0n) ||
    (expectedAction === 2 && statement.attachment_hash !== 0n) ||
    (expectedAction === 1 && statement.public_amount !== 0n) ||
    (expectedAction === 2 && (statement.public_amount >= 0n || statement.public_amount < -MAX_PAYMENT_AMOUNT))
  ) {
    throw new Error("invalid payment statement context");
  }
  const nullifiers = statement.input_nullifiers.map((field) => requireField(field, "payment nullifier", false));
  if (new Set(nullifiers.map(String)).size !== nullifiers.length) {
    throw new Error("duplicate payment nullifier");
  }
  const commitments = statement.output_commitments.map((field) => requireField(field, "payment commitment", false));
  if (new Set(commitments.map(String)).size !== commitments.length) {
    throw new Error("duplicate payment commitment");
  }
  statement.output_envelope_hashes.forEach((field) => requireField(field, "payment envelope hash"));
  return transition;
}

function parseQuote(value) {
  const scMap = requireScValType(value, "scvMap", "relay quote");
  if (scMap.map().length !== 6) throw new Error("invalid relay quote");
  const quote = requireObjectShape(
    scValToNative(scMap),
    ["expiry", "fee", "payment_identity", "quote_id", "signature", "signing_key"],
    "relay quote",
  );
  const identity = requireObjectShape(
    quote.payment_identity,
    ["spend_public_key", "viewing_public_key_x", "viewing_public_key_y"],
    "relay payment identity",
  );
  return {
    quoteId: requireBytes(quote.quote_id, 32, "quote id"),
    signingKey: requireBytes(quote.signing_key, 32, "relay signing key"),
    paymentIdentity: {
      spendPublicKey: requireBigInt(
        identity.spend_public_key,
        1n,
        BN254_SCALAR_FIELD - 1n,
        "relay spend public key",
      ),
      viewingPublicKeyX: requireBigInt(
        identity.viewing_public_key_x,
        1n,
        BN254_SCALAR_FIELD - 1n,
        "relay viewing public key x",
      ),
      viewingPublicKeyY: requireBigInt(
        identity.viewing_public_key_y,
        1n,
        BN254_SCALAR_FIELD - 1n,
        "relay viewing public key y",
      ),
    },
    fee: requireBigInt(quote.fee, 0n, MAX_PAYMENT_AMOUNT, "relay fee"),
    expiry: requireBigInt(quote.expiry, 1n, (1n << 64n) - 1n, "relay quote expiry"),
    signature: requireBytes(quote.signature, 64, "relay signature"),
  };
}

function requestFingerprint(contract, method, args) {
  const digest = createHash("sha256");
  digest.update(contract);
  digest.update("\0");
  digest.update(method);
  for (const argument of args) {
    digest.update("\0");
    digest.update(argument.toXDR());
  }
  return digest.digest("hex");
}

export function decodePaymentRelayRequest(body, config, now = Math.floor(Date.now() / 1_000)) {
  const methodConfig = PAYMENT_RELAY_METHODS[body?.method];
  if (
    !body ||
    typeof body.contract !== "string" ||
    body.contract !== config.vault ||
    !methodConfig ||
    !Array.isArray(body.args) ||
    body.args.length !== methodConfig.argumentCount
  ) {
    throw new Error("unsupported payment relay request");
  }
  const args = body.args.map(parseCanonicalScVal);
  const action = scValToNative(requireScValType(args[methodConfig.actionIndex], "scvBytes", "action id"));
  requireBytes(action, 32, "action id");
  if (action.every((value) => value === 0)) throw new Error("invalid action id");
  const expiry = scValToNative(requireScValType(args[methodConfig.expiryIndex], "scvU64", "action expiry"));
  if (expiry < BigInt(now) || expiry > BigInt(now + MAX_ACTION_LIFETIME_SECONDS)) {
    throw new Error("invalid action expiry");
  }
  requireScValType(args[methodConfig.feeEpochIndex], "scvU64", "payment fee epoch");
  if (methodConfig.destinationIndex !== undefined) {
    requireScValType(args[methodConfig.destinationIndex], "scvAddress", "withdrawal destination");
  }
  if (methodConfig.emergencyIndex !== undefined) {
    const emergency = scValToNative(
      requireScValType(args[methodConfig.emergencyIndex], "scvBool", "emergency flag"),
    );
    if (emergency) throw new Error("emergency withdrawals must be submitted by the user");
  }
  const quote = parseQuote(args[methodConfig.quoteIndex]);
  if (
    !quote.signingKey.equals(config.signingKey) ||
    quote.expiry < BigInt(now) ||
    quote.expiry > expiry
  ) {
    throw new Error("invalid relay quote");
  }
  const unsigned = {
    networkDomain: config.networkDomain,
    vault: config.vault,
    token: config.token,
    actionId: action,
    ...quote,
  };
  if (!verify(null, relayQuoteMessage(unsigned), config.publicKey, quote.signature)) {
    throw new Error("invalid relay quote signature");
  }
  parseTransition(args[methodConfig.transitionIndex], methodConfig.actionCode);
  return {
    method: body.method,
    args,
    actionId: action.toString("hex"),
    fingerprint: requestFingerprint(body.contract, body.method, args),
  };
}

export class PaymentRelayService {
  constructor({
    vault,
    token,
    networkDomain,
    signingSeed,
    paymentIdentity,
    fee = 0n,
    quoteTtlSeconds = 120,
    now = () => Math.floor(Date.now() / 1_000),
    random = randomBytes,
    submit,
  }) {
    this.privateKey = privateKeyFromSeed(requireBytes(signingSeed, 32, "relay signing seed"));
    this.config = {
      vault: new Address(vault).toString(),
      token: new Address(token).toString(),
      networkDomain: requireBytes(networkDomain, 32, "network domain"),
      signingKey: publicKeyBytes(this.privateKey),
      publicKey: createPublicKey(this.privateKey),
    };
    this.paymentIdentity = normalizePaymentIdentity(paymentIdentity);
    this.fee = requireBigInt(fee, 0n, MAX_PAYMENT_AMOUNT, "relay fee");
    if (!Number.isSafeInteger(quoteTtlSeconds) || quoteTtlSeconds < 15 || quoteTtlSeconds > 600) {
      throw new Error("invalid relay quote lifetime");
    }
    if (typeof submit !== "function") throw new Error("payment relay submitter is required");
    this.quoteTtlSeconds = quoteTtlSeconds;
    this.now = now;
    this.random = random;
    this.submit = submit;
    this.actions = new Map();
  }

  issueQuote({ actionId, actionExpiry }) {
    const now = this.now();
    const action = requireBytes(Buffer.from(actionId), 32, "action id");
    const expiry = requireBigInt(BigInt(actionExpiry), BigInt(now + 1), BigInt(now + MAX_ACTION_LIFETIME_SECONDS), "action expiry");
    const quote = {
      networkDomain: this.config.networkDomain,
      vault: this.config.vault,
      token: this.config.token,
      actionId: action,
      quoteId: requireBytes(this.random(32), 32, "quote id"),
      signingKey: this.config.signingKey,
      paymentIdentity: this.paymentIdentity,
      fee: this.fee,
      expiry: BigInt(Math.min(Number(expiry), now + this.quoteTtlSeconds)),
    };
    quote.signature = sign(null, relayQuoteMessage(quote), this.privateKey);
    return {
      ...quote,
      xdr: encodeRelayQuote(quote).toXDR("base64"),
    };
  }

  async relay(body) {
    const request = decodePaymentRelayRequest(body, this.config, this.now());
    const prior = this.actions.get(request.actionId);
    if (prior) {
      if (prior.fingerprint !== request.fingerprint) throw new Error("action id already used");
      return prior.result;
    }
    const pending = {
      fingerprint: request.fingerprint,
      result: Promise.resolve().then(() => this.submit({
        contract: this.config.vault,
        method: request.method,
        args: request.args,
      })),
    };
    this.actions.set(request.actionId, pending);
    try {
      return await pending.result;
    } catch (error) {
      this.actions.delete(request.actionId);
      throw error;
    }
  }
}

export async function relayWithFailover({ endpoints, body, fetchImpl = fetch, attempts = 2 }) {
  if (!Array.isArray(endpoints) || endpoints.length === 0 || endpoints.length > 4) {
    throw new Error("invalid payment relay endpoints");
  }
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 3) {
    throw new Error("invalid payment relay retry count");
  }
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    for (const endpoint of endpoints) {
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (response.ok) return await response.json();
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        if (!retryable) throw new Error(`payment relay rejected request with ${response.status}`);
        lastError = new Error(`payment relay unavailable with ${response.status}`);
      } catch (error) {
        if (String(error?.message).includes("rejected request")) throw error;
        lastError = error;
      }
    }
  }
  throw new Error(`all payment relays failed: ${lastError?.message || "unknown error"}`);
}
