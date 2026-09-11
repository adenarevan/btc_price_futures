import { z } from "zod";
import { D, positive } from "./decimal";
import { check, validatePrices, validateCandles } from "./engine";
import { hash } from "./portfolio/ledger";
import { AppError } from "./errors";
import {
  MARKET_TYPE,
  PROVIDER,
  type Candle,
  type FundingEvent,
  type InstrumentMetadata,
  type MarketSnapshot,
  type SymbolName,
} from "./domain";
export const symbolSchema = z.enum([
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
]);
const dec = z.string().refine((s) => {
  try {
    return D(s).isFinite();
  } catch {
    return false;
  }
});
const timestamp = z.number().int().positive();
const quoteSchema = z.object({ bidPrice: dec, askPrice: dec, time: timestamp });
const markSchema = z.object({
  markPrice: dec,
  indexPrice: dec,
  lastFundingRate: dec,
  nextFundingTime: timestamp,
  time: timestamp,
});
const fundingSchema = z.array(
  z.object({
    symbol: symbolSchema,
    fundingTime: timestamp,
    fundingRate: dec,
    markPrice: dec,
  }),
);
export async function publicGet(
  path: string,
  deadline = Date.now() + 12000,
): Promise<unknown> {
  check(
    /^\/fapi\/v1\/(time|exchangeInfo|klines|ticker\/bookTicker|premiumIndex|fundingInfo|fundingRate)(\?|$)/.test(
      path,
    ),
    "UNSUPPORTED_CONTRACT",
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new AppError("DEADLINE", 504, true);
      const res = await fetch(`https://fapi.binance.com${path}`, {
        signal: AbortSignal.timeout(Math.min(5000, remaining)),
        cache: "no-store",
      });
      if ([403, 451, 418].includes(res.status))
        throw new AppError("PROVIDER_UNAVAILABLE", 502);
      if (res.status === 429)
        throw new AppError("PROVIDER_RATE_LIMITED", 429, true);
      if (!res.ok) throw new AppError("PROVIDER_UNAVAILABLE", 502, true);
      return await res.json();
    } catch (e) {
      if (e instanceof AppError && !e.retryable) throw e;
      if (e instanceof AppError && e.status === 429) throw e;
      if (attempt || deadline - Date.now() < 5500)
        throw new AppError("PROVIDER_UNAVAILABLE", 502, true);
    }
  }
  throw new AppError("PROVIDER_UNAVAILABLE", 502, true);
}
// Display quotes do not depend on owning a position or running strategy analysis.
export async function displayQuote(symbol: SymbolName) {
  const [quote, mark] = await Promise.all([
    publicGet(`/fapi/v1/ticker/bookTicker?symbol=${symbol}`),
    publicGet(`/fapi/v1/premiumIndex?symbol=${symbol}`),
  ]);
  const q = quoteSchema.parse(quote), m = markSchema.parse(mark), now = Date.now();
  check(Math.abs(now - q.time) <= 15000 && Math.abs(now - m.time) <= 15000, "DATA_STALE");
  check(positive(q.askPrice).gte(positive(q.bidPrice)), "DATA_INVALID");
  positive(m.markPrice);
  return { symbol, bid: q.bidPrice, ask: q.askPrice, mark: m.markPrice, checkedAt: now, markAt: m.time, bookAt: q.time };
}
export function normalizeMetadata(
  raw: unknown,
  symbol: SymbolName,
  now: number,
): InstrumentMetadata {
  const data = z
    .object({
      symbols: z.array(
        z.object({
          symbol: z.string(),
          status: z.string(),
          contractType: z.string(),
          quoteAsset: z.string(),
          marginAsset: z.string(),
          filters: z.array(z.record(z.string(), z.unknown())),
        }),
      ),
    })
    .parse(raw);
  const item = data.symbols.find((x) => x.symbol === symbol);
  check(
    item &&
      item.status === "TRADING" &&
      item.contractType === "PERPETUAL" &&
      item.quoteAsset === "USDT" &&
      item.marginAsset === "USDT",
    "UNSUPPORTED_CONTRACT",
  );
  const filters = Object.fromEntries(
    item.filters.map((f) => [String(f.filterType), f]),
  );
  const price = filters.PRICE_FILTER,
    lot = filters.MARKET_LOT_SIZE,
    notional = filters.MIN_NOTIONAL;
  check(price && lot && notional, "UNSUPPORTED_FILTER");
  const known = [
    "PRICE_FILTER",
    "LOT_SIZE",
    "MARKET_LOT_SIZE",
    "MIN_NOTIONAL",
    "PERCENT_PRICE",
    "MAX_NUM_ORDERS",
    "MAX_NUM_ALGO_ORDERS",
    "POSITION_RISK_CONTROL",
  ];
  return {
    symbol,
    status: "TRADING",
    contractType: "PERPETUAL",
    quoteAsset: "USDT",
    marginAsset: "USDT",
    tickSize: positive(String(price.tickSize)).toFixed(),
    stepSize: positive(String(lot.stepSize)).toFixed(),
    minQty: positive(String(lot.minQty)).toFixed(),
    maxQty: positive(String(lot.maxQty)).toFixed(),
    minNotional: positive(String(notional.notional)).toFixed(),
    fetchedAt: now,
    unsupportedFilters: Object.keys(filters).filter((k) => !known.includes(k)),
  };
}
export function normalizeCandles(
  raw: unknown,
  symbol: SymbolName,
  timeframe: "15m" | "1h",
  cutoff: number,
): Candle[] {
  const rows = z
    .array(z.array(z.union([z.string(), z.number()])).min(7))
    .parse(raw);
  return rows
    .map((r) => ({
      instrumentKey: `${PROVIDER}:${MARKET_TYPE}:${symbol}`,
      provider: PROVIDER,
      symbol,
      marketType: MARKET_TYPE,
      timeframe,
      openAt: Number(r[0]),
      endAt: Number(r[6]) + 1,
      open: String(r[1]),
      high: String(r[2]),
      low: String(r[3]),
      close: String(r[4]),
      volume: String(r[5]),
    }))
    .filter((c) => c.endAt <= cutoff);
}
export async function fetchFunding(
  symbol: SymbolName,
  start: number,
  end: number,
  deadline = Date.now() + 12000,
) {
  const raw = fundingSchema.parse(
    await publicGet(
      `/fapi/v1/fundingRate?symbol=${symbol}&startTime=${start}&endTime=${end}&limit=100`,
      deadline,
    ),
  );
  const events: FundingEvent[] = raw.map((e) => {
    check(
      e.symbol === symbol && e.fundingTime >= start && e.fundingTime <= end,
      "DATA_INVALID",
    );
    positive(e.markPrice);
    return {
      ...e,
      id: hash([PROVIDER, symbol, e.fundingTime, "SETTLED"]),
      instrumentKey: `${PROVIDER}:${MARKET_TYPE}:${symbol}`,
      provider: PROVIDER,
      rateType: "SETTLED",
    };
  });
  for (let i = 1; i < events.length; i++)
    check(events[i]!.fundingTime > events[i - 1]!.fundingTime, "DATA_INVALID");
  return {
    events,
    complete: events.length < 100,
    nextCursor: events.length ? events.at(-1)!.fundingTime + 1 : start,
  };
}
export async function marketSnapshot(
  symbol: SymbolName,
  deadline = Date.now() + 45000,
  options: { includeFunding?: boolean } = {},
): Promise<MarketSnapshot> {
  symbolSchema.parse(symbol);
  const [clock, metadata, c15, c1, quote, mark] = await Promise.all([
    publicGet("/fapi/v1/time", deadline),
    publicGet("/fapi/v1/exchangeInfo", deadline),
    publicGet(
      `/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=102`,
      deadline,
    ),
    publicGet(
      `/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=502`,
      deadline,
    ),
    publicGet(`/fapi/v1/ticker/bookTicker?symbol=${symbol}`, deadline),
    publicGet(`/fapi/v1/premiumIndex?symbol=${symbol}`, deadline),
  ]);
  const fetchedAt = Date.now(),
    serverTime = z.object({ serverTime: timestamp }).parse(clock).serverTime,
    q = quoteSchema.parse(quote),
    m = markSchema.parse(mark),
    candles15m = normalizeCandles(c15, symbol, "15m", serverTime - 5000).slice(
      -100,
    );
  const cutoff = Math.min(serverTime - 5000, candles15m.at(-1)?.endAt ?? 0),
    candles1h = normalizeCandles(c1, symbol, "1h", cutoff).slice(-500);
  // Historical settled events prove the most recent boundary. Execution-only
  // snapshots deliberately leave this pending so a temporary funding outage
  // cannot prevent a user from closing an existing paper position.
  const history =
    options.includeFunding === false
      ? null
      : await fetchFunding(
          symbol,
          serverTime - 86400000 * 2,
          serverTime,
          deadline,
        );
  const last = history?.events.at(-1)?.fundingTime ?? null;
  const s: MarketSnapshot = {
    id: "",
    provider: PROVIDER,
    symbol,
    marketType: MARKET_TYPE,
    instrumentKey: `${PROVIDER}:${MARKET_TYPE}:${symbol}`,
    serverTime,
    fetchedAt,
    candles15m,
    candles1h,
    quote: { bid: q.bidPrice, ask: q.askPrice, providerAt: q.time, fetchedAt },
    derivatives: {
      markPrice: m.markPrice,
      indexPrice: m.indexPrice,
      indicativeFundingRate: m.lastFundingRate,
      nextFundingTime: m.nextFundingTime,
      providerAt: m.time,
      fetchedAt,
      rawLastFundingRate: m.lastFundingRate,
    },
    metadata: normalizeMetadata(metadata, symbol, fetchedAt),
    fundingState: {
      complete: history?.complete === true && last !== null,
      lastConfirmedFundingTime: last,
      lastExpectedFundingTime: last,
      checkedThrough: serverTime,
    },
  };
  s.id = hash(s);
  s.dataHash = s.id;
  validatePrices(s);
  validateCandles(candles15m, 100, 900000, serverTime - 5000);
  validateCandles(candles1h, 500, 3600000, cutoff);
  return s;
}
