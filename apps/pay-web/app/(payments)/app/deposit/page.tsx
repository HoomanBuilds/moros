"use client";

import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { PaymentEditor } from "@/components/payment-editor";

export default function Page() {
  return <ProtectedPage><div className="page transactionPage"><PageHeader title="Add USDC" description="Move USDC from Freighter into your private balance." /><PaymentEditor mode="deposit" /></div></ProtectedPage>;
}
