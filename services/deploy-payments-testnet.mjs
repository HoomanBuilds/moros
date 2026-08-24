if (process.env.MOROS_PAYMENT_NETWORK && process.env.MOROS_PAYMENT_NETWORK !== "testnet") {
  throw new Error("deploy-payments-testnet requires MOROS_PAYMENT_NETWORK=testnet");
}

process.env.MOROS_PAYMENT_NETWORK = "testnet";
await import("./deploy-payments.mjs");
