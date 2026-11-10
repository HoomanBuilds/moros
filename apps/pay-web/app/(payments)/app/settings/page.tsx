"use client";

import { Check, Copy, Database, Eye, Fingerprint, LockKeyhole, Moon, ShieldCheck, Sun, SunMoon, Trash2 } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { usePaymentWallet } from "@/components/wallet-provider";
import { useTheme, type ThemeMode } from "@/components/theme-provider";
import { paymentDeployment } from "@/lib/deployment";
import { useStellarWallet } from "@/components/stellar-wallet-provider";
import { formatUsdcDisplay } from "@/lib/public-usdc";
import { createIncomingViewingExport } from "@/lib/payment-identity";
import { RecoverySettings } from "@/components/recovery-settings";
import { copyBrowserText } from "@/lib/browser-share";

export default function SettingsPage() {
  return <ProtectedPage><SettingsContent /></ProtectedPage>;
}

function SettingsContent() {
  const wallet = usePaymentWallet();
  const theme = useTheme();
  const stellar = useStellarWallet();
  const [eraseError, setEraseError] = useState("");
  const [erasing, setErasing] = useState(false);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  const [viewingExport, setViewingExport] = useState("");
  const [viewingPending, setViewingPending] = useState(false);
  const [viewingCopied, setViewingCopied] = useState(false);
  const [viewingError, setViewingError] = useState("");
  const recoveryDetail = wallet.recoverySync.status === "synced"
    ? "Your encrypted backup is up to date."
    : wallet.recoverySync.status === "syncing" || wallet.recoverySync.status === "connecting"
      ? "Updating your encrypted backup..."
      : wallet.recoverySync.status === "error"
        ? "Could not update your backup. Your wallet remains available on this device. Try Sync again."
        : "Unlock the private wallet to synchronize encrypted recovery.";
  return (
    <>
      <div className="page settingsPage">
        <PageHeader title="Wallet settings" />
        <div className="settingsList">
          <div className="settingRow"><div><strong>Payment identity</strong><small>{wallet.identity?.recipientFingerprint ?? "Waiting for network configuration"}</small></div><Fingerprint size={19} /></div>
          <div className="settingRow"><div><strong>Network</strong><small>{paymentDeployment.ready ? `Stellar ${paymentDeployment.deployment.environment === "mainnet" ? "Mainnet" : paymentDeployment.deployment.environment === "testnet" ? "Testnet" : paymentDeployment.deployment.environment}` : "Not configured"}</small></div><ShieldCheck size={19} /></div>
          <div className="settingRow"><div><strong>Public Stellar wallet</strong><small>{stellar.address ? `${stellar.address.slice(0, 6)}...${stellar.address.slice(-6)} · ${formatUsdcDisplay(stellar.balanceAtomic)} USDC` : "Not connected"}</small></div>{stellar.address ? <button className="button secondary" type="button" onClick={stellar.disconnect}>Disconnect</button> : <button className="button secondary" type="button" disabled={stellar.status === "connecting" || stellar.status === "loading"} onClick={() => void stellar.connect()}>Connect</button>}</div>
          <div className="settingRow"><div><strong>Encrypted cloud recovery</strong><small>{recoveryDetail}</small>{wallet.recoverySync.error && <details className="paymentHelp"><summary>Error details</summary><p>{wallet.recoverySync.error}</p></details>}</div><button className="button secondary" disabled={wallet.recoverySync.status === "syncing" || wallet.recoverySync.status === "connecting"} onClick={() => void wallet.refreshAll()}><Database size={16} />Sync</button></div>
          <div className="settingRow themeSetting">
            <div><strong>Appearance</strong><small>Use the device theme or choose one.</small></div>
            <div className="themeChoices" role="group" aria-label="Appearance">
              {(["system", "light", "dark"] as ThemeMode[]).map((mode) => (
                <button key={mode} aria-pressed={theme.mode === mode} className={theme.mode === mode ? "active" : ""} type="button" onClick={() => theme.setMode(mode)} aria-label={`${mode} theme`}>
                  {mode === "system" ? <SunMoon size={16} /> : mode === "light" ? <Sun size={16} /> : <Moon size={16} />}
                </button>
              ))}
            </div>
          </div>
          <div className="settingRow"><div><strong>Lock this device</strong><small>Require your password to use this wallet again.</small></div><button className="button secondary" type="button" disabled={wallet.operationPending} onClick={wallet.lock}><LockKeyhole size={17} />Lock</button></div>
        </div>
        {stellar.error && <p className="errorText" role="alert">{stellar.error}</p>}
        <RecoverySettings />
        <details className="panel settingsSection advancedSettings"><summary>Read-only payment access</summary><div className="formStack">
          <div><p className="muted">Export access to incoming payments for your existing receive codes. This access cannot spend USDC or view future codes.</p></div>
          {!viewingExport ? (
            <button className="button secondary" type="button" disabled={viewingPending || !wallet.recoveryPhrase || !paymentDeployment.ready || wallet.profile.status !== "ready"} onClick={() => {
              if (!wallet.recoveryPhrase || !paymentDeployment.ready || !wallet.profile.value) return;
              setViewingPending(true);
              setViewingError("");
              void createIncomingViewingExport(wallet.recoveryPhrase, paymentDeployment.deployment, wallet.profile.value.nextChildIndex - 1)
                .then(setViewingExport)
                .catch((cause) => setViewingError(cause instanceof Error ? cause.message : "Could not create the viewing capability."))
                .finally(() => setViewingPending(false));
            }}><Eye size={17} />{viewingPending ? "Creating..." : "Create read-only capability"}</button>
          ) : (
            <div className="formStack">
              <div className="codeBlock sensitiveCode">{viewingExport}</div>
              <div className="actionRow">
                <button className="button secondary" type="button" onClick={() => { setViewingExport(""); setViewingCopied(false); }}>Close</button>
                <button className="button primary" type="button" onClick={() => {
                  setViewingError("");
                  void copyBrowserText(viewingExport)
                    .then(() => setViewingCopied(true))
                    .catch((cause) => setViewingError(cause instanceof Error ? cause.message : "Could not copy this capability."));
                }}>{viewingCopied ? <Check size={17} /> : <Copy size={17} />}{viewingCopied ? "Copied" : "Copy capability"}</button>
              </div>
            </div>
          )}
          {viewingError && <p className="errorText" role="alert">{viewingError}</p>}
          <p className="finePrint">Only share this with someone you trust to view those payments.</p>
        </div></details>
        <section className="panel formStack settingsSection">
          <div><h2>Remove local wallet</h2><p className="muted">Only do this after verifying your 24-word recovery phrase. Moros cannot restore missing words.</p></div>
          {!confirmErase ? (
            <button className="button danger" type="button" disabled={wallet.operationPending} onClick={() => setConfirmErase(true)}><Trash2 size={17} />Remove from this device</button>
          ) : (
            <div className="formStack">
              <p className="errorText">This deletes the encrypted wallet record from this browser. It does not move or withdraw funds.</p>
              <label className="backupCheck"><input type="checkbox" checked={backupConfirmed} onChange={(event) => setBackupConfirmed(event.target.checked)} />I have saved and checked my 24-word recovery phrase.</label>
              <div className="actionRow">
                <button className="button secondary" type="button" onClick={() => setConfirmErase(false)}>Cancel</button>
                <button className="button danger" type="button" disabled={!backupConfirmed || erasing || wallet.operationPending} onClick={() => {
                  setErasing(true); setEraseError("");
                  void wallet.erase().catch((cause) => setEraseError(cause instanceof Error ? cause.message : "Could not remove the wallet.")).finally(() => setErasing(false));
                }}>{erasing ? "Removing..." : "Delete wallet"}</button>
              </div>
            </div>
          )}
          {eraseError && <p className="errorText" role="alert">{eraseError}</p>}
        </section>
      </div>
    </>
  );
}
