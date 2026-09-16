import { describe, expect, it } from "vitest";
import { accountingSignal } from "../../fixtures/market";
import { signalAlert, scanCandle, nextScanAt, SIGNAL_INTERVAL } from "../../src/lib/signal-alerts";
const now = 1800000000000;
function candidate(side: "LONG" | "SHORT" = "LONG") {
  const s = accountingSignal(side, now);
  return { ...s, reviewStatus: "TECHNICAL_CONFIRMED", baseline: { decision: s.decision, side, reasons: [], evidence: {}, plan: s.plan, candleEndAt: s.candleEndAt, expiresAt: s.expiresAt } };
}
describe("signal notification policy", () => {
  it.each(["LONG", "SHORT"] as const)("labels technical and AI-confirmed %s separately", side => {
    const s = candidate(side);
    s.decision = "WAIT";
    expect(signalAlert(s, now)).toBeNull();
    s.decision = `${side}_CANDIDATE`;
    s.reviewStatus = "AVAILABLE";
    s.review = { verdict: "CONFIRM" };
    expect(signalAlert(s, now)?.confirmed).toBe(true);
  });
  it("never alerts for manual, expired, consumed, risk-blocked, account-changed or AI-rejected signals", () => {
    const s = candidate();
    for (const blocked of [
      { ...s, strategyVersion: "manual-experiment-v2" },
      { ...s, expiresAt: now },
      { ...s, consumedPositionId: "open" },
      { ...s, plan: null },
      { ...s, review: { verdict: "WAIT" } },
      { ...s, reviewStatus: "ACCOUNT_CHANGED" },
      { ...s, decision: "WAIT" as const, reviewStatus: "INVALID" },
      { ...s, baseline: { ...s.baseline, reasons: ["VOLUME_FILTER"] } },
    ]) expect(signalAlert(blocked, now)).toBeNull();
  });
  it("deduplicates repeated scans of the same candle while distinguishing a new candle", () => {
    const s = candidate();
    expect(signalAlert({ ...s, id: "new-id" }, now)?.key).toBe(signalAlert(s, now)?.key);
    expect(signalAlert({ ...s, candleEndAt: s.candleEndAt + SIGNAL_INTERVAL }, now)?.key).not.toBe(signalAlert(s, now)?.key);
  });
  it("waits ten seconds after the candle closes before scheduling the next scan", () => {
    const boundary = Math.floor(now / SIGNAL_INTERVAL) * SIGNAL_INTERVAL;
    expect(scanCandle(boundary + 9999)).toBe(boundary - SIGNAL_INTERVAL);
    expect(scanCandle(boundary + 10000)).toBe(boundary);
    expect(nextScanAt(boundary + 10000)).toBe(boundary + SIGNAL_INTERVAL + 10000);
  });
});
