import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";
import { configuredSecret } from "./key-config.mjs";

const secret = Keypair.random().secret();
assert.equal(
  configuredSecret({
    secret,
    identity: "",
    label: "deployer",
  }),
  secret,
);
assert.equal(
  configuredSecret(
    {
      secret: "",
      identity: "release",
      label: "deployer",
    },
    (identity) => {
      assert.equal(identity, "release");
      return secret;
    },
  ),
  secret,
);
assert.equal(
  configuredSecret({
    secret: "",
    identity: "",
    label: "deployer",
  }),
  "",
);
assert.throws(
  () => configuredSecret({
    secret: "invalid",
    identity: "",
    label: "deployer",
  }),
  /valid Stellar secret/,
);

console.log("key config ok");
