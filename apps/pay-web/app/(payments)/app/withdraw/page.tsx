"use client";

import { PageHeader } from "@/components/page-header";
import { ProtectedPage } from "@/components/protected-page";
import { PaymentEditor } from "@/components/payment-editor";

export default function Page() {
  return <ProtectedPage><div className="page transactionPage"><PageHeader title="Withdraw USDC" description="Move private USDC to a Stellar account." /><PaymentEditor mode="withdraw" /></div></ProtectedPage>;
}
