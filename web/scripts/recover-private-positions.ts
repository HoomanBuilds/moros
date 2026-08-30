import { pathToFileURL } from "node:url";
import type { Position } from "@/lib/positions/book";
import {
  errorDetail,
  installLocalStorage,
  installWalletAdapter,
  log,
  parseArgs,
  recoveryMessage,
  reportSignatureHelp,
  resolveSession,
  runScript,
  shortCommitment,
  usdc,
} from "./private-drain-runtime";

const DEFAULT_APP_URL = "https://predict.moros.fun";

// The encrypted position archive sits behind the app's own Next route, which the
// browser reaches with a relative URL. Rewriting relative requests onto the
// deployed origin lets the unchanged client code run outside a page.
function installAppOriginFetch(origin: string): void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: RequestInit) =>
    typeof input === "string" && input.startsWith("/")
      ? original(`${origin}${input}`, init)
      : original(input as RequestInfo, init)) as typeof fetch;
}

function privateRecord(position: Position): {
  epochNumber: bigint;
  sequence: bigint;
  positionCommitment: bigint;
  side: 0 | 1;
  quantity: bigint;
  positionBudget: bigint;
  executionChangeNullifier: bigint;
  terminalNullifier: bigint;
  encryptionRandomness: bigint;
} | null {
  if (
    position.protocol !== "shared-vault" ||
    position.privateEpoch === undefined ||
    position.privateSequence === undefined ||
    position.executionChangeNullifier === undefined ||
    position.stakeAmountAtomic === undefined
  ) {
    return null;
  }
  return {
    epochNumber: BigInt(position.privateEpoch),
    sequence: BigInt(position.privateSequence),
    positionCommitment: BigInt(position.commitment),
    side: position.side === "1" ? 1 : 0,
    quantity: BigInt(position.amount),
    positionBudget: BigInt(position.stakeAmountAtomic),
    executionChangeNullifier: BigInt(position.executionChangeNullifier),
    terminalNullifier: BigInt(position.nullifier),
    encryptionRandomness: BigInt(position.secret),
  };
}

async function main(): Promise<void> {
  const { switches, values } = parseArgs(process.argv.slice(2));
  const execute = switches.has("execute");
  const origin = (values.get("app-url") || process.env.MOROS_APP_URL
    || DEFAULT_APP_URL).replace(/\/+$/u, "");

  installLocalStorage();
  installAppOriginFetch(origin);
  const session = resolveSession(values);
  const address = session.address;
  const { NETWORK } = await import("@/lib/network");
  await installWalletAdapter(session, NETWORK.passphrase);
  log(`network ${NETWORK.id} - wallet ${address}`);
  log(`position archive ${origin}/api/private-sync`);
  if (!execute) log("dry run - pass --execute to move funds");

  const [
    { restorePositionBackups },
    { listPositions },
    { getPrivatePositionState, runPrivatePositionAction },
    { waitForPrivateOutput },
  ] = await Promise.all([
    import("@/lib/positions/backup"),
    import("@/lib/positions/book"),
    import("@/lib/private/actions"),
    import("@/lib/private/output-index"),
  ]);

  await restorePositionBackups(address);
  const positions = listPositions(address);
  log(`restored ${positions.length} position records`);

  let recovered = 0n;
  let pending = 0n;
  let failed = 0n;
  for (const position of positions) {
    const record = privateRecord(position);
    if (!record) continue;
    const state = await getPrivatePositionState({
      address,
      market: position.market,
      ...record,
    });
    if (!state.action) continue;
    const amount = state.action === "recover-change"
      ? state.changeAmount
      : state.terminalAmount;
    pending += amount;
    log(
      `position ${shortCommitment(record.positionCommitment)} ${state.action} ${usdc(amount)} USDC (outcome ${state.outcome}, market ${position.market}, epoch ${record.epochNumber})`,
    );
    if (!execute) continue;
    // One market's missing committee witness must not strand the others.
    try {
      const result = await runPrivatePositionAction({
        address,
        market: position.market,
        epochNumber: record.epochNumber,
        sequence: record.sequence,
        positionCommitment: record.positionCommitment,
        side: record.side,
        encryptionRandomness: record.encryptionRandomness,
        action: state.action,
        onStatus: (status) => log(`    ${status}`),
      });
      log(`    ${state.action} tx ${result.hash} returned ${usdc(result.amount)} USDC`);
      await waitForPrivateOutput(result.outputCommitment);
      recovered += result.amount;
    } catch (error) {
      failed += amount;
      log(`    SKIPPED: ${errorDetail(error)}`);
    }
  }

  if (pending === 0n) {
    log("no positions have a recoverable balance");
    return;
  }
  log(
    execute
      ? `recovered ${usdc(recovered)} USDC into the private balance`
      : `dry run: ${usdc(pending)} USDC is recoverable`,
  );
  if (failed > 0n) {
    log(`${usdc(failed)} USDC could not be recovered; see the SKIPPED lines above`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScript(async () => {
    try {
      await main();
    } catch (error) {
      if (
        error instanceof Error &&
        /activity key does not match|archive/iu.test(error.message)
      ) {
        const { resolveSession: resolve } = await import("./private-drain-runtime");
        const address = resolve(parseArgs(process.argv.slice(2)).values).address;
        reportSignatureHelp(address, await recoveryMessage(address));
      }
      throw error;
    }
  });
}
