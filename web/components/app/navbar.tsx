"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@/components/wallet/connect-button";
import { MobileNav } from "@/components/app/mobile-nav";
import { navGroups, isActive } from "@/components/app/nav-links";
import { cn } from "@/lib/utils";

export function Navbar() {
  const pathname = usePathname();
  const links = navGroups.flatMap((g) => g.items);

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-white/[0.08] bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-full max-w-[1500px] items-center justify-between gap-6 px-6 lg:px-10">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <MobileNav />
            <Link href="/" className="flex items-center gap-2">
              <span className="font-display text-2xl tracking-tight text-foreground">Moros</span>
              <span className="mt-1 font-mono text-[10px] text-muted-foreground">TM</span>
            </Link>
          </div>

          <nav className="hidden items-center gap-1 lg:flex">
            {links.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.name}
                  href={link.href}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-white/[0.06] text-foreground"
                      : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
                  )}
                >
                  {link.name}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-4 lg:gap-6">
          <span className="hidden items-center gap-2 sm:flex">
            <span className="h-2 w-2 rounded-full bg-[#eca8d6]" />
            <span className="font-mono text-xs text-muted-foreground">Stellar testnet</span>
          </span>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
