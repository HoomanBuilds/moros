"use client";

import { FormEvent, useState } from "react";
import { Check, ShieldCheck, Trash2, UserPlus, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { usePaymentWallet } from "@/components/wallet-provider";
import { paymentDeployment } from "@/lib/deployment";
import { verifyDirectPaymentCode } from "@/lib/payment-identity";

export default function ContactsPage() {
  const wallet = usePaymentWallet();
  const [label, setLabel] = useState("");
  const [paymentCode, setPaymentCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [deleting, setDeleting] = useState("");
  const contacts = wallet.profile.value?.contacts ?? [];

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!paymentDeployment.ready) return;
    setPending(true);
    setError("");
    try {
      const verified = await verifyDirectPaymentCode(paymentCode, paymentDeployment.deployment);
      await wallet.saveContact({
        ...verified,
        label,
        updatedAt: Date.now(),
      });
      setLabel("");
      setPaymentCode("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this private contact.");
    } finally {
      setPending(false);
    }
  }

  async function remove(paymentCode: string) {
    setDeleting(paymentCode);
    setError("");
    try {
      await wallet.removeContact(paymentCode);
      setConfirmDelete("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this private contact.");
    } finally {
      setDeleting("");
    }
  }

  return (
    <ProtectedPage>
      <div className="page">
        <PageHeader eyebrow="Encrypted locally" title="Private contacts" description="Name trusted Moros payment codes without exposing your address book to Moros or storing it as plaintext in the browser." />
        <div className="contactLayout">
          <form className="panel formStack" onSubmit={save}>
            <div className="privacyItem"><span><ShieldCheck size={18} /></span><div><strong>Encrypted address book</strong><small>Labels and payment codes are encrypted with your private recovery identity.</small></div></div>
            <label className="field"><span>Name</span><input value={label} maxLength={64} onChange={(event) => setLabel(event.target.value)} placeholder="Coffee counter" required /></label>
            <label className="field"><span>Moros payment code</span><textarea rows={4} maxLength={320} value={paymentCode} onChange={(event) => setPaymentCode(event.target.value)} placeholder="moros_pay_..." autoComplete="off" required /></label>
            {error && <p className="errorText" role="alert">{error}</p>}
            <button className="button primary" disabled={pending || !label.trim() || !paymentCode.trim() || wallet.profile.status !== "ready"}>
              <UserPlus size={17} />{pending ? "Verifying..." : "Verify and save"}
            </button>
          </form>
          <section className="contactsPanel" aria-label="Saved private contacts">
            <div className="panelHeader"><div><p className="eyebrow">Saved</p><h2>{contacts.length} private contacts</h2></div></div>
            {contacts.length === 0 ? (
              <div className="emptyState"><div><UserPlus size={24} /><h2>No contacts yet</h2><p className="muted">Save a verified payment code for faster repeat payments.</p></div></div>
            ) : contacts.map((contact) => (
              <article className={confirmDelete === contact.paymentCode ? "contactRow confirming" : "contactRow"} key={contact.paymentCode}>
                <div className="contactMonogram" aria-hidden="true">{contact.label.slice(0, 1).toUpperCase()}</div>
                <div><strong>{contact.label}</strong><small>{confirmDelete === contact.paymentCode ? "Confirm removal from the encrypted address book" : contact.recipientFingerprint}</small></div>
                {confirmDelete === contact.paymentCode ? (
                  <div className="contactActions">
                    <button className="iconButton" type="button" aria-label={`Keep ${contact.label}`} onClick={() => setConfirmDelete("")}><X size={16} /></button>
                    <button className="iconButton dangerIcon" type="button" disabled={deleting === contact.paymentCode} aria-label={`Confirm deletion of ${contact.label}`} onClick={() => void remove(contact.paymentCode)}><Check size={16} /></button>
                  </div>
                ) : (
                  <button className="iconButton" type="button" aria-label={`Delete ${contact.label}`} onClick={() => setConfirmDelete(contact.paymentCode)}><Trash2 size={16} /></button>
                )}
              </article>
            ))}
          </section>
        </div>
      </div>
    </ProtectedPage>
  );
}
