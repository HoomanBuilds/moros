"use client";

import { Check, Copy, Eye, EyeOff, Fingerprint, KeyRound, LockKeyhole, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import { FormEvent, useState } from "react";
import { formatUsdcAtomic } from "@/lib/public-usdc";
import { copyBrowserText } from "@/lib/browser-share";
import { useStellarWallet } from "./stellar-wallet-provider";
import { usePaymentWallet } from "./wallet-provider";

function PasswordField({ value, onChange, label = "Wallet password", autoComplete = "current-password" }: {
  value: string;
  onChange(value: string): void;
  label?: string;
  autoComplete?: "current-password" | "new-password";
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <span className="passwordField">
        <input
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          minLength={12}
          maxLength={256}
          required
        />
        <button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)}>
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
    </label>
  );
}

function RecoveryBackup({ phrase, onDone }: { phrase: string; onDone(): void }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [checks, setChecks] = useState(["", "", ""]);
  const words = phrase.split(" ");
  const positions = [3, 11, 20];
  const confirmed = positions.every((position, index) => checks[index].trim().toLowerCase() === words[position]);
  async function copy() {
    setCopyError("");
    try {
      await copyBrowserText(phrase);
      setCopied(true);
    } catch (cause) {
      setCopyError(cause instanceof Error ? cause.message : "Could not copy the recovery phrase.");
    }
  }
  return (
    <div className="gateCard wide">
      <div className="gateIcon"><KeyRound size={23} /></div>
      <p className="eyebrow">Recovery phrase</p>
      <h1>Back up these 24 words</h1>
      <p className="muted">This is the only way to recover your private funds. Moros cannot reset it.</p>
      <ol className="recoveryGrid">
        {words.map((word, index) => <li key={`${word}-${index}`}><span>{index + 1}</span>{word}</li>)}
      </ol>
      <button className="button secondary" type="button" onClick={copy}>
        {copied ? <Check size={18} /> : <Copy size={18} />} {copied ? "Copied" : "Copy words"}
      </button>
      {copyError && <p className="errorText" role="alert">{copyError}</p>}
      <div className="recoveryChecks">
        {positions.map((position, index) => (
          <label className="field" key={position}>
            <span>Word {position + 1}</span>
            <input
              value={checks[index]}
              onChange={(event) => setChecks(checks.map((value, item) => item === index ? event.target.value : value))}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        ))}
      </div>
      <p className="finePrint">Enter the requested words to confirm your offline backup.</p>
      <button className="button primary" type="button" disabled={!confirmed} onClick={onDone}>Open Moros Pay</button>
    </div>
  );
}

function WalletStart({ onCreate, onRestore, compact }: { onCreate(): void; onRestore(): void; compact: boolean }) {
  const stellar = useStellarWallet();
  const busy = stellar.status === "connecting" || stellar.status === "loading";
  const publicStatus = stellar.address
    ? `${stellar.address.slice(0, 6)}...${stellar.address.slice(-6)}`
    : "Use the Stellar account you already have.";

  return (
    <section className={compact ? "walletAccess compact" : "walletAccess"}>
      <header className="walletAccessIntro">
        <p className="sectionLabel"><span />Choose your access</p>
        <h2>{compact ? "Connect or create when you are ready." : "Enter Moros your way."}</h2>
        <p>Browse the app first. Connect Freighter for public Circle USDC, then create or restore a private identity for protected payments.</p>
      </header>
      <div className="walletAccessGrid">
        <article className="walletAccessCard">
          <div className="walletAccessCardTop"><span>01</span><WalletCards size={23} /></div>
          <div><p className="eyebrow">Public Stellar wallet</p><h3>Connect Freighter</h3><p>{publicStatus}</p></div>
          {stellar.address ? (
            <div className="walletAccessConnected">
              <div><span>Circle USDC</span><strong>{formatUsdcAtomic(stellar.balanceAtomic)}</strong></div>
              <button className="button secondary" type="button" onClick={() => void stellar.refresh()} disabled={busy}><RefreshCw size={17} />{busy ? "Refreshing" : "Refresh balance"}</button>
            </div>
          ) : (
            <button className="button secondary" type="button" onClick={() => void stellar.connect()} disabled={busy}><WalletCards size={17} />{busy ? "Connecting Freighter" : "Connect Freighter"}</button>
          )}
          {stellar.error && <p className="errorText" role="alert">{stellar.error}</p>}
        </article>
        <article className="walletAccessCard private">
          <div className="walletAccessCardTop"><span>02</span><Fingerprint size={23} /></div>
          <div><p className="eyebrow">Private payment identity</p><h3>Create locally</h3><p>Generate encrypted payment keys on this device, or restore an identity you already control.</p></div>
          <div className="walletAccessActions">
            <button className="button primary" type="button" onClick={onCreate}>Create private identity</button>
            <button className="button secondary" type="button" onClick={onRestore}>Restore existing identity</button>
          </div>
        </article>
      </div>
      <footer className="walletAccessFoot">
        <span><ShieldCheck size={15} />No automatic wallet prompts</span>
        <span><KeyRound size={15} />Self-custodied recovery</span>
      </footer>
    </section>
  );
}

function CreateWallet({ compact = false }: { compact?: boolean }) {
  const wallet = usePaymentWallet();
  const [mode, setMode] = useState<"choose" | "create" | "restore">("choose");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [phrase, setPhrase] = useState("");
  const [backup, setBackup] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) return;
    setPending(true);
    try {
      setBackup(await wallet.create(password));
    } catch {
      setPending(false);
    }
  }

  async function restore(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) return;
    setPending(true);
    try {
      await wallet.restore(phrase, password);
    } catch {
      setPending(false);
    }
  }

  if (backup) return <RecoveryBackup phrase={backup} onDone={() => wallet.activate(backup)} />;

  if (mode === "choose") {
    return <WalletStart compact={compact} onCreate={() => setMode("create")} onRestore={() => setMode("restore")} />;
  }

  return (
    <form className="gateCard authCard walletAccessForm" onSubmit={mode === "create" ? create : restore}>
      <input className="srOnly" name="username" value="moros-private-wallet" autoComplete="username" readOnly tabIndex={-1} aria-hidden="true" />
      <button className="textButton backButton" type="button" onClick={() => setMode("choose")}>Back to wallet choices</button>
      <p className="eyebrow">{mode === "create" ? "Create private identity" : "Restore private identity"}</p>
      <h1>{mode === "create" ? "Protect this device" : "Recover private funds"}</h1>
      {mode === "restore" && (
        <label className="field">
          <span>24-word recovery phrase</span>
          <textarea value={phrase} onChange={(event) => setPhrase(event.target.value)} rows={5} autoComplete="off" required />
        </label>
      )}
      <PasswordField value={password} onChange={setPassword} label="New wallet password" autoComplete="new-password" />
      <PasswordField value={confirm} onChange={setConfirm} label="Confirm password" autoComplete="new-password" />
      {confirm && password !== confirm && <p className="errorText">Passwords do not match.</p>}
      {wallet.error && <p className="errorText" role="alert">{wallet.error}</p>}
      <button className="button primary" disabled={pending || password !== confirm}>
        {pending ? "Securing identity..." : mode === "create" ? "Create private identity" : "Restore private identity"}
      </button>
    </form>
  );
}

function UnlockWallet() {
  const wallet = usePaymentWallet();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await wallet.unlock(password);
    } catch {
      setPending(false);
    }
  }
  return (
    <form className="gateCard authCard" onSubmit={submit}>
      <input className="srOnly" name="username" value="moros-private-wallet" autoComplete="username" readOnly tabIndex={-1} aria-hidden="true" />
      <div className="gateIcon"><LockKeyhole size={24} /></div>
      <p className="eyebrow">Private wallet locked</p>
      <h1>Welcome back</h1>
      <p className="muted">Unlock locally to discover balances and activity.</p>
      <PasswordField value={password} onChange={setPassword} />
      {wallet.error && <p className="errorText" role="alert">{wallet.error}</p>}
      <button className="button primary" disabled={pending}>{pending ? "Unlocking..." : "Unlock private wallet"}</button>
    </form>
  );
}

export function WalletGate({ children }: { children: React.ReactNode }) {
  const wallet = usePaymentWallet();
  if (wallet.status === "loading") {
    return <div className="walletAccessLoading"><div className="loadingMark" aria-label="Loading private wallet" /><span>Checking this device</span></div>;
  }
  if (wallet.status === "empty") return <CreateWallet />;
  if (wallet.status === "locked") return <div className="walletAccessShell"><UnlockWallet /></div>;
  if (wallet.status === "backup" && wallet.recoveryPhrase) {
    return <div className="walletAccessShell"><RecoveryBackup phrase={wallet.recoveryPhrase} onDone={() => wallet.activate(wallet.recoveryPhrase as string)} /></div>;
  }
  return <>{children}</>;
}

export function WalletAccess({ compact = false }: { compact?: boolean }) {
  const wallet = usePaymentWallet();
  if (wallet.status === "loading") return <div className="walletAccessLoading compact"><div className="loadingMark" aria-label="Loading private wallet" /><span>Checking this device</span></div>;
  if (wallet.status === "empty") return <CreateWallet compact={compact} />;
  if (wallet.status === "locked") return <div className="walletAccessShell compact"><UnlockWallet /></div>;
  if (wallet.status === "backup" && wallet.recoveryPhrase) return <div className="walletAccessShell"><RecoveryBackup phrase={wallet.recoveryPhrase} onDone={() => wallet.activate(wallet.recoveryPhrase as string)} /></div>;
  return null;
}
