"use client";

import {
  TokenADA,
  TokenAVAX,
  TokenBNB,
  TokenBTC,
  TokenDOGE,
  TokenDOT,
  TokenETH,
  TokenLINK,
  TokenSOL,
  TokenXLM,
  TokenXRP,
  type IconComponent,
} from "@web3icons/react";

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
};

const LIGHT_CHIP = new Set(["XLM"]);

const PX = { sm: 32, md: 44, lg: 56 };

export function AssetIcon({ asset, size = "md" }: { asset?: string; size?: keyof typeof PX }) {
  const sym = (asset ?? "?").toUpperCase();
  const px = PX[size];
  const Icon = ICONS[sym];

  if (Icon) {
    if (LIGHT_CHIP.has(sym)) {
      return (
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-inset ring-black/10"
          style={{ height: px, width: px }}
        >
          <Icon variant="branded" size={Math.round(px * 0.7)} />
        </span>
      );
    }
    return <Icon variant="branded" size={px} className="shrink-0 rounded-full" />;
  }

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] font-mono font-medium tracking-tight text-muted-foreground"
      style={{ height: px, width: px, fontSize: Math.round(px * 0.3) }}
    >
      {sym.slice(0, 3)}
    </span>
  );
}
