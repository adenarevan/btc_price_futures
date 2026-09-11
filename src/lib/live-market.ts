import { D } from "./decimal";
import type { Position, SymbolName } from "./domain";

export const LIVE_SYMBOLS: SymbolName[] = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
export const LIVE_MAX_AGE = 15000;
export type LiveQuote = {
  symbol: SymbolName;
  mark?: string;
  bid?: string;
  ask?: string;
  markAt?: number;
  bookAt?: number;
  markSource?: "ws" | "rest";
  bookSource?: "ws" | "rest";
  movement?: "up" | "down" | "flat";
};
export type QuotePatch = Partial<LiveQuote> & { symbol: SymbolName };
const price = (v: unknown): v is string => {
  try { return typeof v === "string" && D(v).isFinite() && D(v).gt(0); }
  catch { return false; }
};
export function fresh(at: number | undefined, now: number) {
  return !!at && now - at <= LIVE_MAX_AGE && at - now <= 5000;
}
export function quoteFresh(q: LiveQuote | undefined, now: number) {
  return !!q?.mark && !!q.bid && !!q.ask && fresh(q.markAt, now) && fresh(q.bookAt, now);
}
// Binance routed stream URLs: market = markPrice, public = bookTicker.
export const STREAM_URLS = [
  `wss://fstream.binance.com/market/stream?streams=${LIVE_SYMBOLS.map(s => `${s.toLowerCase()}@markPrice@1s`).join("/")}`,
  `wss://fstream.binance.com/public/stream?streams=${LIVE_SYMBOLS.map(s => `${s.toLowerCase()}@bookTicker`).join("/")}`,
];
export function parseStream(raw: string, now: number): QuotePatch | null {
  try {
    const payload = JSON.parse(raw), event = payload?.data ?? payload;
    if (!event || !LIVE_SYMBOLS.includes(event.s) || !Number.isSafeInteger(event.E) || !fresh(event.E, now)) return null;
    if (event.e === "markPriceUpdate" && price(event.p))
      return { symbol: event.s, mark: event.p, markAt: event.E, markSource: "ws" };
    if (event.e === "bookTicker" && price(event.b) && price(event.a) && D(event.a).gte(event.b))
      return { symbol: event.s, bid: event.b, ask: event.a, bookAt: event.E, bookSource: "ws" };
  } catch { /* Invalid frames must never replace a valid price. */ }
  return null;
}
export function mergeQuote(old: LiveQuote | undefined, patch: QuotePatch): LiveQuote {
  const next: LiveQuote = { ...old, symbol: patch.symbol };
  if (price(patch.mark) && patch.markAt && patch.markAt > (old?.markAt ?? 0)) {
    next.movement = !old?.mark ? "flat" : D(patch.mark).gt(old.mark) ? "up" : D(patch.mark).lt(old.mark) ? "down" : old.movement ?? "flat";
    Object.assign(next, { mark: patch.mark, markAt: patch.markAt, markSource: patch.markSource });
  }
  if (price(patch.bid) && price(patch.ask) && D(patch.ask).gte(patch.bid) && patch.bookAt && patch.bookAt > (old?.bookAt ?? 0))
    Object.assign(next, { bid: patch.bid, ask: patch.ask, bookAt: patch.bookAt, bookSource: patch.bookSource });
  return next;
}
export function estimatePositionNet(p: Position, bid: string, ask: string) {
  const direction = p.side === "LONG" ? 1 : -1;
  const exit = D(p.side === "LONG" ? bid : ask).mul(D(1).sub(D(p.slippageRate).mul(direction)));
  return exit.sub(p.entry).mul(direction).mul(p.qty).sub(p.entryFee)
    .sub(exit.mul(p.qty).mul(p.feeRate)).add(p.fundingNet).toFixed();
}
