import { expect, it } from "vitest";
import { accountingSignal } from "../../fixtures/market";
import { autoEntryRequest } from "../../src/lib/auto-entry";

function candidate(side: "LONG" | "SHORT" = "LONG") {
  const signal = accountingSignal(side);
  return { ...signal, reviewStatus: "TECHNICAL_CONFIRMED", baseline: { decision: signal.decision, side, reasons: [], evidence: {}, plan: signal.plan, candleEndAt: signal.candleEndAt, expiresAt: signal.expiresAt } };
}
it.each(["LONG", "SHORT"] as const)("creates a stable paper entry request for %s without AI", side => {
  const s = candidate(side);
  const request = autoEntryRequest(s, Date.now());
  expect(request?.body).toEqual({ signalId: s.id, leverage: s.plan!.leverage });
  expect(autoEntryRequest(s, Date.now())).toEqual(request);
});
it("never auto opens WAIT, expired, consumed, manual or unconfirmed signals", () => {
  const s = candidate();
  for (const invalid of [
    { ...s, decision: "WAIT" as const }, { ...s, expiresAt: Date.now() - 1 },
    { ...s, consumedPositionId: "already-open" }, { ...s, strategyVersion: "manual-experiment-v2" },
    { ...s, reviewStatus: "NOT_REQUESTED" }, { ...s, baseline: { ...s.baseline, reasons: ["VOLUME_FILTER"] } },
  ]) expect(autoEntryRequest(invalid, Date.now())).toBeNull();
});
