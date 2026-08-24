if (process.env.MOROS_PAYMENT_NETWORK && process.env.MOROS_PAYMENT_NETWORK !== "mainnet") {
  throw new Error("deploy-payments-mainnet requires MOROS_PAYMENT_NETWORK=mainnet");
}

process.env.MOROS_PAYMENT_NETWORK = "mainnet";
await import("./deploy-payments.mjs");
