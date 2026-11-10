"use client";
import { useState } from "react";
import { loadEncryptedWallet } from "@/lib/wallet-store";
import { decryptRecoveryPhrase } from "@/lib/wallet-crypto";
import { usePaymentWallet } from "./wallet-provider";

export function RecoverySettings() {
  const wallet = usePaymentWallet();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return <section className="panel settingsSection formStack"><div><h2>Recovery phrase</h2><p className="muted">Your 24 words restore access on another device. Keep an offline copy somewhere safe.</p></div>
    {!open ? <button className="button secondary" onClick={() => setOpen(true)}>View recovery phrase</button> : phrase ? <><ol className="recoveryGrid">{phrase.split(" ").map((word, index) => <li key={index}><span>{index + 1}</span>{word}</li>)}</ol><button className="button secondary" onClick={() => { setPhrase(""); setPassword(""); setOpen(false); }}>Hide recovery phrase</button></> : <form className="formStack" onSubmit={(event) => {
      event.preventDefault(); if (pending) return;
      setPending(true); setError("");
      void (async () => {
        const record = await loadEncryptedWallet();
        if (!record) throw new Error("No wallet is saved on this device.");
        const recovered = await decryptRecoveryPhrase(record, password);
        if (recovered !== wallet.recoveryPhrase) throw new Error("The wallet on this device changed. Unlock it again.");
        setPhrase(recovered); setPassword("");
      })().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not unlock recovery words.")).finally(() => setPending(false));
    }}><label className="field"><span>Confirm your wallet password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={pending} /></label>{error && <p className="errorText" role="alert">{error}</p>}<div className="actionRow"><button className="button primary" disabled={pending}>{pending ? "Checking..." : "Show recovery phrase"}</button><button type="button" className="button secondary" disabled={pending} onClick={() => { setOpen(false); setPassword(""); setError(""); }}>Cancel</button></div></form>}
  </section>;
}
