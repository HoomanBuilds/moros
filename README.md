# Confidential Prediction Markets on Stellar

A privacy-preserving (zero-knowledge) binary prediction market on Stellar/Soroban:
each trader's **position is private** (hidden bet size + side), the market shows
**live public odds** via an on-chain **LMSR** curve, it **auto-resolves** from a
**Reflector** oracle, and winners **redeem privately**. The ZK is load-bearing —
you cannot hold a hidden-but-valid position without the proof.

> Testnet, unaudited research prototype. Never use with real funds.

## Repository layout

The project is a set of **independently built** components. Each top-level folder
builds and tests on its own; folders are added as we reach that phase of the plan.

| Folder | Component | Status |
|---|---|---|
| `contracts/` | Soroban smart contracts (Rust workspace) | in progress |
| `circuits/` | Circom / Groth16 (BLS12-381) circuits | later |
| `offchain/` | Batcher + relayer + indexer (TypeScript) | later |
| `mcp/` | Any-AI MCP server + CLI + skill | later |
| `frontend/` | Web UI | later |

## Contracts

```
cd contracts
stellar contract build      # wasm32v1-none
cargo test                  # native tests (Soroban test env)
```

## Feasibility

Every core primitive is validated on testnet — ZK proof generation + on-chain
verification (Groth16/BLS12-381), LMSR pricing, a shielded privacy pool, Reflector
oracle resolution, and XLM/USDC settlement.
