"use client";

import { Check, Copy, Eye, EyeOff, Fingerprint, KeyRound, LockKeyhole, RefreshCw, WalletCards } from "lucide-react";
import { FormEvent, useId, useState } from "react";
import { formatUsdcDisplay } from "@/lib/public-usdc";
import { copyBrowserText } from "@/lib/browser-share";
import { useStellarWallet } from "./stellar-wallet-provider";
import { usePaymentWallet } from "./wallet-provider";
import { StepHeading } from "./step-heading";

function PasswordField({ value, onChange, label = "Wallet password", autoComplete = "current-password", disabled = false }: {
  value: string;
  onChange(value: string): void;
  label?: string;
  autoComplete?: "current-password" | "new-password";
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const inputId = useId();
  const hintId = useId();
  const showHint = label === "New wallet password";
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <span className="passwordField">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          disabled={disabled}
          aria-describedby={showHint ? hintId : undefined}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          minLength={12}
          maxLength={256}
          required
        />
        <button type="button" disabled={disabled} aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)}>
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
      {showHint && <small id={hintId}>Use at least 12 characters. This password unlocks this device.</small>}
    </div>
  );
}

function RecoveryBackup({ phrase, onDone }: { phrase: string; onDone(): Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [activationError, setActivationError] = useState("");
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
      <div className="gateHeading"><KeyRound size={24} aria-hidden="true" /><StepHeading>Back up these 24 words</StepHeading></div>
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
      {activationError && <p className="errorText" role="alert">{activationError}</p>}
      <button className="button primary" type="button" disabled={!confirmed || pending} onClick={() => {
        setPending(true); setActivationError("");
        void onDone().catch((cause) => setActivationError(cause instanceof Error ? cause.message : "Could not open your wallet.")).finally(() => setPending(false));
      }}>{pending ? "Opening wallet..." : "Open Moros Pay"}</button>
    </div>
  );
}

function WalletStart({ onCreate, onRestore }: { onCreate(): void; onRestore(): void }) {
  const stellar = useStellarWallet();
  const busy = stellar.status === "connecting" || stellar.status === "loading";
  const publicStatus = stellar.address
    ? `${stellar.address.slice(0, 6)}...${stellar.address.slice(-6)}`
    : "Use the Stellar account you already have.";

  return (
    <section className="walletAccess">
      <header className="walletAccessIntro">
        <StepHeading>Set up your wallet</StepHeading>
        <p>Create or restore a private wallet. Connect Freighter when you want to add USDC.</p>
      </header>
      <div className="walletAccessGrid">
        <article className="walletAccessCard private">
          <div><div className="walletChoiceHeading"><Fingerprint size={22} aria-hidden="true" /><h2>Private wallet</h2></div><p>Create a wallet for private USDC payments, or restore one with your recovery phrase.</p></div>
          <div className="walletAccessActions">
            <button className="button primary" type="button" onClick={onCreate}>Create wallet</button>
            <button className="button secondary" type="button" onClick={onRestore}>Restore wallet</button>
          </div>
        </article>
        <article className="walletAccessCard">
          <div><div className="walletChoiceHeading"><WalletCards size={22} aria-hidden="true" /><h2>Connect Freighter</h2></div><p>{publicStatus}</p></div>
          {stellar.address ? (
            <div className="walletAccessConnected">
              <div><span>Circle USDC</span><strong>{formatUsdcDisplay(stellar.balanceAtomic)}</strong></div>
              <button className="button secondary" type="button" onClick={() => void stellar.refresh()} disabled={busy}><RefreshCw size={17} />{busy ? "Refreshing" : "Refresh balance"}</button>
            </div>
          ) : (
            <button className="button secondary" type="button" onClick={() => void stellar.connect()} disabled={busy}><WalletCards size={17} />{busy ? "Connecting Freighter" : "Connect Freighter"}</button>
          )}
          {stellar.error && <p className="errorText" role="alert">{stellar.error}</p>}
        </article>
      </div>

    </section>
  );
}

function CreateWallet({ initialMode = "choose", onCancel }: { initialMode?: "choose" | "restore"; onCancel?(): void } = {}) {
  const wallet = usePaymentWallet();
  const [mode, setMode] = useState<"choose" | "create" | "restore">(initialMode);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [phrase, setPhrase] = useState("");
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [backup, setBackup] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (pending || password !== confirm) return;
    setPending(true);
    try {
      setBackup(await wallet.create(password));
    } catch {
      setPending(false);
    }
  }

  async function restore(event: FormEvent) {
    event.preventDefault();
    if (pending || password !== confirm || (onCancel && !replaceConfirmed)) return;
    setPending(true);
    try {
      await wallet.restore(phrase, password);
    } catch {
      setPending(false);
    }
  }

  if (backup) return <RecoveryBackup phrase={backup} onDone={() => wallet.activate(backup)} />;

  if (mode === "choose") {
    return <WalletStart onCreate={() => setMode("create")} onRestore={() => setMode("restore")} />;
  }

  return (
    <form className="gateCard authCard walletAccessForm" onSubmit={mode === "create" ? create : restore}>
      <input className="srOnly" name="username" value="moros-private-wallet" autoComplete="username" readOnly tabIndex={-1} aria-hidden="true" />
      <button className="textButton backButton" disabled={pending} type="button" onClick={() => { wallet.clearError(); if (onCancel) onCancel(); else setMode("choose"); }}>Back</button>
      <StepHeading key={mode}>{mode === "create" ? "Protect this device" : "Recover private funds"}</StepHeading>
      {mode === "restore" && (
        <label className="field">
          <span>24-word recovery phrase</span>
          <textarea spellCheck={false} autoCapitalize="none" disabled={pending} value={phrase} onChange={(event) => setPhrase(event.target.value)} rows={5} autoComplete="off" required />
        </label>
      )}
      <PasswordField value={password} onChange={setPassword} label="New wallet password" autoComplete="new-password" disabled={pending} />
      <PasswordField value={confirm} onChange={setConfirm} label="Confirm password" autoComplete="new-password" disabled={pending} />
      {onCancel && <label className="backupCheck"><input type="checkbox" checked={replaceConfirmed} onChange={(event) => setReplaceConfirmed(event.target.checked)} />I have checked my recovery words. This replaces the saved wallet password on this device.</label>}
      {confirm && password !== confirm && <p className="errorText">Passwords do not match.</p>}
      {wallet.error && <p className="errorText" role="alert">{wallet.error}</p>}
      <button className="button primary" disabled={pending || password !== confirm || Boolean(onCancel && !replaceConfirmed)}>
        {pending ? "Securing wallet..." : mode === "create" ? "Create wallet" : "Restore wallet"}
      </button>
    </form>
  );
}

function UnlockWallet() {
  const [recovering, setRecovering] = useState(false);
  const wallet = usePaymentWallet();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await wallet.unlock(password);
    } catch {
      setPending(false);
    }
  }
  if (recovering) return <CreateWallet initialMode="restore" onCancel={() => setRecovering(false)} />;
  return (
    <form className="gateCard authCard" onSubmit={submit}>
      <input className="srOnly" name="username" value="moros-private-wallet" autoComplete="username" readOnly tabIndex={-1} aria-hidden="true" />
      <div className="gateHeading"><LockKeyhole size={24} aria-hidden="true" /><StepHeading>Welcome back</StepHeading></div>
      <p className="muted">Enter your password to open your private balance.</p>
      <PasswordField value={password} onChange={setPassword} disabled={pending} />
      {wallet.error && <p className="errorText" role="alert">{wallet.error}</p>}
      <button className="button primary" disabled={pending}>{pending ? "Unlocking..." : "Unlock private wallet"}</button>
      <button type="button" className="textButton" disabled={pending} onClick={() => { wallet.clearError(); setRecovering(true); }}>Recover with my 24 words</button>
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
