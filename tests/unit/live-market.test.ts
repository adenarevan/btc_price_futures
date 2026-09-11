import { describe, expect, it } from "vitest";
import { parseStream, mergeQuote, quoteFresh, estimatePositionNet } from "../../src/lib/live-market";
import { snapshot, accountingSignal } from "../../fixtures/market";
import { newAccount } from "../../src/lib/engine";
import { openPosition, closePosition } from "../../src/lib/portfolio/ledger";
import { D } from "../../src/lib/decimal";
const now = 1800000000000;
describe("live market display", () => {
  it("merges independently timed streams and ignores delayed REST or out-of-order frames", () => {
    const mark = parseStream(JSON.stringify({ data: { e: "markPriceUpdate", s: "BTCUSDT", p: "100", E: now } }), now)!;
    const book = parseStream(JSON.stringify({ e: "bookTicker", s: "BTCUSDT", b: "99", a: "101", E: now + 1 }), now)!;
    let q = mergeQuote(mergeQuote(undefined, mark), book);
    expect(quoteFresh(q, now)).toBe(true);
    q = mergeQuote(q, { symbol: "BTCUSDT", mark: "102", markAt: now + 2, markSource: "ws" });
    expect(q.movement).toBe("up");
    expect(mergeQuote(q, { symbol: "BTCUSDT", mark: "90", markAt: now - 1, markSource: "rest" }).mark).toBe("102");
    expect(quoteFresh(mergeQuote(q, { symbol: "BTCUSDT", mark: "103", markAt: now + 16000 }), now + 16002)).toBe(false);
  });
  it("rejects malformed, unsupported, stale, future, crossed and negative prices", () => {
    for (const frame of [null, { e: "markPriceUpdate", s: "BAD", p: "10", E: now }, { e: "markPriceUpdate", s: "BTCUSDT", p: "-10", E: now }, { e: "markPriceUpdate", s: "BTCUSDT", p: "NaN", E: now }, { e: "markPriceUpdate", s: "BTCUSDT", p: "10", E: now - 16000 }, { e: "markPriceUpdate", s: "BTCUSDT", p: "10", E: now + 6000 }, { e: "bookTicker", s: "BTCUSDT", a: "9", b: "10", E: now }])
      expect(parseStream(JSON.stringify(frame), now)).toBeNull();
    expect(parseStream("not json", now)).toBeNull();
  });
  it.each(["LONG", "SHORT"] as const)("%s live estimate matches a close using the same prices and costs", side => {
    const signal = accountingSignal(side), s = snapshot(side);
    s.quote.bid = s.quote.ask = s.derivatives.markPrice = "100";
    const opened = openPosition({ account: newAccount(), positions: [], signal, plan: signal.plan!, positionId: "live-test", snapshot: s, now: Date.now() });
    s.quote.bid = "105"; s.quote.ask = "106";
    const estimate = estimatePositionNet(opened.position, s.quote.bid, s.quote.ask);
    const closed = closePosition({ account: opened.account, position: opened.position, snapshot: s, now: Date.now() });
    expect(estimate).toBe(closed.position.netPnl);
    const raised = estimatePositionNet(opened.position, "110", "111");
    expect(D(raised).gt(estimate)).toBe(side === "LONG");
    expect(opened.position.status).toBe("OPEN");
  });
});
