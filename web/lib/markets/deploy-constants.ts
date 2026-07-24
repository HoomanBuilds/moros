import {
  FX_PRICE_ASSETS,
  FREE_RESOLVABLE_ASSETS,
  PYTH_PRO_RESOLVABLE_ASSETS,
} from "./categories";
import { NETWORK } from "@/lib/network";

export const ORACLE_MODE =
  process.env.NEXT_PUBLIC_ORACLE_MODE === "pyth_pro"
    ? "pyth_pro"
    : "free";
export const EVENT_MARKETS_ENABLED =
  process.env.NEXT_PUBLIC_EVENT_MARKETS_ENABLED === "1";
export const REFLECTOR_CEX_ORACLE =
  NETWORK.id === "mainnet"
    ? "CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN"
    : "CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63";
export const REFLECTOR_FIAT_ORACLE =
  NETWORK.id === "mainnet"
    ? "CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC"
    : "CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W";
export const REFLECTOR_ORACLE = REFLECTOR_CEX_ORACLE;
export const PLATFORM_FEE_BPS = 200;

export const RESOLVABLE_ASSETS: string[] =
  ORACLE_MODE === "free"
    ? [...FREE_RESOLVABLE_ASSETS]
    : [...PYTH_PRO_RESOLVABLE_ASSETS];

export function reflectorOracleForAsset(asset: string): string | null {
  const normalized = asset.toUpperCase();
  if (
    normalized === "XAU" ||
    FX_PRICE_ASSETS.includes(normalized)
  ) {
    return REFLECTOR_FIAT_ORACLE;
  }
  return (FREE_RESOLVABLE_ASSETS as readonly string[]).includes(normalized)
    ? REFLECTOR_CEX_ORACLE
    : null;
}
