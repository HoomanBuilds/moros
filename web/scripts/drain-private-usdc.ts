import { pathToFileURL } from "node:url";
import {
  installLocalStorage,
  installWalletAdapter,
  log,
  parseArgs,
  parseUsdc,
  publicUsdcBalance,
  recoveryMessage,
  reportSignatureHelp,
  resolveSession,
  runScript,
  shortCommitment,
  usdc,
} from "./private-drain-runtime";

const MAX_ROUNDS = 24;

export async function drainPrivateBalance({
  address,
  requested,
  execute,
}: {
  address: string;
  requested?: bigint;
  execute: boolean;
}): Promise<{ withdrawn: bigint; notes: number }> {
  const [
    { openPrivateWallet },
    { withdrawPrivateUsdc },
    { isLiquidPrivateNote },
    { waitForPrivateOutput },
  ] = await Promise.all([
    import("@/lib/private/wallet"),
    import("@/lib/private/actions"),
    import("@/lib/private/note-selection"),
    import("@/lib/private/output-index"),
  ]);

  const wallet = await openPrivateWallet(address);
  const liquid = wallet.notes.filter(isLiquidPrivateNote);
  log(
    `recovered ${wallet.notes.length} unspent notes, ${liquid.length} spendable, balance ${usdc(wallet.balance)} USDC`,
  );
  for (const note of liquid) {
    log(`  note ${shortCommitment(note.commitment)} ${usdc(note.amount)} USDC`);
  }
  if (wallet.notes.length === 0) {
    return { withdrawn: 0n, notes: 0 };
  }

  let target = requested ?? wallet.balance;
  if (target > wallet.balance) {
    throw new Error(
      `Requested ${usdc(target)} USDC but only ${usdc(wallet.balance)} USDC is spendable`,
    );
  }
  if (target <= 0n) {
    log("nothing to withdraw");
    return { withdrawn: 0n, notes: wallet.notes.length };
  }
  if (!execute) {
    log(
      `dry run: would withdraw ${usdc(target)} USDC to the public wallet ${address}`,
    );
    if (liquid.length > 1) {
      log(
        `dry run: ${liquid.length - 1} note consolidation proofs run first so a single note covers the amount`,
      );
    }
    return { withdrawn: 0n, notes: wallet.notes.length };
  }

  let withdrawn = 0n;
  for (let round = 0; round < MAX_ROUNDS && target > 0n; round++) {
    const snapshot = round === 0 ? wallet : await openPrivateWallet(address);
    if (snapshot.balance <= 0n) break;
    const amount = target < snapshot.balance ? target : snapshot.balance;
    log(`withdrawing ${usdc(amount)} USDC`);
    const result = await withdrawPrivateUsdc(
      address,
      amount,
      (status) => log(`  ${status}`),
    );
    log(`  withdraw tx ${result.hash}`);
    await waitForPrivateOutput(result.outputCommitment);
    withdrawn += amount;
    target -= amount;
  }
  if (target > 0n) {
    log(`${usdc(target)} USDC could not be withdrawn in ${MAX_ROUNDS} rounds`);
  }
  return { withdrawn, notes: wallet.notes.length };
}

async function main(): Promise<void> {
  const { switches, values } = parseArgs(process.argv.slice(2));
  const execute = switches.has("execute");
  installLocalStorage();
  const session = resolveSession(values);
  const address = session.address;
  const { NETWORK } = await import("@/lib/network");
  await installWalletAdapter(session, NETWORK.passphrase);
  log(`network ${NETWORK.id} - wallet ${address}`);
  log(`private service ${NETWORK.privateServiceUrl}`);
  if (!execute) log("dry run - pass --execute to move funds");

  const before = await publicUsdcBalance(
    NETWORK.horizonUrl,
    address,
    NETWORK.collateral.code,
    NETWORK.collateral.issuer,
  );
  if (before !== null) log(`public USDC balance ${usdc(before)}`);

  const requested = values.has("amount")
    ? parseUsdc(values.get("amount") as string)
    : undefined;
  const result = await drainPrivateBalance({ address, requested, execute });
  if (result.notes === 0) {
    reportSignatureHelp(address, await recoveryMessage(address));
    process.exitCode = 1;
    return;
  }
  if (!execute) return;

  log(`withdrew ${usdc(result.withdrawn)} USDC to ${address}`);
  const after = await publicUsdcBalance(
    NETWORK.horizonUrl,
    address,
    NETWORK.collateral.code,
    NETWORK.collateral.issuer,
  );
  if (after !== null) log(`public USDC balance ${usdc(after)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScript(main);
}
