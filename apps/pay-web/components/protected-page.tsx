import { AppShell } from "./app-shell";
import { WalletGate } from "./wallet-gate";

export function ProtectedPage({ children }: { children: React.ReactNode }) {
  return <WalletGate><AppShell>{children}</AppShell></WalletGate>;
}
