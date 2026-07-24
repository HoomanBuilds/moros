import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Keypair,
  TransactionBuilder,
  contract,
} from "@stellar/stellar-sdk";
import "../config.mjs";
import { networkConfig } from "../network-config.mjs";
import { configureRpcFailover } from "../rpc-failover.mjs";
import { configuredSecret } from "../key-config.mjs";
import {
  CIRCUITS,
  canonicalJson,
  keyPayloadFromJson,
} from "../../circuits/private/artifacts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const network = networkConfig();
const buildRoot = resolve(
  process.env.MOROS_ZK_BUILD_DIR ||
    resolve(repo, network.artifactPath, ".."),
);
const manifestPath = resolve(
  process.env.MOROS_ZK_MANIFEST || resolve(buildRoot, "manifest.json"),
);
const verifierWasm = resolve(
  process.env.MOROS_VERIFIER_WASM ||
    resolve(repo, "contracts/target/wasm32v1-none/release/zk_verifier.wasm"),
);
const verifierId = process.env.MOROS_VERIFIER_ID;
const secret = configuredSecret({
  secret:
    process.env.MOROS_VERIFIER_CONTROLLER_SECRET ||
    network.deployerSecret ||
    network.funderSecret,
  identity: network.deployerIdentity || network.funderIdentity,
  label: `${network.id} verifier controller`,
});
const rpcUrl = configureRpcFailover(network);
if (!verifierId || !secret) {
  throw new Error(
    "set MOROS_VERIFIER_ID and MOROS_VERIFIER_CONTROLLER_SECRET or FUNDER_SK",
  );
}
if (!existsSync(manifestPath) || !existsSync(verifierWasm)) {
  throw new Error("the manifest and built verifier WASM are required");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (
  manifest.network !== network.id ||
  manifest.mainnet_ready !== network.mainnetReady ||
  manifest.circuits.length !== CIRCUITS.length
) {
  throw new Error(`invalid ${network.id} proving manifest`);
}

const controller = Keypair.fromSecret(secret);
const publicKey = controller.publicKey();
const signTransaction = async (xdr, options = {}) => {
  const passphrase = options.networkPassphrase || network.passphrase;
  const transaction = TransactionBuilder.fromXDR(xdr, passphrase);
  transaction.sign(controller);
  return {
    signedTxXdr: transaction.toXDR(),
    signerAddress: publicKey,
  };
};
const client = await contract.Client.fromWasm(readFileSync(verifierWasm), {
  contractId: verifierId,
  networkPassphrase: network.passphrase,
  publicKey,
  rpcUrl,
  signTransaction,
});

function normalized(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, normalized(entry)]),
    );
  }
  return value;
}

function expectedKey(circuit) {
  const entry = manifest.circuits.find(
    (candidate) =>
      candidate.name === circuit.name && candidate.code === circuit.code,
  );
  if (!entry) throw new Error(`manifest is missing ${circuit.name}`);
  const keyPath = resolve(buildRoot, entry.artifacts.contract_key);
  return keyPayloadFromJson(JSON.parse(readFileSync(keyPath, "utf8")));
}

const before = (await client.info()).result;
if (before.required_circuits !== CIRCUITS.length) {
  throw new Error("deployed verifier expects a different circuit count");
}
if (before.circuits > CIRCUITS.length) {
  throw new Error("deployed verifier has an invalid circuit count");
}

for (const circuit of CIRCUITS) {
  const expected = expectedKey(circuit);
  if (circuit.code < before.circuits) {
    const current = (await client.circuit_key({ circuit: expected.circuit }))
      .result;
    assert.equal(
      canonicalJson(normalized(current)),
      canonicalJson(normalized(expected)),
      `${circuit.name} differs from the already registered key`,
    );
    process.stdout.write(`verified existing ${circuit.name} key\n`);
    continue;
  }
  const transaction = await client.add_key({
    controller: publicKey,
    key: expected,
  });
  await transaction.signAndSend();
  const current = (await client.circuit_key({ circuit: expected.circuit }))
    .result;
  assert.equal(
    canonicalJson(normalized(current)),
    canonicalJson(normalized(expected)),
  );
  process.stdout.write(`registered ${circuit.name} key\n`);
}

const current = (await client.info()).result;
let domain = current.domain;
if (!current.finalized) {
  domain = (await (await client.finalize({ controller: publicKey })).signAndSend())
    .result;
}
const finalInfo = (await client.info()).result;
assert.equal(finalInfo.finalized, true);
assert.equal(finalInfo.circuits, CIRCUITS.length);
assert.equal(
  Buffer.from(finalInfo.domain).toString("hex"),
  Buffer.from(domain).toString("hex"),
);

const receipt = {
  network: network.id,
  verifier: verifierId,
  circuits: finalInfo.circuits,
  domain: Buffer.from(finalInfo.domain).toString("hex"),
  manifest_sha256: manifest.circuits.map((entry) => entry.contract_key_sha256),
};
writeFileSync(
  resolve(buildRoot, "verifier-registration.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
console.log(`finalized verifier ${verifierId}`);
