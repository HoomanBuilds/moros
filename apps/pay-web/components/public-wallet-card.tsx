"use client";
import { WalletCards } from "lucide-react";
import { useStellarWallet } from "./stellar-wallet-provider";
import { formatUsdcDisplay } from "@/lib/public-usdc";

export function PublicWalletCard() {
  const wallet = useStellarWallet();
  const busy = wallet.status === "connecting" || wallet.status === "loading";
  return <section className="panel publicWalletPanel"><div className="panelHeading"><span><WalletCards size={19} />Stellar wallet</span></div>
    {wallet.address ? <><p className="publicAmount">{formatUsdcDisplay(wallet.balanceAtomic)} <small>USDC</small></p><p className="mono muted">{wallet.address.slice(0, 8)}...{wallet.address.slice(-8)}</p><div className="actionRow"><button className="textButton" disabled={busy} onClick={() => void wallet.refresh()}>{busy ? "Refreshing..." : "Refresh"}</button><button className="textButton" onClick={wallet.disconnect}>Disconnect</button></div></> : <><p className="muted">Connect Freighter to view your public USDC and add funds.</p><button className="button secondary" disabled={busy} onClick={() => void wallet.connect()}>{busy ? "Connecting..." : "Connect Freighter"}</button></>}
    {wallet.accountActive === false && <p className="finePrint">Activate your Stellar account with XLM in Freighter.</p>}
    {wallet.hasTrustline === false && wallet.accountActive && <p className="finePrint">Add Circle USDC as an asset in Freighter.</p>}
    {wallet.error && <p className="errorText" role="alert">{wallet.error}</p>}
  </section>;
}
