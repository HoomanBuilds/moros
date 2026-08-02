import assert from "node:assert/strict";
import {
  isPrivateRootRaceError,
  privateReadClientOptions,
} from "./contract.ts";

const options = privateReadClientOptions(
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
);

assert.equal("publicKey" in options, false);
assert.equal("signTransaction" in options, false);
assert.equal(
  isPrivateRootRaceError(new Error(
    "simulation failed: HostError: Error(Contract, #8)",
  )),
  true,
);
assert.equal(
  isPrivateRootRaceError(new Error("Error(Contract, #8) after submission")),
  false,
);
assert.match(options.contractId, /^C[A-Z2-7]{55}$/u);

console.log("private read client options ok");
