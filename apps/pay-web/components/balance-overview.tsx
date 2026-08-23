"use client";

import { RefreshCw, Unplug, WalletCards } from "lucide-react";
import { formatUsdcAtomic } from "@/lib/public-usdc";
import { useStellarWallet } from "./stellar-wallet-provider";
import { usePaymentWallet } from "./wallet-provider";

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

export function BalanceOverview() {
  const publicWallet = useStellarWallet();
  const privateWallet = usePaymentWallet();
  const busy = publicWallet.status === "connecting" || publicWallet.status === "loading";
  const publicDetail = !publicWallet.address
    ? "Connect Freighter"
    : publicWallet.status === "wrong_network"
      ? "Wrong network"
      : publicWallet.accountActive === false
        ? "Account not active"
        : publicWallet.hasTrustline === false
          ? "USDC trustline needed"
          : shortAddress(publicWallet.address);

  return (
    <section className="balanceOverview" aria-label="USDC balances">
      <div className="balanceMetric">
        <span className="balanceMetricLabel">
          Spendable privately
          {privateWallet.status === "unlocked" && (
            <button
              className="balanceRefresh"
              type="button"
              onClick={() => void privateWallet.refreshBalance()}
              disabled={privateWallet.balance.status === "syncing"}
              aria-label="Refresh private balance"
            >
              <RefreshCw size={13} />
            </button>
          )}
        </span>
        <strong>{formatUsdcAtomic(privateWallet.balance.spendableAtomic)}</strong>
        <small>{privateWallet.balance.status === "syncing" ? "Syncing encrypted notes" : "Shielded USDC"}</small>
      </div>
      <div className="balanceMetric">
        <span>Encrypted recovery</span>
        <strong>{privateWallet.recoverySync.status === "synced" ? "Synced" : privateWallet.status === "unlocked" ? "Local" : "Locked"}</strong>
        <small>{privateWallet.recoverySync.status === "error" ? "Sync needs attention" : "Private profile state"}</small>
      </div>
      <div className="balanceMetric publicBalanceMetric">
        <span>Public Stellar wallet</span>
        <strong>{formatUsdcAtomic(publicWallet.balanceAtomic)}</strong>
        <small>{publicDetail}</small>
      </div>
      <div className="balanceControls">
        {!publicWallet.address ? (
          <button className="button secondary compactButton" type="button" onClick={() => void publicWallet.connect()} disabled={busy}>
            <WalletCards size={16} />{busy ? "Connecting" : "Connect wallet"}
          </button>
        ) : (
          <>
            <button className="iconButton" type="button" onClick={() => void publicWallet.refresh()} disabled={busy} aria-label="Refresh public balance"><RefreshCw size={16} /></button>
            <button className="iconButton" type="button" onClick={publicWallet.disconnect} aria-label="Disconnect public wallet"><Unplug size={16} /></button>
          </>
        )}
      </div>
      {(privateWallet.balance.error || publicWallet.error) && (
        <p className="balanceError" role="alert">
          {privateWallet.balance.error || publicWallet.error}
        </p>
      )}
    </section>
  );
}
