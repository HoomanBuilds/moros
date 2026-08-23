"use client";

import { Database, Fingerprint, LockKeyhole, Moon, ShieldCheck, Sun, SunMoon, Trash2 } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { usePaymentWallet } from "@/components/wallet-provider";
import { useTheme, type ThemeMode } from "@/components/theme-provider";
import { paymentDeployment } from "@/lib/deployment";
import { useStellarWallet } from "@/components/stellar-wallet-provider";
import { formatUsdcAtomic } from "@/lib/public-usdc";

export default function SettingsPage() {
  const wallet = usePaymentWallet();
  const theme = useTheme();
  const stellar = useStellarWallet();
  const [confirmErase, setConfirmErase] = useState(false);
  return (
    <ProtectedPage>
      <div className="page">
        <PageHeader eyebrow="Security" title="Wallet settings" description="Control local access, recovery, and encrypted synchronization." />
        <div className="settingsList">
          <div className="settingRow"><div><strong>Payment identity</strong><small>{wallet.identity?.recipientFingerprint ?? "Waiting for network configuration"}</small></div><Fingerprint size={19} /></div>
          <div className="settingRow"><div><strong>Network</strong><small>{paymentDeployment.ready ? `${paymentDeployment.deployment.environment} · ${paymentDeployment.deployment.network}` : "Not configured"}</small></div><ShieldCheck size={19} /></div>
          <div className="settingRow"><div><strong>Public Stellar wallet</strong><small>{stellar.address ? `${stellar.address.slice(0, 6)}...${stellar.address.slice(-6)} · ${formatUsdcAtomic(stellar.balanceAtomic)} USDC` : "Not connected"}</small></div>{stellar.address ? <button className="button secondary" type="button" onClick={stellar.disconnect}>Disconnect</button> : <button className="button secondary" type="button" onClick={() => void stellar.connect()}>Connect</button>}</div>
          <div className="settingRow"><div><strong>Encrypted cloud recovery</strong><small>Recovery service connection is not configured in this build.</small></div><Database size={19} /></div>
          <div className="settingRow themeSetting">
            <div><strong>Appearance</strong><small>Use the device theme or choose one.</small></div>
            <div className="themeChoices" aria-label="Appearance">
              {(["system", "light", "dark"] as ThemeMode[]).map((mode) => (
                <button key={mode} className={theme.mode === mode ? "active" : ""} type="button" onClick={() => theme.setMode(mode)} aria-label={`${mode} theme`}>
                  {mode === "system" ? <SunMoon size={16} /> : mode === "light" ? <Sun size={16} /> : <Moon size={16} />}
                </button>
              ))}
            </div>
          </div>
          <div className="settingRow"><div><strong>Lock this device</strong><small>Clear decrypted wallet material from this session.</small></div><button className="button secondary" type="button" onClick={wallet.lock}><LockKeyhole size={17} />Lock</button></div>
        </div>
        <section className="panel formStack" style={{ marginTop: 18 }}>
          <div><p className="eyebrow">Danger zone</p><h2>Remove local wallet</h2><p className="muted">Only do this after verifying your 24-word recovery phrase. Moros cannot restore missing words.</p></div>
          {!confirmErase ? (
            <button className="button danger" type="button" onClick={() => setConfirmErase(true)}><Trash2 size={17} />Remove from this device</button>
          ) : (
            <div className="formStack">
              <p className="errorText">This permanently deletes the encrypted wallet record from this browser.</p>
              <div className="actionRow">
                <button className="button secondary" type="button" onClick={() => setConfirmErase(false)}>Cancel</button>
                <button className="button danger" type="button" onClick={wallet.erase}>Delete wallet</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </ProtectedPage>
  );
}
