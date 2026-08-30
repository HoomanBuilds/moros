import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import type * as WalletModule from "@/lib/wallet";

type WalletAdapter = Parameters<
  typeof WalletModule.configureWalletKitAdapter
>[0];

const SECRET = /^S[A-Z2-7]{55}$/u;
const ADDRESS = /^G[A-Z2-7]{55}$/u;
const USDC_DECIMALS = 7;
const USDC_SCALE = 10n ** BigInt(USDC_DECIMALS);

export type PrivateSession = {
  address: string;
  keypair?: Keypair;
  signMessage: (message: string) => string;
  signTransaction: (xdr: string, passphrase: string) => string;
};

export function log(message: string): void {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((done) => setTimeout(done, milliseconds));
}

export function usdc(atomic: bigint): string {
  const negative = atomic < 0n;
  const absolute = negative ? -atomic : atomic;
  const fraction = (absolute % USDC_SCALE)
    .toString()
    .padStart(USDC_DECIMALS, "0");
  return `${negative ? "-" : ""}${absolute / USDC_SCALE}.${fraction}`;
}

export function parseUsdc(value: string): bigint {
  const input = value.trim();
  if (!/^\d+(?:\.\d+)?$/u.test(input)) {
    throw new Error(`"${value}" is not a valid USDC amount`);
  }
  const [whole, fraction = ""] = input.split(".");
  if (fraction.length > USDC_DECIMALS) {
    throw new Error(`USDC supports at most ${USDC_DECIMALS} decimal places`);
  }
  return BigInt(whole) * USDC_SCALE
    + BigInt(fraction.padEnd(USDC_DECIMALS, "0") || "0");
}

export function shortCommitment(commitment: bigint): string {
  return `0x${commitment.toString(16).padStart(64, "0").slice(0, 12)}`;
}

export function parseArgs(argv: string[]): {
  switches: Set<string>;
  values: Map<string, string>;
} {
  const switches = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument ${token}`);
    }
    const separator = token.indexOf("=");
    if (separator > 2) {
      values.set(token.slice(2, separator), token.slice(separator + 1));
      continue;
    }
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(name, next);
      index++;
      continue;
    }
    switches.add(name);
  }
  return { switches, values };
}

export function installLocalStorage(): void {
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

// Freighter signs SEP-53: sha256 over "Stellar Signed Message:\n" concatenated
// with the message, returned base64. This is what seeds the note keys, so a
// local key must sign the same payload to reproduce them.
export function sep53Signature(signer: Keypair, message: string): string {
  const payload = createHash("sha256")
    .update(Buffer.concat([
      Buffer.from("Stellar Signed Message:\n", "utf8"),
      Buffer.from(message, "utf8"),
    ]))
    .digest();
  return signer.sign(payload).toString("base64");
}

function keypairFromEnvironment(identity?: string): Keypair {
  const secret = process.env.MOROS_STELLAR_SECRET?.trim();
  if (secret) {
    if (!SECRET.test(secret)) {
      throw new Error("MOROS_STELLAR_SECRET is not a Stellar secret key");
    }
    return Keypair.fromSecret(secret);
  }
  const name = identity || process.env.MOROS_STELLAR_IDENTITY;
  if (!name) {
    throw new Error(
      "Set MOROS_STELLAR_IDENTITY or MOROS_STELLAR_SECRET, or MOROS_RECOVERY_SIGNATURE",
    );
  }
  const shown = execFileSync("stellar", ["keys", "show", name], {
    encoding: "utf8",
  }).trim();
  if (!SECRET.test(shown)) {
    throw new Error(`stellar keys show ${name} did not return a secret key`);
  }
  return Keypair.fromSecret(shown);
}

function requireAddress(candidate: string | undefined): string {
  const address = candidate?.trim();
  if (!address || !ADDRESS.test(address)) {
    throw new Error(
      "Set MOROS_WALLET_ADDRESS (or --address) to the wallet that owns the private notes",
    );
  }
  return address;
}

// A supplied signature still wins, so a wallet that does not follow SEP-53 can
// be drained by pasting its own signature over the recovery message.
export function resolveSession(values: Map<string, string>): PrivateSession {
  const supplied = (
    values.get("signature") || process.env.MOROS_RECOVERY_SIGNATURE
  )?.trim();
  const expected = values.get("address") || process.env.MOROS_WALLET_ADDRESS;
  if (supplied) {
    const address = requireAddress(expected);
    return {
      address,
      signMessage: () => supplied,
      signTransaction: () => {
        throw new Error(
          "Signing a transaction needs MOROS_STELLAR_IDENTITY or MOROS_STELLAR_SECRET",
        );
      },
    };
  }
  const signer = keypairFromEnvironment(values.get("identity"));
  const address = signer.publicKey();
  if (expected && expected.trim() !== address) {
    throw new Error(`Signer resolves to ${address}, not ${expected.trim()}`);
  }
  return {
    address,
    keypair: signer,
    signMessage: (message) => sep53Signature(signer, message),
    signTransaction: (xdr, passphrase) => {
      const transaction = TransactionBuilder.fromXDR(xdr, passphrase);
      transaction.sign(signer);
      return transaction.toXDR();
    },
  };
}

export async function installWalletAdapter(
  session: PrivateSession,
  passphrase: string,
): Promise<void> {
  const { configureWalletKitAdapter } = await import("@/lib/wallet");
  const adapter = {
    init: () => {},
    signTransaction: async (
      transactionXdr: string,
      options: { networkPassphrase?: string } = {},
    ) => ({
      signedTxXdr: session.signTransaction(
        transactionXdr,
        options.networkPassphrase || passphrase,
      ),
      signerAddress: session.address,
    }),
    signMessage: async (message: string | Uint8Array) => ({
      signedMessage: session.signMessage(
        typeof message === "string"
          ? message
          : Buffer.from(message).toString("utf8"),
      ),
      signerAddress: session.address,
    }),
  };
  configureWalletKitAdapter(adapter as unknown as WalletAdapter);
}

export async function recoveryMessage(address: string): Promise<string> {
  const [{ NETWORK }, { getPrivateConfig }, { backupMessage }, { resolveArchiveVault }] =
    await Promise.all([
      import("@/lib/network"),
      import("@/lib/private/client"),
      import("@/lib/positions/crypto"),
      import("@/lib/positions/backup-vault"),
    ]);
  const config = await getPrivateConfig();
  const vault = resolveArchiveVault(undefined, config.contracts.sharedVault);
  return backupMessage(address, NETWORK.id, vault);
}

export function reportSignatureHelp(address: string, message: string): void {
  log("no encrypted notes decrypted with the current recovery signature");
  log(
    "open the Moros app tab where the wallet is already connected, run this in the browser console, and rerun with MOROS_RECOVERY_SIGNATURE set to the printed value:",
  );
  process.stdout.write(
    `\nconst message = ${JSON.stringify(message)};\n`
      + `const result = await window.freighterApi.signMessage(message, { address: ${JSON.stringify(address)} });\n`
      + "const raw = result.signedMessage;\n"
      + "console.log(typeof raw === \"string\" ? raw : btoa(String.fromCharCode(...new Uint8Array(raw.data ?? Object.values(raw)))));\n\n",
  );
}

export async function publicUsdcBalance(
  horizonUrl: string,
  address: string,
  code: string,
  issuer: string | null,
): Promise<bigint | null> {
  const response = await fetch(`${horizonUrl}/accounts/${address}`, {
    cache: "no-store",
  });
  if (!response.ok) return null;
  const account = await response.json() as {
    balances?: Array<{
      balance: string;
      asset_code?: string;
      asset_issuer?: string;
      asset_type: string;
    }>;
  };
  const entry = account.balances?.find((balance) =>
    balance.asset_code === code && balance.asset_issuer === issuer
  );
  if (!entry) return null;
  return parseUsdc(entry.balance);
}

export function runScript(main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
