import { marketSnapshot } from "../src/lib/market";
async function main() {
  for (const symbol of [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "BNBUSDT",
    "XRPUSDT",
  ] as const) {
    try {
      const s = await marketSnapshot(symbol);
      console.log(
        JSON.stringify({
          symbol,
          status: "PASSED",
          provider: s.provider,
          candles15m: s.candles15m.length,
          candles1h: s.candles1h.length,
          sourceAt: s.serverTime,
          snapshotId: s.id,
        }),
      );
    } catch {
      console.log(
        JSON.stringify({
          symbol,
          status: "FAILED",
          reason: "PROVIDER_OR_CONTRACT_UNAVAILABLE",
        }),
      );
      process.exitCode = 1;
    }
  }
  console.log(
    "This validates the current execution environment only; it does not prove Vercel region access.",
  );
}
void main();
