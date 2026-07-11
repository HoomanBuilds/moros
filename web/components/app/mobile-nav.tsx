"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccentDot } from "@/components/app/app-kit";
import { navGroups, isActive } from "@/components/app/nav-links";

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const overlay = (
    <div className="lg:hidden fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close navigation"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
      />

      <div className="absolute inset-y-0 left-0 w-72 max-w-[80vw] bg-background border-r border-foreground/10 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between h-16 px-6 border-b border-foreground/10">
          <span className="flex items-center gap-2">
            <span className="font-display text-2xl tracking-tight text-foreground">Umbra</span>
            <span className="font-mono text-[10px] mt-1 text-muted-foreground">TM</span>
          </span>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="relative w-9 h-9 rounded-md hover:bg-foreground/[0.04] transition-colors"
          >
            <span className="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-foreground" />
            <span className="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-foreground" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-6 flex flex-col gap-6 overflow-y-auto">
          {navGroups.map((group, gi) => (
            <div key={group.label ?? `g${gi}`} className="flex flex-col gap-1">
              {group.label && (
                <span className="px-3 pb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">
                  {group.label}
                </span>
              )}
              {group.items.map((link) => {
                const active = isActive(pathname, link.href);
                return (
                  <Link
                    key={link.name}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
                      active
                        ? "bg-foreground/[0.04] text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02]"
                    }`}
                  >
                    <AccentDot active={active} />
                    {link.name}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="px-6 py-6 border-t border-foreground/10 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#eca8d6]" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Stellar testnet
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="lg:hidden flex flex-col justify-center gap-[5px] w-9 h-9 -ml-1.5 rounded-md hover:bg-foreground/[0.04] transition-colors"
      >
        <span className="block h-px w-5 bg-foreground mx-auto" />
        <span className="block h-px w-5 bg-foreground mx-auto" />
        <span className="block h-px w-5 bg-foreground mx-auto" />
      </button>

      {open && mounted && createPortal(overlay, document.body)}
    </>
  );
}
