import "./workspace.css";
import { AppShell } from "@/components/app-shell";
import { PaymentWalletProvider } from "@/components/wallet-provider";
import { StellarWalletProvider } from "@/components/stellar-wallet-provider";

export default function WalletLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <PaymentWalletProvider><StellarWalletProvider><AppShell>{children}</AppShell></StellarWalletProvider></PaymentWalletProvider>;
}
