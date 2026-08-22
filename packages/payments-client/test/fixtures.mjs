import { StrKey } from "@stellar/stellar-sdk";
import { PAYMENT_CIRCUITS } from "../src/config.mjs";

export function deployment(overrides = {}) {
  return {
    format: 1,
    environment: "testnet",
    network: "stellar:testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrls: ["https://rpc-one.example", "https://rpc-two.example"],
    apiUrls: ["https://api-one.example", "https://api-two.example"],
    horizonUrl: "https://horizon-testnet.stellar.org",
    vault: StrKey.encodeContract(Buffer.alloc(32, 1)),
    verifier: StrKey.encodeContract(Buffer.alloc(32, 2)),
    usdcContract: StrKey.encodeContract(Buffer.alloc(32, 3)),
    usdcIssuer: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4)),
    usdcCode: "USDC",
    treeLevels: 24,
    rootHistorySize: 64,
    startLedger: 100,
    maximumRelayFeeAtomic: "10000",
    circuits: PAYMENT_CIRCUITS.map((name, index) => ({
      name,
      wasmUrl: `https://artifacts.example/${name}.wasm`,
      provingKeyUrl: `https://artifacts.example/${name}.zkey`,
      schemaHash: index.toString(16).padStart(64, "0"),
      verificationKeyHash: (index + 10).toString(16).padStart(64, "0"),
    })),
    ...overrides,
  };
}
