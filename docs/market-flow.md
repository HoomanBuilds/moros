# Moros market flow

```mermaid
flowchart TD
    A[Any connected user] --> B[Create price or event market]
    B --> C[Wallet deploys LMSR market and shielded pool]
    C --> D[Circle testnet USDC liquidity and immutable configuration]
    D --> E[Open market]

    F[Public circuit WASM and proving key] --> G[User browser]
    E --> G
    G --> H[Create commitment and encrypted-side proof locally]
    H --> I[Wallet deposits a USDC bucket into the pool]
    H --> J[Committee verifies proof and queues ciphertext]
    J --> K[2-of-3 committee decrypts aggregate only]
    K --> L[Pool submits a batch of at least 2 orders]
    L --> M[LMSR odds update]

    M --> N[Market closes]
    N --> O{Resolution type}
    O -->|Crypto, FX, XAU price| P[Free Reflector CEX or fiat feed]
    O -->|Equities, commodities, sports, economics, weather, politics, other| Q[Primary and backup evidence plus bonded challenge]
    P --> R{YES, NO, or oracle timeout}
    Q --> S{YES, NO, or VOID}
    R --> T[Resolved or voided market]
    S --> T

    T --> U{Order status}
    U -->|Winning included order| V[Browser generates redemption proof]
    U -->|Voided order| W[User requests full refund]
    U -->|Missed final batch| W
    V --> X[Pool pays user and sends 2% of winning profit to treasury]
    W --> Y[Pool returns full stake with no fee]
```

Circuit files in web/public/zk are intentionally public. The order secret, nullifier, proof witness, and position record stay in the user's browser.

Settlement and payouts are pull-based. A keeper, relayer, or user must submit each permissionless transaction. Resolving a market does not automatically transfer every user's funds.
