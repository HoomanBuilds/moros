"use client";

import {
  Asset,
  BASE_FEE,
  Horizon,
  NotFoundError,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { NETWORK, type CollateralAsset } from "@/lib/network";
import { getKit } from "@/lib/wallet";
import { parseBalanceAmount } from "./amount";

type HorizonBalance = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
};

type TrustlineReserveInput = {
  nativeBalanceAtomic: bigint;
  subentryCount: number;
  numSponsoring: number;
  numSponsored: number;
  baseReserveAtomic: bigint;
  feeAtomic: bigint;
};

export type CollateralAccountState = {
  exists: boolean;
  hasTrustline: boolean;
  balanceAtomic: bigint;
  nativeBalanceAtomic: bigint;
  trustlineReserveShortfallAtomic: bigint;
};

export function unfundedCollateralAccountState(): CollateralAccountState {
  return {
    exists: false,
    hasTrustline: false,
    balanceAtomic: 0n,
    nativeBalanceAtomic: 0n,
    trustlineReserveShortfallAtomic: 0n,
  };
}

export function collateralStateFromBalances(
  balances: HorizonBalance[],
  collateral: CollateralAsset,
): CollateralAccountState {
  const line = balances.find((balance) => {
    if (collateral.native) return balance.asset_type === "native";
    return balance.asset_code === collateral.code && balance.asset_issuer === collateral.issuer;
  });
  const nativeLine = balances.find((balance) => balance.asset_type === "native");
  return {
    exists: true,
    hasTrustline: collateral.native || !!line,
    balanceAtomic: line ? parseBalanceAmount(line.balance, collateral.decimals) : 0n,
    nativeBalanceAtomic: nativeLine ? parseBalanceAmount(nativeLine.balance, 7) : 0n,
    trustlineReserveShortfallAtomic: 0n,
  };
}

export function isAccountNotFoundError(cause: unknown): cause is NotFoundError {
  return cause instanceof NotFoundError;
}

export function trustlineReserveShortfall({
  nativeBalanceAtomic,
  subentryCount,
  numSponsoring,
  numSponsored,
  baseReserveAtomic,
  feeAtomic,
}: TrustlineReserveInput): bigint {
  const reserveEntries = 3 + subentryCount + numSponsoring - numSponsored;
  const required = BigInt(Math.max(0, reserveEntries)) * baseReserveAtomic + feeAtomic;
  return required > nativeBalanceAtomic ? required - nativeBalanceAtomic : 0n;
}

function resultCodesFromError(cause: unknown): {
  transaction?: string;
  operations?: string[];
} | null {
  if (!cause || typeof cause !== "object") return null;
  const response = "response" in cause ? cause.response : null;
  if (!response || typeof response !== "object") return null;
  const data = "data" in response ? response.data : null;
  if (!data || typeof data !== "object") return null;
  const extras = "extras" in data ? data.extras : null;
  if (!extras || typeof extras !== "object") return null;
  const resultCodes = "result_codes" in extras ? extras.result_codes : null;
  if (!resultCodes || typeof resultCodes !== "object") return null;
  const transaction = "transaction" in resultCodes && typeof resultCodes.transaction === "string"
    ? resultCodes.transaction
    : undefined;
  const operations = "operations" in resultCodes && Array.isArray(resultCodes.operations)
    ? resultCodes.operations.filter((code): code is string => typeof code === "string")
    : undefined;
  return { transaction, operations };
}

export function collateralTrustlineErrorMessage(cause: unknown, code: string): string | null {
  const resultCodes = resultCodesFromError(cause);
  if (!resultCodes) return null;
  if (resultCodes.operations?.some((operation) =>
    operation === "op_low_reserve" ||
    operation === "change_trust_low_reserve"
  )) {
    return `Add more XLM for the Stellar reserve before enabling ${code}`;
  }
  const details = [
    resultCodes.transaction,
    ...(resultCodes.operations ?? []),
  ].filter(Boolean).join(": ");
  return details
    ? `Stellar rejected the ${code} trustline transaction (${details})`
    : `Stellar rejected the ${code} trustline transaction`;
}

let baseReservePromise: Promise<bigint> | null = null;

async function getBaseReserveAtomic(server: Horizon.Server): Promise<bigint> {
  if (!baseReservePromise) {
    baseReservePromise = server
      .ledgers()
      .order("desc")
      .limit(1)
      .call()
      .then((page) => {
        const ledger = page.records[0];
        if (!ledger) throw new Error("Stellar base reserve is unavailable");
        return BigInt(ledger.base_reserve_in_stroops);
      })
      .catch((cause) => {
        baseReservePromise = null;
        throw cause;
      });
  }
  return baseReservePromise;
}

async function collateralStateFromAccount(
  server: Horizon.Server,
  account: Awaited<ReturnType<Horizon.Server["loadAccount"]>>,
  collateral: CollateralAsset,
): Promise<CollateralAccountState> {
  const state = collateralStateFromBalances(account.balances as HorizonBalance[], collateral);
  if (state.hasTrustline) return state;
  const baseReserveAtomic = await getBaseReserveAtomic(server);
  return {
    ...state,
    trustlineReserveShortfallAtomic: trustlineReserveShortfall({
      nativeBalanceAtomic: state.nativeBalanceAtomic,
      subentryCount: account.subentry_count,
      numSponsoring: account.num_sponsoring,
      numSponsored: account.num_sponsored,
      baseReserveAtomic,
      feeAtomic: BigInt(BASE_FEE),
    }),
  };
}

export async function getCollateralAccountState(
  address: string,
  collateral: CollateralAsset,
): Promise<CollateralAccountState> {
  const server = new Horizon.Server(NETWORK.horizonUrl);
  try {
    const account = await server.loadAccount(address);
    return collateralStateFromAccount(server, account, collateral);
  } catch (cause) {
    if (isAccountNotFoundError(cause)) return unfundedCollateralAccountState();
    throw cause;
  }
}

export async function addCollateralTrustline(address: string, collateral: CollateralAsset): Promise<string> {
  if (collateral.native || !collateral.issuer) throw new Error(`${collateral.code} does not require a trustline`);
  const server = new Horizon.Server(NETWORK.horizonUrl);
  let account;
  try {
    account = await server.loadAccount(address);
  } catch (cause) {
    if (isAccountNotFoundError(cause)) {
      throw new Error(`Fund this Stellar account with XLM before enabling ${collateral.code}`);
    }
    throw cause;
  }
  const state = await collateralStateFromAccount(server, account, collateral);
  if (state.trustlineReserveShortfallAtomic > 0n) {
    throw new Error(
      `Add at least ${formatXlmAmount(state.trustlineReserveShortfallAtomic)} more XLM before enabling ${collateral.code}`,
    );
  }
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK.passphrase })
    .addOperation(Operation.changeTrust({ asset: new Asset(collateral.code, collateral.issuer) }))
    .setTimeout(120)
    .build();
  const { signedTxXdr } = await getKit().signTransaction(tx.toXDR(), {
    networkPassphrase: NETWORK.passphrase,
    address,
  });
  try {
    const submitted = await server.submitTransaction(TransactionBuilder.fromXDR(signedTxXdr, NETWORK.passphrase));
    return submitted.hash;
  } catch (cause) {
    throw new Error(
      collateralTrustlineErrorMessage(cause, collateral.code) ??
      (cause instanceof Error ? cause.message : `${collateral.code} could not be enabled`),
    );
  }
}

function formatXlmAmount(amountAtomic: bigint): string {
  const whole = amountAtomic / 10_000_000n;
  const fraction = (amountAtomic % 10_000_000n).toString().padStart(7, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
