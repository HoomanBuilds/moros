import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { reflectorOracleForAsset, RESOLVABLE_ASSETS } from "@/lib/markets/deploy-constants";
import { readContract } from "@/lib/stellar/client";

export type Candle = { t: number; price: number };

const PAIR: Record<string, { binance: string; coinbase: string }> = {
  XLM: { binance: "XLMUSDT", coinbase: "XLM-USD" },
  BTC: { binance: "BTCUSDT", coinbase: "BTC-USD" },
  ETH: { binance: "ETHUSDT", coinbase: "ETH-USD" },
  SOL: { binance: "SOLUSDT", coinbase: "SOL-USD" },
  BNB: { binance: "BNBUSDT", coinbase: "BNB-USD" },
  XRP: { binance: "XRPUSDT", coinbase: "XRP-USD" },
  ADA: { binance: "ADAUSDT", coinbase: "ADA-USD" },
  AVAX: { binance: "AVAXUSDT", coinbase: "AVAX-USD" },
  LINK: { binance: "LINKUSDT", coinbase: "LINK-USD" },
  DOGE: { binance: "DOGEUSDT", coinbase: "DOGE-USD" },
  DOT: { binance: "DOTUSDT", coinbase: "DOT-USD" },
};

export const SUPPORTED_ASSETS = RESOLVABLE_ASSETS;

export function reflectorPriceToNumber(value: bigint): number {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(15, "0");
  const whole = digits.slice(0, -14);
  const fraction = digits.slice(-14).replace(/0+$/, "");
  return Number(`${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`);
}

async function fromReflector(asset: string): Promise<Candle[]> {
  const oracle = reflectorOracleForAsset(asset);
  if (!oracle) throw new Error("unsupported Reflector asset");
  const assetArg = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Other"),
    xdr.ScVal.scvSymbol(asset.toUpperCase()),
  ]);
  const rows = await readContract(oracle, "prices", [
    assetArg,
    nativeToScVal(20, { type: "u32" }),
  ]) as { price: bigint; timestamp: bigint }[] | null;
  if (!Array.isArray(rows)) throw new Error("Reflector history unavailable");
  const candles = rows
    .filter((row) => row.price > 0n)
    .map((row) => ({ t: Number(row.timestamp) * 1000, price: reflectorPriceToNumber(row.price) }))
    .sort((a, b) => a.t - b.t);
  if (candles.length === 0) throw new Error("Reflector history unavailable");
  return candles;
}

async function fromBinance(pair: string): Promise<Candle[]> {
  const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1m&limit=120`);
  if (!r.ok) throw new Error("binance");
  const rows = (await r.json()) as unknown[][];
  return rows.map((row) => ({ t: Number(row[0]), price: Number(row[4]) }));
}

async function fromCoinbase(pair: string): Promise<Candle[]> {
  const r = await fetch(`https://api.exchange.coinbase.com/products/${pair}/candles?granularity=60`);
  if (!r.ok) throw new Error("coinbase");
  const rows = (await r.json()) as number[][];
  return rows
    .map((row) => ({ t: row[0] * 1000, price: row[4] }))
    .sort((a, b) => a.t - b.t)
    .slice(-120);
}

export async function getAssetCandles(asset: string): Promise<Candle[]> {
  try {
    return await fromReflector(asset);
  } catch (reflectorError) {
    const pair = PAIR[asset.toUpperCase()];
    if (!pair) throw reflectorError;
    try {
      return await fromBinance(pair.binance);
    } catch {
      return await fromCoinbase(pair.coinbase);
    }
  }
}

export type Spot = { price: number; changePct: number };

export function spotFromCandles(candles: Candle[]): Spot | null {
  if (candles.length === 0) return null;
  const price = candles[candles.length - 1].price;
  const first = candles[0].price;
  const changePct = first > 0 ? ((price - first) / first) * 100 : 0;
  return { price, changePct };
}
