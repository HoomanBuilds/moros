import { AppShell } from "./app-shell";
import { WalletGate } from "./wallet-gate";

export function ProtectedPage({ children }: { children: React.ReactNode }) {
  return <AppShell><WalletGate>{children}</WalletGate></AppShell>;
}
