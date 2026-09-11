import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marketSnapshot } from "../../src/lib/market";

const now = Date.UTC(2026, 8, 11, 3, 0, 5);
const rows = (count: number, interval: number, close: number) =>
  Array.from({ length: count }, (_, index) => {
    const open = close - (count - index) * interval;
    return [
      open,
      "100",
      "101",
      "99",
      "100",
      "10",
      open + interval - 1,
    ];
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("market execution snapshot", () => {
  it("allows a fresh executable quote without calling the funding endpoint", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const path = String(input);
      const body = path.includes("/time")
        ? { serverTime: now }
        : path.includes("exchangeInfo")
          ? {
              symbols: [
                {
                  symbol: "BTCUSDT",
                  status: "TRADING",
                  contractType: "PERPETUAL",
                  quoteAsset: "USDT",
                  marginAsset: "USDT",
                  filters: [
                    { filterType: "PRICE_FILTER", tickSize: "0.01" },
                    {
                      filterType: "MARKET_LOT_SIZE",
                      stepSize: "0.001",
                      minQty: "0.001",
                      maxQty: "1000",
                    },
                    { filterType: "MIN_NOTIONAL", notional: "5" },
                  ],
                },
              ],
            }
          : path.includes("interval=15m")
            ? rows(102, 900000, now - 5000)
            : path.includes("interval=1h")
              ? rows(502, 3600000, now - 5000)
              : path.includes("bookTicker")
                ? { bidPrice: "100", askPrice: "100.1", time: now }
                : path.includes("premiumIndex")
                  ? {
                      markPrice: "100.05",
                      indexPrice: "100",
                      lastFundingRate: "0.0001",
                      nextFundingTime: now + 3600000,
                      time: now,
                    }
                  : (() => {
                      throw new Error(`unexpected request ${path}`);
                    })();
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await marketSnapshot("BTCUSDT", now + 12000, {
      includeFunding: false,
    });

    expect(snapshot.fundingState.complete).toBe(false);
    expect(snapshot.quote.bid).toBe("100");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContainEqual(
      expect.stringContaining("fundingRate"),
    );
  });
});
