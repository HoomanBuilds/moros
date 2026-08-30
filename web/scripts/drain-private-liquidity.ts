import { pathToFileURL } from "node:url";
import type {
  PooledLiquidityInfo,
  PooledLiquidityNav,
  PooledRedemptionPreview,
} from "@/lib/private/actions";
import { drainPrivateBalance } from "./drain-private-usdc";
import {
  installLocalStorage,
  installWalletAdapter,
  log,
  parseArgs,
  recoveryMessage,
  reportSignatureHelp,
  resolveSession,
  routeRpcThroughService,
  runScript,
  shortCommitment,
  sleep,
  usdc,
} from "./private-drain-runtime";

const VIRTUAL_ASSETS = 1_000_000n;
const VIRTUAL_SHARES = 1_000_000n;
const DEFAULT_ROUNDS = 32;
const DEFAULT_INTERVAL_SECONDS = 300;

type PreviewRedeem = (shares: bigint) => Promise<PooledRedemptionPreview>;

// The pool pays floor(shares * (withdrawal_nav + VIRTUAL_ASSETS) /
// (total_shares + VIRTUAL_SHARES)) and only settles when that lands within
// immediate_assets, so invert the ratio for a first guess and walk it down
// against the contract's own preview until it clears.
async function redeemableShares(
  noteShares: bigint,
  info: PooledLiquidityInfo,
  nav: PooledLiquidityNav,
  preview: PreviewRedeem,
): Promise<{ shares: bigint; assets: bigint }> {
  const empty = { shares: 0n, assets: 0n };
  if (noteShares <= 0n || nav.immediate_assets <= 0n) return empty;
  let candidate = noteShares;
  const rate = nav.withdrawal_nav + VIRTUAL_ASSETS;
  if (rate > 0n) {
    const estimate = nav.immediate_assets * (info.total_shares + VIRTUAL_SHARES)
      / rate;
    if (estimate < candidate) candidate = estimate;
  }
  for (let attempt = 0; attempt < 32 && candidate > 0n; attempt++) {
    const quote = await preview(candidate);
    if (quote.can_redeem_now) {
      return { shares: candidate, assets: quote.assets };
    }
    const scaled = quote.assets > 0n
      ? candidate * quote.immediate_assets / quote.assets
      : 0n;
    candidate = scaled < candidate ? scaled : candidate - 1n;
  }
  return empty;
}

function reportPool(info: PooledLiquidityInfo, nav: PooledLiquidityNav): void {
  log(`  conservative pool value ${usdc(nav.withdrawal_nav)} USDC`);
  log(`  deposit valuation       ${usdc(nav.deposit_nav)} USDC`);
  log(`  idle reserve            ${usdc(nav.idle_assets)} USDC`);
  log(`  immediate exit capacity ${usdc(nav.immediate_assets)} USDC`);
  log(
    `  active market cells ${info.active_allocations}, queued ${info.pending_candidates}`,
  );
  if (nav.limiter_resets_at > 0n) {
    const resets = new Date(Number(nav.limiter_resets_at) * 1000);
    log(`  withdrawal window resets ${resets.toISOString()}`);
  }
}

export async function exitPooledLiquidity({
  address,
  execute,
  watch,
  intervalSeconds,
  maxRounds,
}: {
  address: string;
  execute: boolean;
  watch: boolean;
  intervalSeconds: number;
  maxRounds: number;
}): Promise<{ recovered: bigint; decrypted: boolean }> {
  const [
    { openPrivateWallet },
    {
      getOwnedLiquidityShares,
      getPooledLiquidityState,
      previewPooledLiquidityRedemption,
      withdrawLiquidity,
    },
    { waitForPrivateOutput },
  ] = await Promise.all([
    import("@/lib/private/wallet"),
    import("@/lib/private/actions"),
    import("@/lib/private/output-index"),
  ]);
  const preview: PreviewRedeem = (shares) =>
    previewPooledLiquidityRedemption(address, shares);

  let recovered = 0n;
  for (let round = 0; round < maxRounds; round++) {
    const [wallet, state] = await Promise.all([
      openPrivateWallet(address),
      getPooledLiquidityState(address),
    ]);
    const owned = (await getOwnedLiquidityShares(address, [state.poolId], wallet))
      .filter((share) => share.shares > 0n)
      .sort((left, right) => (right.shares > left.shares ? 1 : -1));

    log(`pool ${state.poolId}`);
    reportPool(state.info, state.nav);
    if (wallet.notes.length === 0) {
      return { recovered, decrypted: false };
    }
    if (owned.length === 0) {
      log("no private pool shares remain");
      return { recovered, decrypted: true };
    }

    const heldShares = owned.reduce((total, share) => total + share.shares, 0n);
    log(`  ${owned.length} private share notes, ${usdc(heldShares)} shares held`);
    for (const share of owned) {
      const quote = await preview(share.shares);
      log(
        `    note ${shortCommitment(share.commitment)} ${usdc(share.shares)} shares worth ${usdc(quote.assets)} USDC${
          quote.can_redeem_now ? "" : " (over immediate capacity)"
        }`,
      );
    }

    let progressed = false;
    for (const share of owned) {
      const plan = await redeemableShares(
        share.shares,
        state.info,
        state.nav,
        preview,
      );
      if (plan.shares <= 0n) continue;
      if (!execute) {
        log(
          `  dry run: would exit ${usdc(plan.shares)} shares from note ${shortCommitment(share.commitment)} for ${usdc(plan.assets)} private USDC`,
        );
        return { recovered, decrypted: true };
      }
      log(
        `  exiting ${usdc(plan.shares)} shares from note ${shortCommitment(share.commitment)}`,
      );
      const result = await withdrawLiquidity({
        address,
        liquidityVaultId: state.poolId,
        shareCommitment: share.commitment,
        shares: plan.shares,
        onStatus: (status) => log(`    ${status}`),
      });
      log(
        `    exit tx ${result.hash} returned ${usdc(result.assets)} private USDC, ${usdc(result.remainingShares)} shares left in the note`,
      );
      await waitForPrivateOutput(result.outputCommitment);
      recovered += result.assets;
      progressed = true;
      break;
    }

    if (!execute) {
      log(
        "  dry run: no shares fit the current immediate exit capacity",
      );
      return { recovered, decrypted: true };
    }
    if (progressed) continue;

    log(
      `immediate exit capacity cannot cover any remaining note; ${usdc(heldShares)} shares stay locked until active market exposure is released`,
    );
    if (!watch) return { recovered, decrypted: true };
    log(`waiting ${intervalSeconds}s before rechecking capacity`);
    await sleep(intervalSeconds * 1000);
  }
  log(`stopped after ${maxRounds} rounds`);
  return { recovered, decrypted: true };
}

async function main(): Promise<void> {
  const { switches, values } = parseArgs(process.argv.slice(2));
  const execute = switches.has("execute");
  const watch = switches.has("watch") || values.has("watch");
  const intervalSeconds = Number(
    values.get("interval") ?? values.get("watch") ?? DEFAULT_INTERVAL_SECONDS,
  );
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 30) {
    throw new Error("--interval must be at least 30 seconds");
  }
  const maxRounds = Number(
    values.get("max-rounds") ?? (watch ? 1_000 : DEFAULT_ROUNDS),
  );
  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    throw new Error("--max-rounds must be a positive integer");
  }

  installLocalStorage();
  const rpcUrl = routeRpcThroughService();
  if (rpcUrl) log(`stellar rpc via service proxy ${rpcUrl}`);
  const session = resolveSession(values);
  const address = session.address;
  const { NETWORK } = await import("@/lib/network");
  await installWalletAdapter(session, NETWORK.passphrase);
  log(`network ${NETWORK.id} - wallet ${address}`);
  log(`private service ${NETWORK.privateServiceUrl}`);
  if (!execute) log("dry run - pass --execute to move funds");

  const result = await exitPooledLiquidity({
    address,
    execute,
    watch,
    intervalSeconds,
    maxRounds,
  });
  if (!result.decrypted) {
    reportSignatureHelp(address, await recoveryMessage(address));
    process.exitCode = 1;
    return;
  }
  if (!execute) return;
  log(`recovered ${usdc(result.recovered)} private USDC from the liquidity pool`);

  if (switches.has("and-unshield")) {
    log("unshielding the private balance to the public wallet");
    const drained = await drainPrivateBalance({ address, execute: true });
    log(`withdrew ${usdc(drained.withdrawn)} USDC to ${address}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScript(main);
}
