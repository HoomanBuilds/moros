"use client";

import {
  ArrowUpRight,
  Clock3,
  Home,
  LockKeyhole,
  QrCode,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { usePaymentWallet } from "./wallet-provider";

const navigation = [
  { href: "/", label: "Home", icon: Home },
  { href: "/send", label: "Send", icon: ArrowUpRight },
  { href: "/receive", label: "Receive", icon: QrCode },
  { href: "/activity", label: "Activity", icon: Clock3 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wallet = usePaymentWallet();

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brandLink"><Brand /></Link>
        <nav className="desktopNav" aria-label="Primary navigation">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={pathname === href ? "navItem active" : "navItem"}>
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="topbarActions">
          <ThemeToggle />
          <Link href="/settings" className={pathname === "/settings" ? "navItem active" : "navItem"}>
            <Settings size={18} /><span className="desktopOnly">Settings</span>
          </Link>
          {wallet.status === "unlocked" && (
            <button className="lockButton" type="button" onClick={wallet.lock}>
              <LockKeyhole size={17} /><span className="desktopOnly">Lock</span>
            </button>
          )}
        </div>
      </header>
      <main className="main">{children}</main>
      <nav className="bottomNav" aria-label="Primary navigation">
        {navigation.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={pathname === href ? "bottomNavItem active" : "bottomNavItem"}>
            <Icon size={21} strokeWidth={1.8} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
