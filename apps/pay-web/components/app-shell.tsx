"use client";

import {
  ArrowUpRight,
  Clock3,
  Home,
  LockKeyhole,
  QrCode,
  ReceiptText,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { usePaymentWallet } from "./wallet-provider";
import { productUrls } from "@/lib/product-urls";

const navigation = [
  { href: "/app", label: "Home", icon: Home },
  { href: "/app/send", label: "Send", icon: ArrowUpRight },
  { href: "/app/receive", label: "Receive", icon: QrCode },
  { href: "/app/request", label: "Request", icon: ReceiptText },
  { href: "/app/contacts", label: "Contacts", icon: Users },
  { href: "/app/activity", label: "Activity", icon: Clock3 },
];

const mobileNavigation = navigation.filter(({ href }) => href !== "/app/contacts");
const routeTitles: Record<string, string> = {
  "/app": "Private wallet",
  "/app/send": "Send USDC",
  "/app/receive": "Receive USDC",
  "/app/request": "Request USDC",
  "/app/contacts": "Private contacts",
  "/app/activity": "Payment activity",
  "/app/settings": "Wallet settings",
  "/app/deposit": "Add private USDC",
  "/app/withdraw": "Withdraw USDC",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wallet = usePaymentWallet();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
    document.title = `${routeTitles[pathname] ?? "Private payments"} | Moros Pay`;
  }, [pathname]);

  return (
    <div className="shell">
      <a className="skipLink" href="#payment-main">Skip to main content</a>
      <header className="topbar">
        <Link href="/app" className="brandLink"><Brand /></Link>
        <nav className="desktopNav" aria-label="Primary navigation">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={pathname === href ? "navItem active" : "navItem"}>
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="topbarActions">
          <a className="productSwitch desktopOnly" href={productUrls.predict}>Predict</a>
          <ThemeToggle />
          <Link href="/app/settings" aria-current={pathname === "/app/settings" ? "page" : undefined} className={pathname === "/app/settings" ? "navItem active" : "navItem"}>
            <Settings size={18} /><span className="desktopOnly">Settings</span>
          </Link>
          {wallet.status === "unlocked" && (
            <button className="lockButton" type="button" onClick={wallet.lock}>
              <LockKeyhole size={17} /><span className="desktopOnly">Lock</span>
            </button>
          )}
        </div>
      </header>
      <main className="main" id="payment-main" ref={mainRef} tabIndex={-1}>{children}</main>
      <nav className="bottomNav" aria-label="Primary navigation">
        {mobileNavigation.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={pathname === href ? "bottomNavItem active" : "bottomNavItem"}>
            <Icon size={21} strokeWidth={1.8} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
