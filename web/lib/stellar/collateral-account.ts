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

export type CollateralAccountState = {
  exists: boolean;
  hasTrustline: boolean;
  balanceAtomic: bigint;
};

export function unfundedCollateralAccountState(): CollateralAccountState {
  return {
    exists: false,
    hasTrustline: false,
    balanceAtomic: 0n,
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
  return {
    exists: true,
    hasTrustline: collateral.native || !!line,
    balanceAtomic: line ? parseBalanceAmount(line.balance, collateral.decimals) : 0n,
  };
}

export function isAccountNotFoundError(cause: unknown): cause is NotFoundError {
  return cause instanceof NotFoundError;
}

export async function getCollateralAccountState(
  address: string,
  collateral: CollateralAsset,
): Promise<CollateralAccountState> {
  const server = new Horizon.Server(NETWORK.horizonUrl);
  try {
    const account = await server.loadAccount(address);
    return collateralStateFromBalances(account.balances as HorizonBalance[], collateral);
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
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK.passphrase })
    .addOperation(Operation.changeTrust({ asset: new Asset(collateral.code, collateral.issuer) }))
    .setTimeout(120)
    .build();
  const { signedTxXdr } = await getKit().signTransaction(tx.toXDR(), {
    networkPassphrase: NETWORK.passphrase,
    address,
  });
  const submitted = await server.submitTransaction(TransactionBuilder.fromXDR(signedTxXdr, NETWORK.passphrase));
  return submitted.hash;
}
