<p align="center">
  <img src="web/public/logo.png" alt="Moros logo" width="120" />
</p>

<h1 align="center">Moros</h1>

<p align="center">
  <b>Zero-knowledge prediction markets on Stellar. Bet on anything — your side and size stay private, the odds stay public.</b>
</p>

> Pick YES or NO on a real-world question, stake XLM, and your position becomes a zero-knowledge commitment. The chain shows live LMSR odds and a settled outcome, but never your side, your size, or a link between your bet and your payout. A threshold committee only ever decrypts the *net* of a batch of orders, and winners redeem privately. Anyone can spin up a new market straight from their wallet.

Moros is a private binary prediction market built on **Stellar / Soroban**. Each market asks a yes/no question about an asset ("will XLM be at or above 0.2500 at settlement?"), prices it with an on-chain **LMSR** market maker so odds are always public, and resolves from an on-chain oracle. What's hidden is *you*: your order is a commitment, your stake's side and size are ElGamal-encrypted to a threshold committee, and the market price only moves when that committee decrypts the **aggregate net** of a whole batch — never a single order. The zero-knowledge is load-bearing: you cannot hold a hidden-but-valid position, or redeem one, without a proof.

Everything in this repository is deployed and exercised on **Stellar testnet**, including full live end-to-end runs of the private lifecycle (place → prove → committee batch → settle → private redeem) and a live multi-market run proving one committee settles independent markets in isolation.

---

## Table of Contents

- [What Moros Does](#what-moros-does)
- [Why It Exists](#why-it-exists)
- [How It Works](#how-it-works)
  - [Creating a Market](#creating-a-market)
  - [Placing a Private Bet](#placing-a-private-bet)
  - [Settlement: the Sealed-Bid Batch](#settlement-the-sealed-bid-batch)
  - [Resolution and Private Redeem](#resolution-and-private-redeem)
  - [The Contracts](#the-contracts)
  - [The Circuits](#the-circuits)
  - [The Committee](#the-committee)
  - [The Web App](#the-web-app)
- [Deployed on Testnet](#deployed-on-testnet)
- [Proven Live](#proven-live)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Tech Stack](#tech-stack)
- [Trust and Security Model](#trust-and-security-model)

---

## What Moros Does

Moros is four systems working as one:

1. **On-chain markets (Rust / Soroban).** Each market is a pair of contracts: an **LMSR market maker** (`lmsr-market`) that prices a binary YES/NO outcome and publishes live odds, and a **shielded pool** (`privacy_pools`) that escrows stakes as commitments, holds the order tree, and enforces the ZK verifier for placement, settlement, and redemption. Anyone can deploy a fresh pair from the browser.

2. **Zero-knowledge circuits (Circom / Groth16 on BLS12-381).** A commitment hasher, an `encrypt_order` circuit that proves an order is a genuine member of the on-chain tree *and* binds an ElGamal ciphertext of its YES/NO amounts to the committee's key, and an `order_redeem_v2` circuit that lets a winner claim a payout to a proof-bound address without revealing which order it was.

3. **A threshold committee (Node.js).** A set of `t`-of-`n` members that run a distributed key generation, hold key shares, and — for each batch — homomorphically sum the encrypted orders and jointly decrypt *only the net*, proving each partial decryption with a Chaum-Pedersen proof, then attest the result with a threshold multisig so the pool can apply it on-chain.

4. **A web app (Next.js).** Connect a Stellar wallet, create a market, place a private bet (the ZK proof runs **in your browser**), watch live odds and a shielded activity feed, and redeem privately from your portfolio. Every figure reads live from the testnet contracts.

Put together: you stake XLM on a side, the chain sees only an opaque commitment, the committee moves the price by the group's net, the oracle decides the outcome, and you redeem your winnings without anyone tying the payout back to you.

---

## Why It Exists

Public prediction markets leak everything. On a transparent order book, your side and size are visible the moment you trade — so anyone can copy you, fade you, or front-run you, and a large or informed position moves the price in a way that broadcasts exactly what you think and how much you're willing to back it. "Just bet anonymously from a fresh wallet" doesn't fix it: the trade itself, and the price impact it causes, are the leak.

Moros removes the leak at the source. Your order is a commitment, its side and size are encrypted, and — crucially — **no single order ever moves the price.** The market only reprices on the *net* of a batch, decrypted by a committee that never sees an individual order. So an observer watching the chain sees a market repricing and a settled outcome, but cannot decompose it into who bet what. The odds stay a useful public signal; the individual positions behind them stay private.

The design leans on batching for exactly this reason. A single-order "batch" would decrypt to that one order, exposing it — which is why the batch size is a privacy parameter, never one. Privacy comes from your order hiding inside the aggregate net of others.

---

## How It Works

### Creating a Market

A market is two contracts. From `/app/create` you pick an underlying asset, a strike price, and an expiry; the browser then signs a short sequence of transactions that deploy an `lmsr-market` instance (with the asset, threshold, LMSR liquidity `b`, and expiry baked into its constructor), deploy a paired `privacy_pools` instance (carrying the circuit verifying keys), and wire them together (`set_batcher`, `set_committee`, `set_redeem_v2_vk`). The new pool then registers itself with the committee so it starts being indexed and settled. Deploying the full shielded stack is a few wallet signatures because Soroban executes one contract call per transaction — a factory contract to collapse it into a single click is a planned improvement.

### Placing a Private Bet

1. **Commit.** The browser hashes your `{amount, side, secret, nullifier}` into a Poseidon255 commitment (`order_commit` circuit).
2. **Place on-chain.** `place_order` deposits your stake into the shielded pool and inserts the commitment into an incremental Merkle order tree. The chain now holds an opaque leaf and some XLM — nothing about your side or size.
3. **Prove privately (in your browser).** The `encrypt_order` circuit proves your commitment is a real member of the on-chain order tree at its root, and binds an ElGamal ciphertext of your YES/NO amounts to the committee's public key. This is a Groth16 proof over BLS12-381 (~30k constraints) — it is the slow step, on the order of a minute or two.
4. **Submit.** The ciphertext + proof go to the committee's intake, which verifies the encryption-validity proof and queues the order. The chain never sees the plaintext; the committee holds only ciphertext.

Before any of this touches the chain, the app preflights the committee — if it's unreachable or doesn't know the pool, nothing is placed, so a failed bet never strands a stake.

### Settlement: the Sealed-Bid Batch

The committee runs a batching window. When it has a batch of queued orders it **homomorphically adds their ciphertexts** and performs a **threshold decryption of the sum only**. Each member contributes a partial decryption with a Chaum-Pedersen proof that it used its real key share; a `t`-of-`n` quorum reconstructs the net `(net_yes, net_no)`. The members then produce a threshold multisig authorizing `submit_batch_committee`, which applies that net to the LMSR market on-chain — moving the public price — and records the clearing price. No individual order is ever decrypted; the committee and the public only ever learn the aggregate.

### Resolution and Private Redeem

At expiry the market resolves its outcome from the on-chain oracle (YES if the asset is at or above the strike). To claim, a winner runs the `order_redeem_v2` circuit in the browser: it proves ownership of a winning position and its clearing-price payout, and burns a nullifier so it can't be double-spent — all bound to a recipient address derived inside the proof. A relayer submits that proof on-chain, and the pool pays the recipient. Because the recipient is fixed by the proof, **no signature ties the payout to the wallet that bet**, so the winner's identity stays private end to end.

### The Contracts

Rust workspace in `contracts/`, built to `wasm32v1-none` with the Stellar CLI:

- **`lmsr-market`** — the binary LMSR market maker. Holds `(qYes, qNo, b)`, exposes `price_yes`, `get_state`, `market_info`, direct `buy`/`sell`, `fund`, `resolve`, and `apply_batch_committee` (the entry the committee's batch is applied through). Its constructor fixes the asset, threshold, expiry, and liquidity.
- **`privacy_pools` (shielded-pool)** — the privacy layer. `place_order` (commitment + staked collateral into an incremental Merkle tree), `deposit`/`withdraw`, `submit_batch_committee` (threshold-multisig-gated net application), `redeem_order_v2` (verifies a redeem proof and pays a proof-bound recipient), plus `set_committee`, `set_batcher`, and the verifying-key setters. Uses a lean incremental Merkle tree (`libs/lean-imt`) and an in-contract Groth16 / BLS12-381 verifier (`libs/zk`).
- **`resolver`** — oracle-driven outcome resolution.

### The Circuits

Circom, compiled to Groth16 over BLS12-381, in `contracts/shielded-pool/circuits/`:

- **`order_commit`** — Poseidon255 commitment hasher; matches the on-chain `OrderCommit`.
- **`encrypt_order`** — the load-bearing one: proves Merkle membership of the order in the on-chain tree and binds an ElGamal ciphertext of the order's YES/NO amounts to the committee's Jubjub (BLS12-381 embedded curve) public key. This is what lets you submit an encrypted order the committee can batch without ever seeing it.
- **`order_redeem_v2`** — private redemption: winning-position validity, clearing-price payout, nullifier (no double-spend), proof-bound recipient.
- **`deposit`, `batch`, `main`** — supporting circuits for the deposit path and batch verification.

### The Committee

Node.js services in `services/`:

- **`server.mjs`** — the multi-pool intake server + indexer + batcher. Serves `/pk` (the committee key), `/proof/:commitment` (Merkle membership, built by the indexer from `order_placed` events), `/order` (queue an encrypted order), `/register-pool`, `/batch`, `/status`, and `/redeem` (relay). It runs a per-pool queue and batching window and settles each market independently.
- **`member.mjs`** — a committee member node. Holds a DKG key share, answers partial-decryption requests with Chaum-Pedersen proofs, and attests batch multisig entries for the pools it serves.
- **crypto** — `jubjub.mjs` (BLS12-381 embedded curve), `threshold-elgamal.mjs`, `dkg-jubjub.mjs` (Feldman-VSS distributed key generation), `chaum-pedersen.mjs` (partial-decryption proofs), `coordinator.mjs` (DKG + partial collection), `submit-multisig.mjs` (threshold-attested on-chain submission), `indexer.mjs`, `relayer.mjs`.

`services/dev-local.sh` brings the whole committee up locally (three members + the intake server) for browser testing.

### The Web App

`web/` is a Next.js 16 App Router app (React 19), landing page plus the dApp at `/app`:

- **Markets** (`/app`) — a featured-market carousel with a **live underlying-asset price chart** (Binance/Coinbase feed) and a "Target" strike line, plus an All-Markets grid/list with search, tabs (All / Live / Favorites / Closed), sort, and favorites.
- **Create** (`/app/create`) — deploy a shielded market from your wallet, with an asset picker, live price preview, and a deploy stepper.
- **Market terminal** (`/app/market/[id]`) — implied probability, the live price chart, a private-bet ticket (with share/payout estimate), a shielded-activity feed (anonymous commitments, no sizes), your positions, an About panel, and threaded comments.
- **Portfolio** (`/app/portfolio`) — your locally-stored private positions and the private-redeem flow.
- **Profile** (`/app/profile`) — optional Supabase-backed display name and avatar.

ZK proving runs in the browser via snarkjs (artifacts served from `web/public/zk`, restored with `npm run zk:sync`). Wallet connection uses the Stellar Wallets Kit. An **optional** Supabase layer (comments, profiles, watchlist, market metadata) is wallet-signature authenticated and degrades gracefully when unconfigured — no trade data ever touches it.

---

## Deployed on Testnet

Everything runs on **Stellar testnet**. Explorer: https://stellar.expert/explorer/testnet

### Flagship shielded market

| Contract | ID |
| -------- | -- |
| LMSR market (`lmsr-market`) | `CBKR2OYQHNBYUSHQEFEHB4GI6BMZYXP35GPYYCBKFRTZBTR6NV3P3MXS` |
| Shielded pool (`privacy_pools`) | `CDUYUZEZBIWRPXM3ITDQZBANHN3Q6B6KUKCBV7MP6BGLYRQCT6QSV23E` |
| Collateral (XLM SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

### Installed WASM (browser-deployable by anyone)

| WASM | Hash |
| ---- | ---- |
| `lmsr_market` | `4d938d18a2e4db3561fa5547c9d9910158fc4fe23514c9beab70df45e738be2b` |
| `privacy_pools` | `c92565b46904b6aa79bbadbb49c66d0b37367a5e39b97eebbff5be0dd81a3655` |

The market and pool WASM are installed on testnet, so the `/app/create` flow deploys new instances by hash directly from the user's wallet — every user-created market is a real on-chain deployment.

### Committee (2-of-3 threshold)

| Member | Address |
| ------ | ------- |
| comm1 | `GCEX2SPXIIFAQ226NREF7DUYHV2DOU66CGMR66B37F72LTYCZCWIYAX7` |
| comm2 | `GCLZ4T3XBNVTHRPGFLT36UBHWGJ3ML5IM3BSHGJOXF45HQ4WVYGXK5F5` |
| comm3 | `GCWRH7LWAFAP6X23SZH3LOIGWPZ5R7RJR7T4TKCXU7SFINOOKKJWIXOU` |

Full deployment records — including batch, redeem, and multi-pool runs — live in [`deployments/`](deployments/).

---

## Proven Live

Two end-to-end runs on testnet, recorded under `deployments/`:

- **Full economics** ([`full-economics-testnet.json`](deployments/full-economics-testnet.json)) — the complete private lifecycle: on-chain orders with real collateral → membership + encryption proofs → committee decrypts *only* the net → the pool funds the market and stores the clearing price → resolve → private redeems paid a winner **+14.75 XLM** (real profit) and refunded a loser **+2.62 XLM**. No individual order was ever revealed.
- **Multi-pool committee** ([`multipool-testnet.json`](deployments/multipool-testnet.json)) — two independent markets sharing one committee. Each pool batched **only its own orders** (nets `30/20` and `8/3`, no cross-leak), members attested for both distinct pools, and a private redeem paid a winner out of a freshly-created market. This proves markets settle in isolation under a single committee.

---

## Project Structure

```
moros/
├── contracts/                         Rust / Soroban workspace (wasm32v1-none)
│   ├── lmsr-market/                   binary LMSR market maker (prices, resolve, apply_batch)
│   ├── shielded-pool/                 privacy_pools: commitments, order tree, batch, redeem
│   │   ├── contract/                  the pool contract
│   │   ├── libs/{zk, lean-imt}        Groth16/BLS12-381 verifier + incremental merkle tree
│   │   └── circuits/                  Circom: order_commit, encrypt_order, order_redeem_v2, ...
│   └── resolver/                      oracle-driven outcome resolution
│
├── services/                          the threshold committee (Node.js)
│   ├── server.mjs                     multi-pool intake + indexer + batcher (/pk /proof /order ...)
│   ├── committee/
│   │   ├── member.mjs                 a committee member node (key share, partials, attest)
│   │   ├── jubjub.mjs / threshold-elgamal.mjs   BLS12-381 embedded-curve threshold ElGamal
│   │   ├── dkg-jubjub.mjs             Feldman-VSS distributed key generation
│   │   ├── chaum-pedersen.mjs         partial-decryption proofs
│   │   ├── coordinator.mjs            DKG + partial collection
│   │   └── submit-multisig.mjs        threshold-attested batch submission
│   ├── indexer.mjs / relayer.mjs      event indexer + private-redeem relayer
│   └── dev-local.sh                   bring the whole committee up locally
│
├── web/                               Next.js 16 app + landing
│   ├── app/app/                       markets, create, market/[id], portfolio, profile
│   ├── components/                    app + markets + landing UI
│   ├── lib/                           stellar reads/writes, zk proving, committee client,
│   │                                  markets registry, wallet store, supabase social
│   └── public/zk/                     browser proving artifacts (npm run zk:sync)
│
└── deployments/                       canonical testnet records + live-run proofs
```

---

## Quick Start

You need the [Stellar CLI](https://developers.stellar.org/docs/tools/cli) (23.x), a recent Rust toolchain, and Node 20+. The `contracts/`, `services/`, and `web/` folders build independently.

```bash
git clone <repo-url> && cd moros

# 1. Contracts (already deployed; build + test locally)
cd contracts
stellar contract build            # -> wasm32v1-none
cargo test                        # Soroban test env

# 2. Committee (3 members + intake server + indexer, for local browser testing)
cd ../services && npm install
bash dev-local.sh                 # serves the committee on http://127.0.0.1:8787
#   stop with: pkill -f committee/member.mjs; pkill -f services/server.mjs

# 3. Web app
cd ../web && npm install
npm run zk:sync                   # copy browser proving artifacts into public/zk
npm run dev                       # http://localhost:3000
```

Then open `http://localhost:3000/app`, connect a testnet wallet (Freighter, funded with test XLM), and either bet on the flagship market or create your own. Placing a private bet runs the ZK proof in your browser — expect the "proving" step to take a minute or two.

The optional social layer needs a Supabase project (see `web/SUPABASE.md` and `web/.env.example`); the app runs fully without it.

---

## Tech Stack

| Layer | Tools |
| ----- | ----- |
| Smart contracts | Rust, Soroban (Stellar CLI 23.x), `wasm32v1-none`, in-contract Groth16 / BLS12-381 verifier |
| Market making | on-chain LMSR (binary YES/NO), oracle resolution |
| Circuits | Circom, Groth16 over BLS12-381, Poseidon255, Jubjub (embedded curve) ElGamal |
| Committee | Node.js, threshold ElGamal, Feldman-VSS DKG, Chaum-Pedersen proofs, `t`-of-`n` multisig attestation |
| In-browser proving | snarkjs 0.7 |
| Frontend | Next.js 16, React 19, `@stellar/stellar-sdk` 16, Stellar Wallets Kit 2.5, TanStack Query 5, ECharts 6, Tailwind 4 |
| Social (optional) | Supabase, wallet-signature auth |
| Network | Stellar testnet |

---

## Trust and Security Model

Moros is an **unaudited research prototype on testnet — never use it with real funds.** The privacy is real but conditional, and it's worth being precise about what it does and doesn't guarantee:

- **Privacy = an honest-threshold committee.** Individual orders are never decrypted; the committee only ever reconstructs the net of a batch. But a colluding quorum (`t` of `n`, currently **2 of 3**) could learn a batch's net, and the members are a fixed set wired into every market. This is threshold privacy, **not** zero-trust — letting creators choose or run their own committee is a planned direction.
- **Privacy comes from batching.** Your order hides inside the aggregate net of others, so the batch size must be ≥ 2. A batch of one would decrypt to that single order and expose it — the batch size is a privacy parameter and is never set to one.
- **Settlement needs the committee running.** Bets are confidential the moment they're placed, but batching, price movement, and redeem only happen while a committee is live and indexing the market's pool. The app auto-registers pools and preflights the committee so a failed placement never strands a stake.
- **In-browser proving is slow.** The BLS12-381 Groth16 proof runs client-side and takes a minute or two per order — the main UX cost of doing real ZK in the browser.
- **The ZK is load-bearing.** You cannot place a hidden-but-valid order, have it counted in a batch, or redeem a winning position without a valid proof — there is no privileged bypass.
