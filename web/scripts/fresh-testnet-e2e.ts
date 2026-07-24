import {
  chmodSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import type { PendingProposal } from "@/lib/markets/propose";
import {
  atomicStellarAmount,
  freshOrderSigner,
  freshPositionResult,
  type FreshBettorName,
} from "./fresh-testnet-e2e-helpers";

const SERVICE_URL =
  process.env.NEXT_PUBLIC_PRIVATE_SERVICE_URL
  || process.env.NEXT_PUBLIC_COMMITTEE_URL
  || "https://moros-market.duckdns.org";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const STATE_FILE =
  process.env.MOROS_FRESH_E2E_STATE
  || "/tmp/moros-fresh-testnet-e2e.json";
const USDC_SCALE = 10_000_000n;
const Q32 = 1n << 32n;
const DEPLOYMENT_PATH = resolve(
  process.cwd(),
  "../deployments/private-testnet.json",
);
const ARTIFACT_ROOT = resolve(
  process.cwd(),
  "../circuits/private-build/public",
);
const STELLAR_NETWORK = "Test SDF Network ; September 2015";
const USDC_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

type BettorName = FreshBettorName;

type OrderState = {
  side: 0 | 1;
  quantity: string;
  hash: string;
  positionCommitment: string;
  positionNullifier: string;
  executionChangeNullifier: string;
  encryptionRandomness: string;
  epoch: string;
  sequence: string;
  positionBudget: string;
  lotSize: string;
  signer?: BettorName;
  bettor?: string;
};

type SetupPhase =
  | "draft"
  | "proposal-ready"
  | "registered"
  | "pool-funded"
  | "active"
  | "bettor-funded"
  | "orders"
  | "batched";

type E2eState = {
  format: 2;
  phase: SetupPhase;
  proposal: PendingProposal;
  proposalId: string;
  market: string;
  liquidityVault: string;
  expiry: number;
  bettor: string;
  initialPrice: string;
  batchPrice: string;
  orders: OrderState[];
  bettorFunding?: Array<{
    name: BettorName;
    address: string;
    amount: string;
  }>;
  bettorRecovered?: boolean;
};

const PHASES: SetupPhase[] = [
  "draft",
  "proposal-ready",
  "registered",
  "pool-funded",
  "active",
  "bettor-funded",
  "orders",
  "batched",
];

let activeSigner: Keypair | null = null;

function identity(name: string): Keypair {
  const secret = execFileSync(
    "stellar",
    ["keys", "show", name],
    { encoding: "utf8" },
  ).trim();
  return Keypair.fromSecret(secret);
}

function selectSigner(name: string): string {
  activeSigner = identity(name);
  return activeSigner.publicKey();
}

function installWalletAdapter(): typeof StellarWalletsKit {
  const kit = StellarWalletsKit as unknown as {
    init: () => void;
    signTransaction: (
      xdr: string,
      options?: { networkPassphrase?: string },
    ) => Promise<{
      signedTxXdr: string;
      signerAddress: string;
    }>;
    signMessage: (
      message: string | Uint8Array,
    ) => Promise<{
      signedMessage: string;
      signerAddress: string;
    }>;
  };
  kit.init = () => {};
  kit.signTransaction = async (transactionXdr, options = {}) => {
    if (!activeSigner) throw new Error("Testnet signer is not selected");
    const passphrase = options.networkPassphrase || STELLAR_NETWORK;
    const transaction = TransactionBuilder.fromXDR(
      transactionXdr,
      passphrase,
    );
    transaction.sign(activeSigner);
    return {
      signedTxXdr: transaction.toXDR(),
      signerAddress: activeSigner.publicKey(),
    };
  };
  kit.signMessage = async (message) => {
    if (!activeSigner) throw new Error("Testnet signer is not selected");
    const bytes = typeof message === "string"
      ? Buffer.from(message, "utf8")
      : Buffer.from(message);
    return {
      signedMessage: activeSigner.sign(bytes).toString("base64"),
      signerAddress: activeSigner.publicKey(),
    };
  };
  return StellarWalletsKit;
}

function installLocalStorage(): void {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
    },
  });
}

function log(message: string): void {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((done) => setTimeout(done, milliseconds));
}

async function transferPublicUsdc(
  signer: BettorName,
  destination: string,
  amount: bigint,
): Promise<string> {
  const source = identity(signer);
  const server = new Horizon.Server(
    "https://horizon-testnet.stellar.org",
  );
  const account = await server.loadAccount(source.publicKey());
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK,
  })
    .addOperation(Operation.payment({
      destination,
      asset: new Asset("USDC", USDC_ISSUER),
      amount: atomicStellarAmount(amount),
    }))
    .setTimeout(120)
    .build();
  transaction.sign(source);
  return (await server.submitTransaction(transaction)).hash;
}

function orderSigner(order: OrderState): BettorName {
  return freshOrderSigner(order.signer);
}

async function waitFor<T>(
  label: string,
  timeoutMs: number,
  read: () => Promise<T | null | undefined | false>,
): Promise<T> {
  const started = Date.now();
  let lastReport = 0;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`${label} timed out`);
    }
    if (Date.now() - lastReport >= 30_000) {
      log(`waiting for ${label}`);
      lastReport = Date.now();
    }
    await sleep(5_000);
  }
}

function registryHeaders(): Record<string, string> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase service configuration is required");
  }
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
  };
}

async function createRegistryRow(
  proposal: {
    proposalId: string;
    marketId: string;
    liquidityVaultId: string;
    factoryId: string;
    asset: string;
    address: string;
    rulesHash: string;
    liquidityTarget: string;
    fundingDeadline: number;
    activationCutoff: number;
    expiryUnix: number;
  },
): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/markets_meta`, {
    method: "POST",
    headers: {
      ...registryHeaders(),
      prefer: "return=representation",
    },
    body: JSON.stringify({
      market_id: proposal.marketId,
      pool_id: null,
      asset: proposal.asset,
      collateral_code: "USDC",
      collateral_issuer: USDC_ISSUER,
      collateral_sac:
        "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      collateral_decimals: 7,
      creator: proposal.address,
      title: "Fresh testnet validation: XLM price",
      description:
        "Temporary canonical deployment validation market.",
      category: "Crypto price",
      subject: "XLM",
      resolver_type: "price",
      resolution_source: "Reflector CEX public feed",
      resolution_backup_sources: [],
      resolution_rules:
        "YES resolves when the verified XLM USD price is at or above 0.19.",
      void_rules:
        "VOID after the configured oracle timeout when no fresh verified price is available.",
      rules_hash: proposal.rulesHash,
      proposal_id: proposal.proposalId,
      factory_id: proposal.factoryId,
      liquidity_vault_id: proposal.liquidityVaultId,
      market_state: "funding",
      liquidity_target: proposal.liquidityTarget,
      funding_deadline: new Date(
        proposal.fundingDeadline * 1_000,
      ).toISOString(),
      activation_cutoff: new Date(
        proposal.activationCutoff * 1_000,
      ).toISOString(),
      settlement_time: new Date(
        proposal.expiryUnix * 1_000,
      ).toISOString(),
    }),
  });
  const body = await response.json().catch(() => null);
  if (
    !response.ok
    || !Array.isArray(body)
    || body.length !== 1
    || body[0]?.proposal_id !== proposal.proposalId
  ) {
    throw new Error(
      `Fresh registry insert failed with HTTP ${response.status}`,
    );
  }
}

async function activeRegistryRow(
  proposalId: string,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/markets_meta?proposal_id=eq.${proposalId}&select=*`,
    { headers: registryHeaders(), cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(
      `Fresh registry read failed with HTTP ${response.status}`,
    );
  }
  const rows = await response.json();
  return Array.isArray(rows) && rows.length === 1
    ? rows[0] as Record<string, unknown>
    : null;
}

async function deleteRegistryRow(proposalId: string): Promise<void> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/markets_meta?proposal_id=eq.${proposalId}`,
    {
      method: "DELETE",
      headers: {
        ...registryHeaders(),
        prefer: "return=representation",
      },
    },
  );
  const rows = await response.json().catch(() => null);
  if (
    !response.ok
    || !Array.isArray(rows)
    || rows.length > 1
    || rows.some((row) => row?.proposal_id !== proposalId)
  ) {
    throw new Error(
      `Fresh registry cleanup failed with HTTP ${response.status}`,
    );
  }
}

function saveState(state: E2eState): void {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(STATE_FILE, 0o600);
}

function loadState(requireBatched = true): E2eState {
  if (!existsSync(STATE_FILE)) {
    throw new Error("Fresh testnet E2E state is unavailable");
  }
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as E2eState;
  if (
    state.format !== 2
    || !PHASES.includes(state.phase)
    || !/^C[A-Z2-7]{55}$/u.test(state.market)
    || !/^[0-9a-f]{64}$/u.test(state.proposalId)
    || !Array.isArray(state.orders)
    || state.orders.length > 8
    || (requireBatched && (
      state.phase !== "batched"
      || state.orders.length !== 8
    ))
  ) {
    throw new Error("Fresh testnet E2E state is invalid");
  }
  return state;
}

function phaseAtLeast(state: E2eState, phase: SetupPhase): boolean {
  return PHASES.indexOf(state.phase) >= PHASES.indexOf(phase);
}

function checkpointFromProposal(
  proposal: PendingProposal,
  previous?: E2eState | null,
): E2eState {
  return {
    format: 2,
    phase: proposal.liquidityDeployed
      ? "proposal-ready"
      : previous?.phase ?? "draft",
    proposal,
    proposalId: proposal.proposalId,
    market: proposal.marketId,
    liquidityVault: proposal.liquidityVaultId,
    expiry: proposal.expiryUnix,
    bettor: previous?.bettor ?? identity("charlie").publicKey(),
    initialPrice: previous?.initialPrice ?? "0",
    batchPrice: previous?.batchPrice ?? "0",
    orders: previous?.orders ?? [],
    bettorFunding: previous?.bettorFunding,
  };
}

async function setup(): Promise<void> {
  const [
    { configurePrivateProverArtifactRoot },
    { proposeMarket },
    { registerPrivateProposal },
    {
      fundPooledLiquidity,
      getPooledLiquidityState,
      placePrivateOrder,
      shieldUsdc,
    },
    { openPrivateWallet },
    { readPrivateContract },
    { getPriceYes },
    { addCollateralTrustline, getCollateralAccountState },
    { NETWORK },
  ] = await Promise.all([
    import("@/lib/private/prover"),
    import("@/lib/markets/propose"),
    import("@/lib/private/client"),
    import("@/lib/private/actions"),
    import("@/lib/private/wallet"),
    import("@/lib/private/contract"),
    import("@/lib/stellar/read"),
    import("@/lib/stellar/collateral-account"),
    import("@/lib/network"),
  ]);
  configurePrivateProverArtifactRoot(ARTIFACT_ROOT);

  const deployment = JSON.parse(
    readFileSync(DEPLOYMENT_PATH, "utf8"),
  ) as {
    contracts: {
      factory: string;
      sharedVault: string;
      liquidityPool: string;
    };
  };
  const serviceConfig = await (
    await fetch(`${SERVICE_URL}/private/config`, { cache: "no-store" })
  ).json();
  if (
    serviceConfig.contracts?.factory !== deployment.contracts.factory
    || serviceConfig.contracts?.sharedVault
      !== deployment.contracts.sharedVault
    || serviceConfig.contracts?.liquidityPool
      !== deployment.contracts.liquidityPool
  ) {
    throw new Error("Public service is not using the canonical deployment");
  }

  const creator = selectSigner("moros-testnet-deployer");
  let state = existsSync(STATE_FILE) ? loadState(false) : null;
  let proposal: PendingProposal;
  if (!state || !phaseAtLeast(state, "proposal-ready")) {
    const expiryUnix = state?.proposal.expiryUnix
      ?? Math.floor(Date.now() / 1_000) + 3_600;
    log(state
      ? "resuming the checkpointed fresh market proposal"
      : "proposing a fresh market from a creator with no USDC");
    proposal = await proposeMarket({
      address: creator,
      asset: "XLM",
      strikeUsd: 0.19,
      expiryUnix,
      liquidityTarget: 20n * USDC_SCALE,
      lotSize: Q32 / 4n,
      metadata: {
        title: "Fresh testnet validation: XLM price",
        category: "Crypto price",
      },
      resume: state?.proposal,
      onStep: (step) => log(`proposal step ${step}`),
      onProgress: (current) => {
        state = checkpointFromProposal(current, state);
        saveState(state);
      },
    });
    state = checkpointFromProposal(proposal, state);
    saveState(state);
  } else {
    proposal = state.proposal;
  }
  if (
    proposal.factoryId !== deployment.contracts.factory
    || proposal.marketId !== state.market
    || proposal.liquidityVaultId !== state.liquidityVault
  ) {
    throw new Error("Fresh proposal checkpoint is not canonical");
  }

  if (!phaseAtLeast(state, "registered")) {
    const existingRegistry = await activeRegistryRow(proposal.proposalId);
    if (!existingRegistry) {
      await createRegistryRow(proposal);
    } else if (
      existingRegistry.market_id !== proposal.marketId
      || existingRegistry.factory_id !== deployment.contracts.factory
      || existingRegistry.liquidity_vault_id !== proposal.liquidityVaultId
    ) {
      throw new Error("Fresh registry row does not match its proposal");
    }
    await registerPrivateProposal(proposal.proposalId);
    state = { ...state, phase: "registered" };
    saveState(state);
  }

  const lp = selectSigner("bob");
  if (!phaseAtLeast(state, "pool-funded")) {
    let pool = await getPooledLiquidityState(lp);
    if (pool.info.total_shares === 0n) {
      let wallet = await openPrivateWallet(lp);
      if (wallet.balance < 25n * USDC_SCALE) {
        if (wallet.balance !== 0n) {
          throw new Error("Fresh LP private balance is only partially funded");
        }
        log("shielding 25 USDC for the pooled LP bootstrap");
        const depositHash = await shieldUsdc(
          lp,
          25n * USDC_SCALE,
          (status) => log(status),
        );
        log(`LP public shield confirmed ${depositHash}`);
        wallet = await waitFor(
          "indexed LP private balance",
          180_000,
          async () => {
            const current = await openPrivateWallet(lp);
            return current.balance >= 25n * USDC_SCALE ? current : null;
          },
        );
      }
      if (wallet.balance < 25n * USDC_SCALE) {
        throw new Error("Fresh LP private balance is insufficient");
      }
      log("funding the pooled LP vault from private balance");
      const pooled = await fundPooledLiquidity(
        lp,
        25n * USDC_SCALE,
        (status) => log(status),
      );
      log(`private pooled LP funding confirmed ${pooled.hash}`);
      pool = await waitFor(
        "pooled LP shares",
        180_000,
        async () => {
          const current = await getPooledLiquidityState(lp);
          return current.info.total_shares > 0n ? current : null;
        },
      );
    }
    if (
      pool.info.total_shares !== 25n * USDC_SCALE
      || pool.info.idle_assets + pool.info.deployed_principal
        !== 25n * USDC_SCALE
    ) {
      throw new Error("Fresh pooled LP state contains unexpected capital");
    }
    state = { ...state, phase: "pool-funded" };
    saveState(state);
  }

  log("checking automatic market allocation and activation");
  const registry = await waitFor(
    "fresh market activation",
    300_000,
    async () => {
      const row = await activeRegistryRow(proposal.proposalId);
      return row?.market_state === "active"
        && row.pool_id === deployment.contracts.sharedVault
        ? row
        : null;
    },
  );
  if (registry.market_id !== proposal.marketId) {
    throw new Error("Activated registry market changed");
  }
  if (!phaseAtLeast(state, "active")) {
    state = { ...state, phase: "active" };
    saveState(state);
  }

  const initialPrice = !/^\d+$/u.test(state.initialPrice)
    || state.initialPrice === "0"
    ? await getPriceYes(proposal.marketId)
    : BigInt(state.initialPrice);
  if (state.initialPrice !== initialPrice.toString()) {
    state = { ...state, initialPrice: initialPrice.toString() };
    saveState(state);
  }
  const primaryBettor = selectSigner("charlie");
  if (primaryBettor !== state.bettor) {
    throw new Error("Fresh E2E bettor identity changed");
  }
  if (!phaseAtLeast(state, "bettor-funded")) {
    const bettorPlan: Array<{
      name: BettorName;
      address: string;
      amount: bigint;
    }> = [
      {
        name: "charlie",
        address: primaryBettor,
        amount: 19n * USDC_SCALE / 10n,
      },
      {
        name: "alice",
        address: identity("alice").publicKey(),
        amount: 21n * USDC_SCALE / 10n,
      },
    ];
    const privateBalances = new Map<BettorName, bigint>();
    for (const bettor of bettorPlan) {
      privateBalances.set(
        bettor.name,
        (await openPrivateWallet(bettor.address)).balance,
      );
    }
    const alice = bettorPlan[1];
    let alicePublic = await getCollateralAccountState(
      alice.address,
      NETWORK.collateral,
    );
    if (!alicePublic.hasTrustline) {
      selectSigner("alice");
      log("creating the second bettor USDC trustline");
      const trustlineHash = await addCollateralTrustline(
        alice.address,
        NETWORK.collateral,
      );
      log(`second bettor trustline confirmed ${trustlineHash}`);
      alicePublic = await waitFor(
        "second bettor USDC trustline",
        120_000,
        async () => {
          const current = await getCollateralAccountState(
            alice.address,
            NETWORK.collateral,
          );
          return current.hasTrustline ? current : null;
        },
      );
    }
    const aliceTopUp = alice.amount
      - (privateBalances.get("alice") ?? 0n)
      - alicePublic.balanceAtomic;
    if (aliceTopUp > 0n) {
      const charliePublic = await getCollateralAccountState(
        primaryBettor,
        NETWORK.collateral,
      );
      const charliePrivate = privateBalances.get("charlie") ?? 0n;
      const charlieShielding = bettorPlan[0].amount > charliePrivate
        ? bettorPlan[0].amount - charliePrivate
        : 0n;
      if (charliePublic.balanceAtomic < charlieShielding + aliceTopUp) {
        throw new Error(
          "Public testnet USDC is insufficient for two independent bettors",
        );
      }
      log(
        `funding the second bettor with ${atomicStellarAmount(aliceTopUp)} USDC`,
      );
      const transferHash = await transferPublicUsdc(
        "charlie",
        alice.address,
        aliceTopUp,
      );
      log(`second bettor public funding confirmed ${transferHash}`);
    }
    for (const bettor of bettorPlan) {
      const privateBalance = privateBalances.get(bettor.name) ?? 0n;
      const missing = bettor.amount - privateBalance;
      if (missing > 0n) {
        const publicState = await getCollateralAccountState(
          bettor.address,
          NETWORK.collateral,
        );
        if (
          !publicState.hasTrustline
          || publicState.balanceAtomic < missing
        ) {
          throw new Error(
            `${bettor.name} public testnet USDC is insufficient`,
          );
        }
        selectSigner(bettor.name);
        log(
          `shielding ${atomicStellarAmount(missing)} USDC for ${bettor.name}`,
        );
        const depositHash = await shieldUsdc(
          bettor.address,
          missing,
          (status) => log(status),
        );
        log(`${bettor.name} public shield confirmed ${depositHash}`);
        await waitFor(
          `${bettor.name} indexed private balance`,
          180_000,
          async () => {
            const current = await openPrivateWallet(bettor.address);
            return current.balance >= bettor.amount ? current : null;
          },
        );
      }
    }
    state = {
      ...state,
      phase: "bettor-funded",
      bettorFunding: bettorPlan.map((bettor) => ({
        name: bettor.name,
        address: bettor.address,
        amount: bettor.amount.toString(),
      })),
    };
    saveState(state);
  }

  const inputs: Array<{
    side: 0 | 1;
    quantity: bigint;
    signer: BettorName;
  }> = [
    { side: 1, quantity: 1n, signer: "charlie" },
    { side: 1, quantity: 2n, signer: "alice" },
    { side: 0, quantity: 3n, signer: "charlie" },
    { side: 0, quantity: 1n, signer: "alice" },
    { side: 1, quantity: 2n, signer: "charlie" },
    { side: 0, quantity: 1n, signer: "charlie" },
    { side: 1, quantity: 4n, signer: "alice" },
    { side: 0, quantity: 1n, signer: "alice" },
  ];
  const orders = [...state.orders];
  for (let index = 0; index < orders.length; index++) {
    if (
      orders[index].side !== inputs[index].side
      || BigInt(orders[index].quantity) !== inputs[index].quantity
      || orderSigner(orders[index]) !== inputs[index].signer
    ) {
      throw new Error("Fresh order checkpoint does not match the test plan");
    }
  }
  if (orders.length < inputs.length) {
    const registration = await readPrivateContract<{
      current_epoch: bigint;
    }>(
      deployment.contracts.sharedVault,
      primaryBettor,
      "registration",
      { market: proposal.marketId },
    );
    const epoch = await readPrivateContract<{
      accepted_count: number;
    }>(
      deployment.contracts.sharedVault,
      primaryBettor,
      "epoch",
      {
        market: proposal.marketId,
        epoch_number: registration.current_epoch,
      },
    );
    if (epoch.accepted_count !== orders.length) {
      throw new Error(
        "Private order count diverged from the durable checkpoint",
      );
    }
  }
  for (let index = orders.length; index < inputs.length; index++) {
    const input = inputs[index];
    const bettor = selectSigner(input.signer);
    log(
      `placing ${input.signer} private order ${index + 1} with quantity ${input.quantity}`,
    );
    const result = await placePrivateOrder({
      address: bettor,
      market: proposal.marketId,
      side: input.side,
      quantity: input.quantity,
      onStatus: (status) => log(status),
    });
    orders.push({
      side: input.side,
      quantity: input.quantity.toString(),
      hash: result.hash,
      positionCommitment: result.positionCommitment.toString(),
      positionNullifier: result.positionNullifier.toString(),
      executionChangeNullifier:
        result.executionChangeNullifier.toString(),
      encryptionRandomness: result.encryptionRandomness.toString(),
      epoch: result.epoch.toString(),
      sequence: result.sequence.toString(),
      positionBudget: result.positionBudget.toString(),
      lotSize: result.lotSize.toString(),
      signer: input.signer,
      bettor,
    });
    state = {
      ...state,
      phase: "orders",
      orders: [...orders],
    };
    saveState(state);
    if (index < inputs.length - 1) {
      const price = await getPriceYes(proposal.marketId);
      if (price !== initialPrice) {
        throw new Error("Market price changed before the batch was full");
      }
    }
  }
  const pendingState: E2eState = {
    ...state,
    phase: "orders",
    initialPrice: initialPrice.toString(),
    batchPrice: state.batchPrice === "0"
      ? initialPrice.toString()
      : state.batchPrice,
    orders: [...orders],
  };
  saveState(pendingState);

  const epoch = BigInt(orders[0].epoch);
  await waitFor(
    "atomic private batch execution",
    600_000,
    async () => {
      const batch = await readPrivateContract<unknown>(
        deployment.contracts.sharedVault,
        primaryBettor,
        "batch",
        {
          market: proposal.marketId,
          epoch_number: epoch,
        },
      );
      return batch || null;
    },
  );
  const batchPrice = await waitFor(
    "post-batch market price",
    180_000,
    async () => {
      const price = await getPriceYes(proposal.marketId);
      return price !== initialPrice ? price : null;
    },
  );
  saveState({
    ...pendingState,
    phase: "batched",
    batchPrice: batchPrice.toString(),
  });
  const pool = await getPooledLiquidityState(primaryBettor);
  if (
    pool.info.idle_assets !== 5n * USDC_SCALE
    || pool.info.deployed_principal !== 20n * USDC_SCALE
  ) {
    throw new Error("Pooled liquidity bootstrap accounting is incorrect");
  }
  log(
    `fresh batch executed at one clearing price; market ${proposal.marketId}`,
  );
  log(`market expiry ${new Date(proposal.expiryUnix * 1_000).toISOString()}`);
}

async function settle(): Promise<void> {
  const state = loadState();
  const [
    { configurePrivateProverArtifactRoot },
    {
      getPrivatePositionState,
      getPooledLiquidityState,
      runPrivatePositionAction,
    },
    { readPrivateContract },
  ] = await Promise.all([
    import("@/lib/private/prover"),
    import("@/lib/private/actions"),
    import("@/lib/private/contract"),
  ]);
  configurePrivateProverArtifactRoot(ARTIFACT_ROOT);
  const primaryBettor = selectSigner("charlie");
  if (primaryBettor !== state.bettor) {
    throw new Error("Fresh E2E bettor identity changed");
  }
  if (
    new Set(state.orders.map((order) => orderSigner(order))).size < 2
  ) {
    throw new Error("Fresh settlement requires two independent bettors");
  }
  if (Math.floor(Date.now() / 1_000) < state.expiry) {
    throw new Error(
      `Market has not expired. Retry after ${new Date(
        state.expiry * 1_000,
      ).toISOString()}`,
    );
  }

  log("waiting for keeper resolution and private market finalization");
  await waitFor(
    "private market finalization",
    900_000,
    async () => {
      const accounting = await readPrivateContract<unknown>(
        JSON.parse(readFileSync(DEPLOYMENT_PATH, "utf8"))
          .contracts.sharedVault,
        primaryBettor,
        "accounting",
        { market: state.market },
      );
      return accounting || null;
    },
  );

  let winningPositions = 0;
  let losingPositions = 0;
  for (let index = 0; index < state.orders.length; index++) {
    const order = state.orders[index];
    const signer = orderSigner(order);
    const bettor = selectSigner(signer);
    if (order.bettor && order.bettor !== bettor) {
      throw new Error(`Fresh E2E ${signer} identity changed`);
    }
    const input = {
      address: bettor,
      market: state.market,
      epochNumber: BigInt(order.epoch),
      sequence: BigInt(order.sequence),
      positionCommitment: BigInt(order.positionCommitment),
      side: order.side,
      quantity: BigInt(order.quantity),
      positionBudget: BigInt(order.positionBudget),
      executionChangeNullifier:
        BigInt(order.executionChangeNullifier),
      terminalNullifier: BigInt(order.positionNullifier),
    };
    let chainState = await getPrivatePositionState(input);
    if (chainState.action === "recover-change") {
      log(`recovering private execution change for order ${index + 1}`);
      await runPrivatePositionAction({
        address: bettor,
        market: state.market,
        epochNumber: BigInt(order.epoch),
        sequence: BigInt(order.sequence),
        positionCommitment: BigInt(order.positionCommitment),
        side: order.side,
        encryptionRandomness: BigInt(order.encryptionRandomness),
        action: "recover-change",
        onStatus: (status) => log(status),
      });
      chainState = await waitFor(
        `indexed execution change for order ${index + 1}`,
        180_000,
        async () => {
          const current = await getPrivatePositionState(input);
          return current.changeRecovered ? current : null;
        },
      );
    }
    if (chainState.action === "claim" || chainState.action === "refund") {
      log(`settling private terminal value for order ${index + 1}`);
      await runPrivatePositionAction({
        address: bettor,
        market: state.market,
        epochNumber: BigInt(order.epoch),
        sequence: BigInt(order.sequence),
        positionCommitment: BigInt(order.positionCommitment),
        side: order.side,
        encryptionRandomness: BigInt(order.encryptionRandomness),
        action: chainState.action,
        onStatus: (status) => log(status),
      });
      chainState = await waitFor(
        `indexed terminal action for order ${index + 1}`,
        180_000,
        async () => {
          const current = await getPrivatePositionState(input);
          return current.terminalSpent ? current : null;
        },
      );
    }
    const result = freshPositionResult(order.side, chainState.outcome);
    if (result === "winner") {
      winningPositions++;
    } else if (result === "loser") {
      losingPositions++;
    }
  }
  if (winningPositions === 0 || losingPositions === 0) {
    throw new Error("Fresh settlement did not exercise winners and losers");
  }

  await waitFor(
    "terminal LP harvest",
    300_000,
    async () => {
      const pool = await getPooledLiquidityState(primaryBettor);
      return pool.info.active_allocations === 0 ? pool : null;
    },
  );
  await deleteRegistryRow(state.proposalId);
  unlinkSync(STATE_FILE);
  log(
    `fresh lifecycle complete with ${winningPositions} winning positions and ${losingPositions} losing positions across two bettors`,
  );
}

async function currentServiceConfig(): Promise<{
  contracts: {
    factory: string;
    sharedVault: string;
    liquidityPool: string;
  };
}> {
  const response = await fetch(`${SERVICE_URL}/private/config`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Private service config failed with HTTP ${response.status}`);
  }
  return response.json();
}

async function recoverBettor(): Promise<void> {
  const state = loadState(false);
  if (state.bettorRecovered) {
    log("bettor test funds are already recovered");
    return;
  }
  const [
    { configurePrivateProverArtifactRoot },
    {
      getPrivatePositionState,
      runPrivatePositionAction,
      withdrawPrivateUsdc,
    },
    { openPrivateWallet },
  ] = await Promise.all([
    import("@/lib/private/prover"),
    import("@/lib/private/actions"),
    import("@/lib/private/wallet"),
  ]);
  configurePrivateProverArtifactRoot(ARTIFACT_ROOT);
  const config = await currentServiceConfig();
  if (config.contracts.factory !== state.proposal.factoryId) {
    throw new Error("Private service is no longer serving the recovery deployment");
  }
  const primaryBettor = selectSigner("charlie");
  if (primaryBettor !== state.bettor) {
    throw new Error("Fresh E2E bettor identity changed");
  }
  const owners = new Map<BettorName, string>();
  for (const order of state.orders) {
    const signer = orderSigner(order);
    const bettor = selectSigner(signer);
    if (order.bettor && order.bettor !== bettor) {
      throw new Error(`Fresh E2E ${signer} identity changed`);
    }
    owners.set(signer, bettor);
    const input = {
      address: bettor,
      market: state.market,
      epochNumber: BigInt(order.epoch),
      sequence: BigInt(order.sequence),
      positionCommitment: BigInt(order.positionCommitment),
      side: order.side,
      quantity: BigInt(order.quantity),
      positionBudget: BigInt(order.positionBudget),
      executionChangeNullifier:
        BigInt(order.executionChangeNullifier),
      terminalNullifier: BigInt(order.positionNullifier),
    };
    const chainState = await waitFor(
      `refundable order ${order.sequence}`,
      600_000,
      async () => {
        const current = await getPrivatePositionState(input);
        return current.terminalSpent || current.action === "refund"
          ? current
          : null;
      },
    );
    if (!chainState.terminalSpent) {
      log(`recovering full private refund for order ${order.sequence}`);
      await runPrivatePositionAction({
        address: bettor,
        market: state.market,
        epochNumber: BigInt(order.epoch),
        sequence: BigInt(order.sequence),
        positionCommitment: BigInt(order.positionCommitment),
        side: order.side,
        encryptionRandomness: BigInt(order.encryptionRandomness),
        action: "refund",
        onStatus: (status) => log(status),
      });
      await waitFor(
        `indexed refund for order ${order.sequence}`,
        180_000,
        async () => {
          const current = await getPrivatePositionState(input);
          return current.terminalSpent ? current : null;
        },
      );
    }
  }
  for (const [signer, bettor] of owners) {
    const expected = state.bettorFunding?.find(
      (funding) => funding.name === signer,
    );
    if (expected && expected.address !== bettor) {
      throw new Error(`Fresh E2E ${signer} funding identity changed`);
    }
    const target = expected ? BigInt(expected.amount) : 1n;
    const wallet = await waitFor(
      `${signer} indexed recovered balance`,
      180_000,
      async () => {
        const current = await openPrivateWallet(bettor);
        return current.balance >= target ? current : null;
      },
    );
    selectSigner(signer);
    log(
      `withdrawing ${wallet.balance} recovered private atomic USDC for ${signer}`,
    );
    await withdrawPrivateUsdc(
      bettor,
      wallet.balance,
      (status) => log(status),
    );
  }
  saveState({ ...state, bettorRecovered: true });
  log("bettor test funds recovered to the public wallet");
}

async function recoverLp(): Promise<void> {
  const state = loadState(false);
  const [
    { configurePrivateProverArtifactRoot },
    {
      getOwnedLiquidityShares,
      getPooledLiquidityState,
      withdrawLiquidity,
      withdrawPrivateUsdc,
    },
    { openPrivateWallet },
  ] = await Promise.all([
    import("@/lib/private/prover"),
    import("@/lib/private/actions"),
    import("@/lib/private/wallet"),
  ]);
  configurePrivateProverArtifactRoot(ARTIFACT_ROOT);
  const config = await currentServiceConfig();
  if (config.contracts.factory !== state.proposal.factoryId) {
    throw new Error("Private service is no longer serving the recovery deployment");
  }
  const lp = selectSigner("bob");
  const pool = await waitFor(
    "terminal pooled LP harvest",
    1_800_000,
    async () => {
      const pool = await getPooledLiquidityState(lp);
      return pool.info.active_allocations === 0 ? pool : null;
    },
  );
  const shares = await getOwnedLiquidityShares(
    lp,
    [config.contracts.liquidityPool],
  );
  if (shares.length > 1) {
    throw new Error("Recovery deployment contains unexpected LP share notes");
  }
  if (shares.length === 0 && pool.info.total_shares !== 0n) {
    throw new Error("Recovery LP share note is unavailable");
  }
  if (shares.length === 1) {
    log("redeeming the recovered pooled LP share note");
    await withdrawLiquidity({
      address: lp,
      liquidityVaultId: config.contracts.liquidityPool,
      shareCommitment: shares[0].commitment,
      shares: shares[0].shares,
      onStatus: (status) => log(status),
    });
  }
  const wallet = shares.length === 0
    ? await openPrivateWallet(lp)
    : await waitFor(
        "indexed recovered LP balance",
        180_000,
        async () => {
          const current = await openPrivateWallet(lp);
          return current.balance > 0n ? current : null;
        },
      );
  if (wallet.balance > 0n) {
    log(`withdrawing ${wallet.balance} recovered private atomic USDC`);
    await withdrawPrivateUsdc(lp, wallet.balance, (status) => log(status));
  }
  await deleteRegistryRow(state.proposalId);
  unlinkSync(STATE_FILE);
  log("LP test funds recovered and obsolete registry state removed");
}

const walletAdapter = installWalletAdapter();
installLocalStorage();
process.env.NEXT_PUBLIC_PRIVATE_SERVICE_URL = SERVICE_URL;

async function main(): Promise<void> {
  const { configureWalletKitAdapter } = await import("@/lib/wallet");
  configureWalletKitAdapter(walletAdapter);
  const mode = process.argv[2] || "setup";
  if (mode === "setup") {
    await setup();
  } else if (mode === "settle") {
    await settle();
  } else if (mode === "recover-bettor") {
    await recoverBettor();
  } else if (mode === "recover-lp") {
    await recoverLp();
  } else {
    throw new Error("Use setup, settle, recover-bettor, or recover-lp");
  }
}

main().then(
  () => process.exit(0),
  (cause) => {
    process.stderr.write(
      `${cause instanceof Error ? cause.stack || cause.message : String(cause)}\n`,
    );
    process.exit(1);
  },
);
