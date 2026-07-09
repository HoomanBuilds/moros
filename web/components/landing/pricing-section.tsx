"use client";

import { useState, useEffect, useRef } from "react";
import { Check, Zap } from "lucide-react";

const plans = [
  {
    tier: "Tier 2",
    name: "Margin lending",
    description: "Lend SUI or DBUSDC on DeepBook Margin.",
    headline: "90%",
    headlineSub: "of profit, plus reclaimed referral yield",
    features: [
      "Variable yield paid by margin borrowers",
      "50% referral fee reclaimed and compounded for you",
      "10% performance fee, on profit only",
      "SUI and DBUSDC pools",
      "No management fee",
    ],
    cta: "Lend on Margin",
    highlight: false,
  },
  {
    tier: "Tier 1",
    name: "Predict PLP vault",
    description: "Underwrite BTC markets on DeepBook Predict.",
    headline: "90%",
    headlineSub: "of every gain is yours",
    features: [
      "Earn the Predict premium, auto-compounded",
      "10% performance fee, on profit only",
      "No management, deposit, or withdrawal fee",
      "A keeper redeems your settled positions",
      "Risk bounded by conservative exposure caps",
    ],
    cta: "Provide liquidity",
    highlight: true,
  },
  {
    tier: "Tier 3",
    name: "tPLP borrow market",
    description: "Supply dUSDC, or borrow against your tPLP.",
    headline: "100%",
    headlineSub: "of the borrow interest to suppliers",
    features: [
      "Supply dUSDC with zero supply fee",
      "Borrow up to 50% LTV against your tPLP",
      "Self-redeeming liquidation, no oracle",
      "Only fee is a 5% liquidation penalty",
      "Open, isolated market",
    ],
    cta: "Supply or borrow",
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
              Markets
            </span>
            <h2 className={`text-6xl md:text-7xl lg:text-[128px] font-display tracking-tight leading-[0.9] transition-all duration-1000 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}>
Three markets.
              <br />
              <span className="text-stroke">You keep more.</span>
            </h2>
            <p className={`mt-8 text-lg text-muted-foreground max-w-md leading-relaxed transition-all duration-1000 delay-200 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}>
              One deposit, three composable markets. You keep 90% of every gain
              and all of your principal, and supplying to the borrow market is free.
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

        {/* Market cards - Horizontal layout with overlap */}
        <div className="relative">
          <div className="grid lg:grid-cols-3 gap-4 lg:gap-0">
            {plans.map((plan, index) => (
              <div
                key={plan.name}
                className={`relative bg-background border transition-all duration-700 ${
                  plan.highlight
                    ? "border-foreground lg:-mx-2 lg:-mt-6 lg:z-10 lg:scale-105"
                    : "border-foreground/10 lg:first:-mr-2 lg:last:-ml-2"
                } ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"}`}
                style={{ transitionDelay: `${index * 100}ms` }}
              >
                {/* Core market badge */}
                {plan.highlight && (
                  <div className="absolute -top-4 left-8 right-8 flex justify-center">
                    <span className="inline-flex items-center gap-2 px-4 py-2 bg-foreground text-background text-xs font-mono uppercase tracking-widest">
                      <Zap className="w-3 h-3" />
                      Core market
                    </span>
                  </div>
                )}

                <div className="p-8 lg:p-10">
                  {/* Market header */}
                  <div className="mb-8 pb-8 border-b border-foreground/10">
                    <span className="font-mono text-xs text-muted-foreground uppercase tracking-widest">
                      {plan.tier}
                    </span>
                    <h3 className="text-2xl lg:text-3xl font-display mt-2">{plan.name}</h3>
                    <p className="text-sm text-muted-foreground mt-2">{plan.description}</p>
                  </div>

                  {/* Headline rate */}
                  <div className="mb-8">
                    <span className="text-5xl lg:text-6xl font-display">{plan.headline}</span>
                    <p className="text-xs text-muted-foreground mt-2 font-mono">
                      {plan.headlineSub}
                    </p>
                  </div>

                  {/* Features */}
                  <ul className="space-y-3 mb-10">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3">
                        <Check className="w-4 h-4 text-[#eca8d6] mt-0.5 shrink-0" />
                        <span className="text-sm text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <button
                    className={`w-full py-4 flex items-center justify-center gap-2 text-sm font-medium transition-all group ${
                      plan.highlight
                        ? "bg-foreground text-background hover:bg-foreground/90"
                        : "border border-foreground/20 text-foreground hover:border-foreground hover:bg-foreground/5"
                    }`}
                  >
                    {plan.cta}
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
              No management fee on any tier
            </span>
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-[#eca8d6]" />
              Fees only on realized profit
            </span>
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-[#eca8d6]" />
              Borrow market takes no supply fee
            </span>
          </div>
          <a href="#" className="text-sm underline underline-offset-4 hover:text-foreground transition-colors">
            Read the fee logic
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
