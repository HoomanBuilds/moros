# Moros market flow

```mermaid
flowchart TD
    A[Any connected user] --> B[Propose supported price market]
    B --> C[Factory validates asset, rules, timing, fee, and liquidity target]
    C --> D[Proposal created without creator USDC]

    E[Any LP] --> F[Shield USDC into reusable private balance]
    F --> G[Deposit private USDC into pooled LP vault]
    G --> H[Pooled vault keeps idle reserve and selects eligible proposal]
    H --> I[Allocate exact USDC target to isolated market vault]
    I --> J[Deploy and activate LMSR market]

    K[Any trader] --> L[Shield any supported USDC amount once]
    L --> M[Reuse private balance across markets and LP actions]
    N[Public proving WASM and proving keys] --> O[Trader browser]
    M --> O
    J --> O
    O --> P[Choose YES or NO and whole-number quantity]
    P --> Q[Generate typed BN254 Groth16 proof locally]
    Q --> R[Relay commitment and encrypted order to shared vault]

    R --> S{Eight orders accepted or 60-second window ended?}
    S -->|No| T[Order waits while visible odds stay unchanged]
    T --> S
    S -->|Yes, one to eight orders| V[Single-VM testnet coordinator builds aggregate]
    V --> W[Batch circuit proves complete uniform allocation]
    W --> X[Shared vault and LMSR execute atomically]
    X --> Y[Public odds move once at one clearing price]
    W -->|Proof or submission cannot complete| U[Pending order becomes privately refundable after deadline]

    Y --> Z[Market reaches settlement time]
    Z --> AA[Keeper reads matching free Reflector feed]
    AA --> AB{Fresh valid settlement price?}
    AB -->|Yes| AC[Resolve YES or NO]
    AB -->|Unavailable through timeout| AD[Permissionlessly void market]

    AC --> AE{Wallet position result}
    AE -->|Winner| AF[Recover execution change and submit private claim proof]
    AE -->|Loser| AG[Recover unused execution change if any]
    AD --> AH[Submit private full refund proof]
    U --> AH

    AF --> AI[Reusable private USDC balance]
    AG --> AI
    AH --> AI
    AC --> AJ[Harvest terminal market capital and vested LP fees]
    AD --> AJ
    AJ --> AK[Pooled LP NAV updates]
    AK --> AL[LP may redeem available private pool shares]

    AM[Wallet-authenticated public social data] --> AN[Supabase comments and images]
    AO[Opaque fixed-size encrypted activity pages] --> AP[Server-only Supabase access]
    AP --> AQ[Wallet decrypts only its own history]
```

The current testnet coordinator holds the combined committee secret on one VM and can recover individual order values. This is not threshold privacy. Mainnet requires independently operated committee members and distributed key custody.

Proving WASM and proving keys are intentionally public. Private witnesses, note secrets, viewing keys, and plaintext activity are not public.

Settlement and payouts are pull-based. A keeper, relayer, or user submits each permissionless transaction. Resolving a market does not automatically transfer every user's funds.

Sports, politics, weather, economics, and other event markets are not part of this active flow. Their creation UI stays disabled until the complete evidence and dispute backend is operational.
