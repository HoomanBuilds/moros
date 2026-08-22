import { Address, Keypair } from "@stellar/stellar-sdk";

export const PAYMENT_CIRCUITS = Object.freeze([
  "deposit",
  "transfer_one",
  "transfer_two",
  "transfer_four",
  "withdraw_one",
  "withdraw_two",
  "withdraw_four",
]);

const NETWORKS = Object.freeze({
  "stellar:testnet": "Test SDF Network ; September 2015",
  "stellar:pubnet": "Public Global Stellar Network ; September 2015",
});

function string(value, maximum, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid ${label}`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function contract(value, label) {
  const normalized = new Address(string(value, 128, label)).toString();
  if (!normalized.startsWith("C")) throw new Error(`invalid ${label}`);
  return Object.freeze(normalized);
}

function account(value, label) {
  const normalized = Keypair.fromPublicKey(string(value, 128, label)).publicKey();
  if (!normalized.startsWith("G")) throw new Error(`invalid ${label}`);
  return normalized;
}

function url(value, label, allowHttp) {
  const parsed = new URL(string(value, 2048, label));
  if (parsed.username || parsed.password || parsed.hash || parsed.search) throw new Error(`invalid ${label}`);
  if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:")) {
    throw new Error(`invalid ${label}`);
  }
  return parsed.href.replace(/\/$/, "");
}

function urls(values, label, allowHttp) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 4) {
    throw new Error(`invalid ${label}`);
  }
  const normalized = values.map((value) => url(value, label, allowHttp));
  if (new Set(normalized).size !== normalized.length) throw new Error(`duplicate ${label}`);
  return normalized;
}

function hash(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

function circuitArtifacts(values, allowHttp) {
  if (!Array.isArray(values) || values.length !== PAYMENT_CIRCUITS.length) {
    throw new Error("invalid payment circuit artifacts");
  }
  const byName = new Map();
  for (const value of values) {
    exactObject(
      value,
      ["name", "provingKeyUrl", "schemaHash", "verificationKeyHash", "wasmUrl"],
      "payment circuit artifact",
    );
    if (!value || typeof value !== "object" || !PAYMENT_CIRCUITS.includes(value.name) || byName.has(value.name)) {
      throw new Error("invalid payment circuit artifact");
    }
    byName.set(value.name, Object.freeze({
      name: value.name,
      wasmUrl: url(value.wasmUrl, "payment circuit WASM URL", allowHttp),
      provingKeyUrl: url(value.provingKeyUrl, "payment proving key URL", allowHttp),
      schemaHash: hash(value.schemaHash, "payment circuit schema hash"),
      verificationKeyHash: hash(value.verificationKeyHash, "payment verification key hash"),
    }));
  }
  return Object.freeze(PAYMENT_CIRCUITS.map((name) => byName.get(name)));
}

export function validatePaymentDeployment(value) {
  exactObject(
    value,
    [
      "apiUrls",
      "circuits",
      "environment",
      "format",
      "horizonUrl",
      "maximumRelayFeeAtomic",
      "network",
      "networkPassphrase",
      "rootHistorySize",
      "rpcUrls",
      "startLedger",
      "treeLevels",
      "usdcCode",
      "usdcContract",
      "usdcIssuer",
      "vault",
      "verifier",
    ],
    "payment deployment",
  );
  if (!value || value.format !== 1) throw new Error("invalid payment deployment format");
  const environment = string(value.environment, 32, "payment environment");
  if (!["local", "testnet", "mainnet"].includes(environment)) throw new Error("invalid payment environment");
  const network = string(value.network, 32, "payment network");
  const networkPassphrase = NETWORKS[network];
  if (!networkPassphrase || value.networkPassphrase !== networkPassphrase) {
    throw new Error("payment network passphrase mismatch");
  }
  if ((environment === "mainnet") !== (network === "stellar:pubnet")) {
    throw new Error("payment environment and network mismatch");
  }
  const allowHttp = environment === "local";
  const maximumRelayFeeAtomic = BigInt(string(value.maximumRelayFeeAtomic, 40, "maximum relay fee"));
  if (maximumRelayFeeAtomic < 0n || maximumRelayFeeAtomic >= 1n << 120n) {
    throw new Error("invalid maximum relay fee");
  }
  if (value.usdcCode !== "USDC") throw new Error("payment asset must be USDC");
  const deployment = {
    format: 1,
    environment,
    network,
    networkPassphrase,
    rpcUrls: urls(value.rpcUrls, "payment RPC URL", allowHttp),
    apiUrls: urls(value.apiUrls, "payment API URL", allowHttp),
    horizonUrl: url(value.horizonUrl, "payment Horizon URL", allowHttp),
    vault: contract(value.vault, "payment vault"),
    verifier: contract(value.verifier, "payment verifier"),
    usdcContract: contract(value.usdcContract, "USDC contract"),
    usdcIssuer: account(value.usdcIssuer, "USDC issuer"),
    usdcCode: "USDC",
    treeLevels: integer(value.treeLevels, 8, 31, "payment tree levels"),
    rootHistorySize: integer(value.rootHistorySize, 8, 128, "payment root history size"),
    startLedger: integer(value.startLedger, 1, Number.MAX_SAFE_INTEGER, "payment start ledger"),
    maximumRelayFeeAtomic: maximumRelayFeeAtomic.toString(),
    circuits: circuitArtifacts(value.circuits, allowHttp),
  };
  return Object.freeze(deployment);
}
