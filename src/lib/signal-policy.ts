import type { BaselineResult, Signal } from "./domain";
export type SignalMode = "TECHNICAL" | "AI";
export const signalMode = (settingsAi: boolean, enabled: string): SignalMode => settingsAi && enabled === "true" ? "AI" : "TECHNICAL";
export function technicalPassed(b: BaselineResult | undefined) {
  return !!b?.plan && !!b.side && b.plan.side === b.side && b.decision === `${b.side}_CANDIDATE` && b.reasons.length === 0;
}
export function decideSignal(baseline: BaselineResult, mode: SignalMode, verdict?: string) {
  return technicalPassed(baseline) && (mode === "TECHNICAL" || verdict === "CONFIRM") ? baseline.decision : "WAIT";
}
export function entryApproved(signal: Signal, mode: SignalMode) {
  if (!signal.side || !signal.plan || signal.plan.side !== signal.side || signal.decision !== `${signal.side}_CANDIDATE` || !technicalPassed(signal.baseline) || signal.baseline?.side !== signal.side) return false;
  if (signal.strategyVersion.startsWith("manual-") || signal.reviewStatus === "ACCOUNT_CHANGED") return false;
  return mode === "TECHNICAL"
    ? signal.reviewStatus === "TECHNICAL_CONFIRMED"
    : signal.reviewStatus === "AVAILABLE" && (signal.review as { verdict?: string } | null)?.verdict === "CONFIRM";
}
