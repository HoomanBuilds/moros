import { AppShell } from "./app-shell";
import { WalletGate } from "./wallet-gate";

export function ProtectedPage({ children, allowLocked = false }: { children: React.ReactNode; allowLocked?: boolean }) {
  return <AppShell>{allowLocked ? children : <WalletGate>{children}</WalletGate>}</AppShell>;
}
