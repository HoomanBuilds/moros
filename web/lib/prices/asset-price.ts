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

export const SUPPORTED_ASSETS = ["XLM", "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE", "DOT"];

function pairFor(asset: string): { binance: string; coinbase: string } {
  const key = asset.toUpperCase();
  return PAIR[key] ?? { binance: `${key}USDT`, coinbase: `${key}-USD` };
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
  const { binance, coinbase } = pairFor(asset);
  try {
    return await fromBinance(binance);
  } catch {
    return await fromCoinbase(coinbase);
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
