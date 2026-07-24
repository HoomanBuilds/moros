if (
  process.env.MOROS_NETWORK &&
  process.env.MOROS_NETWORK !== "testnet"
) {
  throw new Error("deploy:private-testnet requires MOROS_NETWORK=testnet");
}

process.env.MOROS_NETWORK = "testnet";
await import("./deploy-private.mjs");
