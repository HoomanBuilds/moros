import { Keypair, StrKey } from "@stellar/stellar-sdk";
import type { PaymentDeployment } from "@moros/payments-client";

const names = ["deposit", "transfer_one", "transfer_two", "transfer_four", "withdraw_one", "withdraw_two", "withdraw_four"];

function contract(byte: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, byte));
}

export function testDeployment(): PaymentDeployment {
  return {
    format: 1,
    environment: "testnet",
    network: "stellar:testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrls: ["https://rpc.example.com"],
    apiUrls: ["https://api.example.com"],
    horizonUrl: "https://horizon-testnet.stellar.org",
    vault: contract(1),
    verifier: contract(2),
    usdcContract: contract(3),
    usdcIssuer: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4)).publicKey(),
    usdcCode: "USDC",
    treeLevels: 24,
    rootHistorySize: 32,
    startLedger: 1,
    maximumRelayFeeAtomic: "10000",
    circuits: names.map((name) => ({
      name,
      wasmUrl: `https://artifacts.example.com/${name}.wasm`,
      provingKeyUrl: `https://artifacts.example.com/${name}.zkey`,
      schemaHash: "11".repeat(32),
      verificationKeyHash: "22".repeat(32),
    })),
  };
}
