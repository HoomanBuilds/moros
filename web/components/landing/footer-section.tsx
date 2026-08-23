"use client";

import { useEffect, useRef } from "react";
import { TokenUSDC } from "@web3icons/react";
import { BRAND } from "@/lib/brand";
import { StellarWordmark } from "./stellar-wordmark";

interface FooterLink {
  name: string;
  href: string;
  newTab?: boolean;
}

const footerLinks: Record<string, FooterLink[]> = {
  Product: [
    { name: "Private payments", href: BRAND.payHref, newTab: true },
    { name: "Features", href: "#features" },
    { name: "How it works", href: "#how-it-works" },
    { name: "Ecosystem", href: "#integrations" },
    { name: "Security", href: "#security" },
  ],
  Resources: [
    { name: "Launch app", href: "/app" },
    { name: "Whitepaper", href: BRAND.whitepaperHref, newTab: true },
    { name: "Developers", href: "#developers" },
    { name: "GitHub", href: BRAND.repoHref, newTab: true },
  ],
};

function AnimatedWaveCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let time = 0;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);

    const animate = () => {
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      ctx.clearRect(0, 0, width, height);

      ctx.strokeStyle = "rgba(100, 200, 150, 0.3)";
      ctx.lineWidth = 1;

      for (let wave = 0; wave < 3; wave++) {
        ctx.beginPath();
        for (let x = 0; x <= width; x += 5) {
          const y =
            height * 0.5 +
            Math.sin(x * 0.01 + time + wave * 0.5) * 30 +
            Math.sin(x * 0.02 + time * 1.5 + wave) * 20;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      time += 0.02;
      animationId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}

export function FooterSection() {
  return (
    <footer className="relative bg-black">
      {/* Panoramic banner image */}
      <div className="relative w-full h-[340px] md:h-[420px] overflow-hidden">
        <img
          src="/images/upscaled-10.png"
          alt="Bioluminescent landscape"
          className="w-full h-full object-cover object-center"
        />
        {/* Gradient fade to black at bottom */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black" />
        {/* Subtle dark vignette on sides */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-black/40" />
      </div>

      {/* Footer content - black background, white text */}
      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Main Footer */}
        <div className="py-16 lg:py-20">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-12 lg:gap-8">
            {/* Brand Column */}
            <div className="col-span-2">
              <a href="#" className="inline-flex items-center gap-2 mb-6">
                <span className="text-2xl font-display text-white">{BRAND.name}</span>
                <span className="text-xs text-white/40 font-mono">TM</span>
              </a>

              <p className="text-white/50 leading-relaxed mb-8 max-w-xs text-sm">
                Private prediction markets with encrypted positions, pooled
                liquidity, and proof-bound Circle USDC settlement on Stellar.
              </p>

              <span className="inline-flex items-center gap-2 text-sm text-white/40">
                <TokenUSDC
                  variant="branded"
                  size={20}
                  aria-hidden="true"
                  className="rounded-full"
                />
                Circle USDC collateral
              </span>

              <a
                href="https://stellar.org"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 flex w-fit items-center gap-3 text-xs font-mono uppercase tracking-[0.14em] text-white/35 transition-colors hover:text-white/60"
              >
                <span>Built on</span>
                <StellarWordmark className="w-24" />
              </a>
            </div>

            {/* Link Columns */}
            {Object.entries(footerLinks).map(([title, links]) => (
              <div key={title}>
                <h3 className="text-sm font-medium text-white mb-6">{title}</h3>
                <ul className="space-y-4">
                  {links.map((link) => (
                    <li key={link.name}>
                      <a
                        href={link.href}
                        target={link.newTab ? "_blank" : undefined}
                        rel={link.newTab ? "noopener noreferrer" : undefined}
                        aria-label={link.newTab ? `${link.name} (opens in a new tab)` : undefined}
                        className="text-sm text-white/40 hover:text-white transition-colors inline-flex items-center gap-2"
                      >
                        {link.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="flex items-center border-t border-white/10 py-8">
          <p className="text-sm text-white/30">
            &copy; 2026 {BRAND.name}. All rights reserved.
          </p>
        </div>

        <p className="pb-8 text-center text-[11px] leading-relaxed text-white/30 md:text-left">
          Stellar is a trademark of the Stellar Development Foundation. All
          rights reserved. Moros is independent software, not affiliated with,
          sponsored or endorsed by the Stellar Development Foundation.
        </p>
      </div>
    </footer>
  );
}
