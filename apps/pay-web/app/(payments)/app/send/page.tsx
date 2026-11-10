"use client";

import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { PaymentEditor } from "@/components/payment-editor";

export default function Page() {
  return <ProtectedPage><div className="page transactionPage"><PageHeader title="Send USDC" description="Pay a Moros contact or a signed payment request." /><PaymentEditor mode="send" /></div></ProtectedPage>;
}
