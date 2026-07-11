"use client";

import Link from "next/link";
import { ConnectButton } from "@/components/wallet/connect-button";
import { MobileNav } from "@/components/app/mobile-nav";

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 h-16 border-b border-foreground/10 bg-background/70 backdrop-blur">
      <div className="flex items-center justify-between h-full px-6 lg:px-12">
        <div className="flex items-center gap-2">
          <MobileNav />
          <Link href="/" className="flex items-center gap-2 lg:hidden">
            <span className="font-display text-xl tracking-tight text-foreground">Umbra</span>
            <span className="font-mono text-[10px] mt-0.5 text-muted-foreground">TM</span>
          </Link>
        </div>

        <div className="flex items-center gap-4 lg:gap-6">
          <span className="hidden sm:flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#eca8d6]" />
            <span className="text-xs font-mono text-muted-foreground">Stellar testnet</span>
          </span>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
