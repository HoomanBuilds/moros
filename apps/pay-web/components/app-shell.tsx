"use client";

import { ArrowDownToLine, ArrowUpFromLine, ArrowUpRight, Clock3, Home, LockKeyhole, QrCode, ReceiptText, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type MouseEvent } from "react";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { usePaymentWallet } from "./wallet-provider";
import { paymentDeployment } from "@/lib/deployment";

const navigation = [
  { href: "/app", label: "Overview", icon: Home },
  { href: "/app/send", label: "Send", icon: ArrowUpRight },
  { href: "/app/receive", label: "Receive", icon: QrCode },
  { href: "/app/request", label: "Requests", icon: ReceiptText },
  { href: "/app/contacts", label: "Contacts", icon: Users },
  { href: "/app/activity", label: "Activity", icon: Clock3 },
];
const funding = [
  { href: "/app/deposit", label: "Add USDC", icon: ArrowDownToLine },
  { href: "/app/withdraw", label: "Withdraw", icon: ArrowUpFromLine },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wallet = usePaymentWallet();
  const mainRef = useRef<HTMLElement>(null);
  const title = [...navigation, ...funding, { href: "/app/settings", label: "Settings" }].find((item) => item.href === pathname)?.label ?? "Payment request";
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
    document.title = `${title} | Moros`;
  }, [pathname, title]);
  useEffect(() => {
    if (!wallet.operationPending) return;
    const preventClose = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", preventClose);
    return () => window.removeEventListener("beforeunload", preventClose);
  }, [wallet.operationPending]);

  function keepPaymentOpen(event: MouseEvent<HTMLDivElement>) {
    if (!wallet.operationPending || !(event.target instanceof Element)) return;
    const link = event.target.closest("a");
    if (!link || link.target === "_blank" || link.getAttribute("href")?.startsWith("#")) return;
    event.preventDefault();
    event.stopPropagation();
    mainRef.current?.focus({ preventScroll: true });
  }

  return <div className="shell workspace" onClickCapture={keepPaymentOpen}>
    <a className="skipLink" href="#payment-main">Skip to main content</a>
    <header className="topbar">
      <Link href="/" className="brandLink"><Brand /></Link>
      <div className="topbarActions"><span className="networkLabel">{paymentDeployment.ready ? `Stellar ${paymentDeployment.deployment.environment}` : "Network unavailable"}</span><ThemeToggle /><Link className="iconButton" href="/app/settings" aria-label="Settings"><Settings size={18} /></Link>{wallet.status === "unlocked" && <button className="iconButton" disabled={wallet.operationPending} onClick={wallet.lock} aria-label="Lock wallet"><LockKeyhole size={18} /></button>}</div>
    </header>
    <aside className="workspaceSidebar" aria-label="Workspace navigation">
      <nav aria-label="Primary navigation">{navigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={pathname === href ? "workspaceNav active" : "workspaceNav"}><Icon size={18} />{label}</Link>)}</nav>
      <nav className="fundingNav" aria-label="Move funds">{funding.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={pathname === href ? "workspaceNav active" : "workspaceNav"}><Icon size={18} />{label}</Link>)}</nav>
      <div className="sidebarFoot"><Link href="/">About Moros</Link></div>
    </aside>
    <main className="main" id="payment-main" ref={mainRef} tabIndex={-1}>
      {wallet.operationPending && <div className="operationBanner" role="status">Your payment is in progress. Keep this tab open until it completes.</div>}
      {wallet.notice && <div className="notice" role="status">{wallet.notice}</div>}
      {children}
    </main>
    <nav className="bottomNav" aria-label="Mobile navigation">{navigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={pathname === href ? "bottomNavItem active" : "bottomNavItem"}><Icon size={20} /><span>{label}</span></Link>)}</nav>
  </div>;
}
