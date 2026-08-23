"use client";

import { Check, Copy, Eye, EyeOff, KeyRound, LockKeyhole } from "lucide-react";
import { FormEvent, useState } from "react";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";
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
  const [checks, setChecks] = useState(["", "", ""]);
  const words = phrase.split(" ");
  const positions = [3, 11, 20];
  const confirmed = positions.every((position, index) => checks[index].trim().toLowerCase() === words[position]);
  async function copy() {
    await navigator.clipboard.writeText(phrase);
    setCopied(true);
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

function CreateWallet() {
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
    return (
      <div className="onboardingShell">
        <header className="onboardingTop"><Brand /><ThemeToggle /></header>
        <section className="onboardingStory">
          <p className="sectionLabel"><span />Private USDC on Stellar</p>
          <h1>Move money.<br /><em>Leave no trail.</em></h1>
          <p>Shield once, then send, receive, and request Circle USDC through encrypted notes and local proofs.</p>
          <div className="privacyLedger">
            <div><span>Recipient</span><strong>Encrypted</strong></div>
            <div><span>Amount</span><strong>Encrypted</strong></div>
            <div><span>Settlement</span><strong>Verifiable</strong></div>
          </div>
        </section>
        <aside className="onboardingAction">
          <div className="actionNumber">01</div>
          <div>
            <p className="eyebrow">Your private wallet</p>
            <h2>Start with keys only you control.</h2>
            <p className="muted">No public Stellar account is needed to receive inside Moros.</p>
          </div>
          <div className="actionButtons">
            <button className="button primary" type="button" onClick={() => setMode("create")}>Create private wallet</button>
            <button className="button secondary" type="button" onClick={() => setMode("restore")}>Restore 24 words</button>
          </div>
          <p className="finePrint">Keys are created and encrypted on this device. Moros never receives your recovery phrase.</p>
        </aside>
      </div>
    );
  }

  return (
    <form className="gateCard authCard" onSubmit={mode === "create" ? create : restore}>
      <input className="srOnly" name="username" value="moros-private-wallet" autoComplete="username" readOnly tabIndex={-1} aria-hidden="true" />
      <div className="authTop"><Brand /><ThemeToggle /></div>
      <button className="textButton backButton" type="button" onClick={() => setMode("choose")}>Back to introduction</button>
      <p className="eyebrow">{mode === "create" ? "Create wallet" : "Restore wallet"}</p>
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
        {pending ? "Securing wallet..." : mode === "create" ? "Create wallet" : "Restore wallet"}
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
      <div className="authTop"><Brand /><ThemeToggle /></div>
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
    return <div className="gate"><div className="loadingMark" aria-label="Loading private wallet" /></div>;
  }
  if (wallet.status === "empty") return <div className="gate"><CreateWallet /></div>;
  if (wallet.status === "locked") return <div className="gate"><UnlockWallet /></div>;
  if (wallet.status === "backup" && wallet.recoveryPhrase) {
    return <div className="gate"><RecoveryBackup phrase={wallet.recoveryPhrase} onDone={() => wallet.activate(wallet.recoveryPhrase as string)} /></div>;
  }
  return <>{children}</>;
}
