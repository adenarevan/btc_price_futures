import { describe, expect, it } from "vitest";
import { snapshot, accountingSignal } from "../../fixtures/market";
import { atr, createPlan, createManualPlan, DEFAULT_SETTINGS, newAccount } from "../../src/lib/engine";
import { D } from "../../src/lib/decimal";
import { openPosition, closePosition } from "../../src/lib/portfolio/ledger";

function quietMarket() {
  const s = snapshot();
  s.quote.bid = s.quote.ask = s.derivatives.markPrice = "100";
  s.candles15m.forEach(c => { c.open = c.close = "100"; c.high = "100.02"; c.low = "99.98"; });
  return s;
}
describe("manual practice after trading costs", () => {
  it.each(["LONG", "SHORT"] as const)("%s previews then opens/closes with bounded risk", side => {
    const s = quietMarket(), context = { account: newAccount(), positions: [] };
    expect(() => createPlan({ snapshot: s, side, settings: DEFAULT_SETTINGS, context, atr: atr(s.candles15m), triggerClose: "100" })).toThrow("NET_RR_TOO_LOW");
    const plan = createManualPlan({ snapshot: s, side, settings: DEFAULT_SETTINGS, context });
    expect(D(plan.netRR).gte(2)).toBe(true);
    expect(D(plan.plannedRisk).lte(5)).toBe(true);
    expect(D(plan.initialMargin).lte(100)).toBe(true);
    expect(plan.strategyVersion).toBe("manual-experiment-v2");
    const signal = { ...accountingSignal(side), plan };
    const opened = openPosition({ ...context, signal, plan, positionId: "test-manual", snapshot: s, now: Date.now() });
    const exitSnapshot = structuredClone(s);
    exitSnapshot.quote.bid = exitSnapshot.quote.ask = plan.target;
    const closed = closePosition({ account: opened.account, position: opened.position, snapshot: exitSnapshot, now: Date.now() + 1 });
    // At the target, actual net (without reserved future funding) covers 2R.
    expect(D(closed.position.netPnl).gte(D(plan.plannedRisk).mul(2))).toBe(true);
    expect(context.account.availableCollateral).toBe("1000");
  });
  it("retains per-symbol, quantity and funding rejection gates", () => {
    const s = quietMarket(), account = newAccount();
    const plan = createManualPlan({ snapshot: s, side: "LONG", settings: DEFAULT_SETTINGS, context: { account, positions: [] } });
    const opened = openPosition({ account, positions: [], signal: { ...accountingSignal(), plan }, plan, positionId: "existing", snapshot: s, now: Date.now() });
    expect(() => createManualPlan({ snapshot: s, side: "SHORT", settings: DEFAULT_SETTINGS, context: { account: opened.account, positions: [opened.position] } })).toThrow("SYMBOL_POSITION_EXISTS");
    s.metadata.minNotional = "999999";
    expect(() => createManualPlan({ snapshot: s, side: "LONG", settings: DEFAULT_SETTINGS, context: { account, positions: [] } })).toThrow("POSITION_SIZE_REJECTED");
    s.fundingState.complete = false;
    expect(() => createManualPlan({ snapshot: s, side: "LONG", settings: DEFAULT_SETTINGS, context: { account, positions: [] } })).toThrow("FUNDING_PENDING");
  });
});
