import { describe, expect, it } from "vitest";
import { snapshot, accountingSignal } from "../../fixtures/market";
import { evaluateBaseline, newAccount, DEFAULT_SETTINGS } from "../../src/lib/engine";
import { decideSignal, entryApproved, signalMode } from "../../src/lib/signal-policy";
import { signalAlert } from "../../src/lib/signal-alerts";
describe("explicit technical confirmation without AI", () => {
  it.each(["LONG", "SHORT"] as const)("approves a qualified %s without tokens and supports entry", side => {
    const baseline = evaluateBaseline(snapshot(side), DEFAULT_SETTINGS, { account: newAccount(), positions: [] });
    const decision = decideSignal(baseline, "TECHNICAL");
    expect(decision).toBe(`${side}_CANDIDATE`);
    const signal = { ...accountingSignal(side), baseline, plan: baseline.plan, decision, reviewStatus: "TECHNICAL_CONFIRMED" };
    expect(entryApproved(signal, "TECHNICAL")).toBe(true);
    expect(entryApproved(signal, "AI")).toBe(false);
    expect(signalAlert(signal, Date.now())?.title).toContain("lolos analisis teknikal");
    expect(signalAlert(signal, Date.now())?.confirmed).toBe(false);
  });
  it("keeps volume/risk failures at WAIT; does not turn an AI failure into technical approval", () => {
    const s = snapshot(); s.candles15m.at(-1)!.volume = "1";
    const b = evaluateBaseline(s, DEFAULT_SETTINGS, { account: newAccount(), positions: [] });
    expect(decideSignal(b, "TECHNICAL")).toBe("WAIT");
    const valid = evaluateBaseline(snapshot(), DEFAULT_SETTINGS, { account: newAccount(), positions: [] });
    expect(decideSignal(valid, "AI")).toBe("WAIT");
    expect(decideSignal(valid, "AI", "WAIT")).toBe("WAIT");
    expect(decideSignal(valid, "AI", "CONFIRM")).toBe("LONG_CANDIDATE");
    expect(signalMode(true, "false")).toBe("TECHNICAL");
    expect(signalMode(true, "true")).toBe("AI");
    expect(entryApproved({ ...accountingSignal(), baseline: valid }, "TECHNICAL")).toBe(false);
  });
});
