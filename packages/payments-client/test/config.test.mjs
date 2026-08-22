import assert from "node:assert/strict";
import { validatePaymentDeployment } from "../src/config.mjs";
import { deployment } from "./fixtures.mjs";

const value = validatePaymentDeployment(deployment());
assert.equal(value.network, "stellar:testnet");
assert.equal(value.usdcCode, "USDC");
assert.equal(value.circuits.length, 7);
assert.equal(Object.isFrozen(value), true);
assert.equal(Object.isFrozen(value.circuits), true);

assert.throws(
  () => validatePaymentDeployment(deployment({ networkPassphrase: "Public Global Stellar Network ; September 2015" })),
  /passphrase mismatch/,
);
assert.throws(
  () => validatePaymentDeployment(deployment({ environment: "mainnet" })),
  /environment and network mismatch/,
);
assert.throws(
  () => validatePaymentDeployment(deployment({ apiUrls: ["http://api.example"] })),
  /payment API URL/,
);
assert.throws(
  () => validatePaymentDeployment(deployment({ apiUrls: ["https://api.example/path?secret=x"] })),
  /payment API URL/,
);
assert.throws(
  () => validatePaymentDeployment(deployment({ usdcCode: "XLM" })),
  /must be USDC/,
);
assert.throws(
  () => validatePaymentDeployment(deployment({ maximumRelayFeeAtomic: "-1" })),
  /maximum relay fee/,
);
assert.throws(
  () => validatePaymentDeployment(deployment({ circuits: deployment().circuits.slice(0, 6) })),
  /circuit artifacts/,
);
const duplicateCircuits = deployment().circuits;
duplicateCircuits[6] = { ...duplicateCircuits[6], name: duplicateCircuits[0].name };
assert.throws(
  () => validatePaymentDeployment(deployment({ circuits: duplicateCircuits })),
  /circuit artifact/,
);

const local = validatePaymentDeployment(deployment({
  environment: "local",
  apiUrls: ["http://127.0.0.1:8787"],
  rpcUrls: ["http://127.0.0.1:8000"],
  horizonUrl: "http://127.0.0.1:8001",
  circuits: deployment().circuits.map((artifact) => ({
    ...artifact,
    wasmUrl: artifact.wasmUrl.replace("https://artifacts.example", "http://127.0.0.1:3000"),
    provingKeyUrl: artifact.provingKeyUrl.replace("https://artifacts.example", "http://127.0.0.1:3000"),
  })),
}));
assert.equal(local.environment, "local");

process.stdout.write("payment deployment config tests passed\n");
