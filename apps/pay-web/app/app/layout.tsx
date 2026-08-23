import { PaymentWalletProvider } from "@/components/wallet-provider";
import { StellarWalletProvider } from "@/components/stellar-wallet-provider";

export default function WalletLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <PaymentWalletProvider><StellarWalletProvider>{children}</StellarWalletProvider></PaymentWalletProvider>;
}
