import { WalletGate } from "./wallet-gate";

export function ProtectedPage({ children }: { children: React.ReactNode }) {
  return <WalletGate>{children}</WalletGate>;
}
