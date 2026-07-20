"use client";

import {
  TokenADA,
  TokenAVAX,
  TokenBNB,
  TokenBTC,
  TokenDOGE,
  TokenDOT,
  TokenDAI,
  TokenETH,
  TokenEURC,
  TokenLINK,
  TokenMATIC,
  TokenSOL,
  TokenATOM,
  TokenUNI,
  TokenUSDC,
  TokenUSDT,
  TokenXLM,
  TokenXRP,
  type IconComponent,
} from "@web3icons/react";
import { Gem, Landmark } from "lucide-react";

const ICONS: Record<string, IconComponent> = {
  XLM: TokenXLM,
  BTC: TokenBTC,
  ETH: TokenETH,
  SOL: TokenSOL,
  BNB: TokenBNB,
  XRP: TokenXRP,
  ADA: TokenADA,
  AVAX: TokenAVAX,
  LINK: TokenLINK,
  DOGE: TokenDOGE,
  DOT: TokenDOT,
  MATIC: TokenMATIC,
  USDC: TokenUSDC,
  USDT: TokenUSDT,
  DAI: TokenDAI,
  ATOM: TokenATOM,
  UNI: TokenUNI,
  EURC: TokenEURC,
};

const LIGHT_CHIP = new Set(["XLM"]);
const FIAT_ASSETS = new Set(["EUR", "GBP", "CHF", "CAD", "MXN", "ARS", "BRL", "THB"]);

const PX = { sm: 32, md: 44, lg: 56 };

export function AssetIcon({ asset, size = "md" }: { asset?: string; size?: keyof typeof PX }) {
  const sym = (asset ?? "?").toUpperCase();
  const px = PX[size];
  const Icon = ICONS[sym];

  if (Icon) {
    if (LIGHT_CHIP.has(sym)) {
      return (
        <span
          aria-hidden="true"
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-inset ring-black/10"
          style={{ height: px, width: px }}
        >
          <Icon variant="branded" size={Math.round(px * 0.7)} />
        </span>
      );
    }
    return (
      <span aria-hidden="true" className="inline-flex shrink-0">
        <Icon variant="branded" size={px} className="rounded-full" />
      </span>
    );
  }

  if (FIAT_ASSETS.has(sym) || sym === "XAU") {
    const ReferenceIcon = sym === "XAU" ? Gem : Landmark;
    return (
      <span
        aria-hidden="true"
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-foreground/65"
        style={{ height: px, width: px }}
      >
        <ReferenceIcon size={Math.round(px * 0.5)} strokeWidth={1.8} />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] font-mono font-medium tracking-tight text-muted-foreground"
      style={{ height: px, width: px, fontSize: Math.round(px * 0.3) }}
    >
      {sym.slice(0, 3)}
    </span>
  );
}
