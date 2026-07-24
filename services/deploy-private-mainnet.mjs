if (
  process.env.MOROS_NETWORK &&
  process.env.MOROS_NETWORK !== "mainnet"
) {
  throw new Error("deploy:private-mainnet requires MOROS_NETWORK=mainnet");
}

process.env.MOROS_NETWORK = "mainnet";
const { runMainnetPreflight } = await import("./mainnet-preflight.mjs");
await runMainnetPreflight();
await import("./deploy-private.mjs");
