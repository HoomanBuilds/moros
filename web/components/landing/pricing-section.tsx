"use client";

import { useState, useEffect, useRef } from "react";
import { Check, Zap } from "lucide-react";

const panels = [
  {
    tier: "Network",
    name: "Stellar testnet",
    description: "Contracts and circuits run on Stellar's public testnet.",
    headline: "Testnet",
    headlineSub: "resets periodically, no real funds",
    features: [
      "Soroban smart contracts",
      "Groth16 proofs verified on-chain",
      "Reflector oracle for outcome resolution",
    ],
    cta: "View network status",
    highlight: false,
  },
  {
    tier: "Funding",
    name: "Friendbot",
    description: "Fund a testnet wallet from friendbot to try it.",
    headline: "Free",
    headlineSub: "test XLM, no purchase needed",
    features: [
      "Instant testnet XLM airdrop",
      "Works with any Stellar test wallet",
      "No KYC, no real money",
    ],
    cta: "Fund from friendbot",
    highlight: true,
  },
  {
    tier: "Fees",
    name: "No fees on testnet",
    description: "Free on Stellar testnet.",
    headline: "$0",
    headlineSub: "no protocol fees during testnet",
    features: [
      "No deposit fee",
      "No redemption fee",
      "Standard Stellar network fee only",
    ],
    cta: "Read the docs",
    highlight: false,
  },
];

export function PricingSection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="pricing" ref={sectionRef} className="relative py-32 lg:py-40">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Header - Dramatic offset */}
        <div className="grid lg:grid-cols-12 gap-8 mb-20">
          <div className="lg:col-span-7">
            <span className="inline-flex items-center gap-3 text-sm font-mono text-muted-foreground mb-8">
              <span className="w-12 h-px bg-foreground/30" />
              Network
            </span>
            <h2 className={`text-6xl md:text-7xl lg:text-[128px] font-display tracking-tight leading-[0.9] transition-all duration-1000 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}>
How it settles.
              <br />
              <span className="text-stroke">No pricing tiers.</span>
            </h2>
            <p className={`mt-8 text-lg text-muted-foreground max-w-md leading-relaxed transition-all duration-1000 delay-200 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}>
              Free on Stellar testnet. Fund a testnet wallet from friendbot to try it.
            </p>
          </div>

          <div className="lg:col-span-5 relative p-0 h-96 lg:h-auto">
            {/* Whale image */}
            <div className={`absolute inset-0 pointer-events-none transition-all duration-1000 delay-100 ${
              isVisible ? "opacity-100" : "opacity-0"
            }`}>
              <img
                src="/images/whale.png"
                alt="Organic whale"
                className="w-full h-full object-contain object-center"
              />
            </div>

          </div>
        </div>

        {/* Network cards - Horizontal layout with overlap */}
        <div className="relative">
          <div className="grid lg:grid-cols-3 gap-4 lg:gap-0">
            {panels.map((panel, index) => (
              <div
                key={panel.name}
                className={`relative bg-background border transition-all duration-700 ${
                  panel.highlight
                    ? "border-foreground lg:-mx-2 lg:-mt-6 lg:z-10 lg:scale-105"
                    : "border-foreground/10 lg:first:-mr-2 lg:last:-ml-2"
                } ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"}`}
                style={{ transitionDelay: `${index * 100}ms` }}
              >
                {/* Start here badge */}
                {panel.highlight && (
                  <div className="absolute -top-4 left-8 right-8 flex justify-center">
                    <span className="inline-flex items-center gap-2 px-4 py-2 bg-foreground text-background text-xs font-mono uppercase tracking-widest">
                      <Zap className="w-3 h-3" />
                      Start here
                    </span>
                  </div>
                )}

                <div className="p-8 lg:p-10">
                  {/* Panel header */}
                  <div className="mb-8 pb-8 border-b border-foreground/10">
                    <span className="font-mono text-xs text-muted-foreground uppercase tracking-widest">
                      {panel.tier}
                    </span>
                    <h3 className="text-2xl lg:text-3xl font-display mt-2">{panel.name}</h3>
                    <p className="text-sm text-muted-foreground mt-2">{panel.description}</p>
                  </div>

                  {/* Headline */}
                  <div className="mb-8">
                    <span className="text-5xl lg:text-6xl font-display">{panel.headline}</span>
                    <p className="text-xs text-muted-foreground mt-2 font-mono">
                      {panel.headlineSub}
                    </p>
                  </div>

                  {/* Features */}
                  <ul className="space-y-3 mb-10">
                    {panel.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3">
                        <Check className="w-4 h-4 text-[#eca8d6] mt-0.5 shrink-0" />
                        <span className="text-sm text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <button
                    className={`w-full py-4 flex items-center justify-center gap-2 text-sm font-medium transition-all group ${
                      panel.highlight
                        ? "bg-foreground text-background hover:bg-foreground/90"
                        : "border border-foreground/20 text-foreground hover:border-foreground hover:bg-foreground/5"
                    }`}
                  >
                    {panel.cta}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom note */}
        <div className={`mt-20 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8 pt-12 border-t border-foreground/10 transition-all duration-1000 delay-500 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}>
          <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-[#eca8d6]" />
              No deposit or redemption fee
            </span>
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-[#eca8d6]" />
              Testnet XLM, no real funds
            </span>
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-[#eca8d6]" />
              Standard Stellar network fee only
            </span>
          </div>
          <a href="#" className="text-sm underline underline-offset-4 hover:text-foreground transition-colors">
            View network status
          </a>
        </div>
      </div>

      <style jsx>{`
        .text-stroke {
          -webkit-text-stroke: 1.5px currentColor;
          -webkit-text-fill-color: transparent;
        }
      `}</style>
    </section>
  );
}
