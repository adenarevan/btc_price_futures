import type { Signal } from "./domain";
import { entryApproved } from "./signal-policy";
export const SIGNAL_INTERVAL = 15 * 60 * 1000;
export const scanCandle = (now: number) => Math.floor((now - 10000) / SIGNAL_INTERVAL) * SIGNAL_INTERVAL;
export const nextScanAt = (now: number) => scanCandle(now) + SIGNAL_INTERVAL + 10000;
export function signalAlert(signal: Signal, now: number) {
  if (signal.strategyVersion.startsWith("manual-") || signal.reviewStatus === "ACCOUNT_CHANGED" || signal.consumedPositionId || !signal.plan || !signal.side || signal.expiresAt <= now || signal.createdAt > now + 5000) return null;
  const review = signal.review as { verdict?: string } | null;
  if (review?.verdict === "WAIT") return null;
  const confirmed = signal.decision === `${signal.side}_CANDIDATE` && review?.verdict === "CONFIRM";
  const approvedTechnical = entryApproved(signal, "TECHNICAL");
  const technical = signal.baseline?.decision === `${signal.side}_CANDIDATE` && !!signal.baseline.plan && signal.baseline.reasons.length === 0;
  if (!confirmed && !technical) return null;
  return {
    key: `${signal.symbol}:${signal.side}:${signal.candleEndAt}:${signal.strategyVersion}:${confirmed ? "confirmed" : "technical"}`,
    title: `${signal.side} ${signal.symbol} · ${confirmed ? "dikonfirmasi AI" : approvedTechnical ? "lolos analisis teknikal" : "kandidat teknikal"}`,
    body: `Entry ${signal.plan.entry} · Stop ${signal.plan.stop} · Target ${signal.plan.target}. ${confirmed || approvedTechnical ? "Buka detail untuk meninjau simulasi." : "Belum dikonfirmasi; periksa detail sebelum latihan."}`,
    confirmed,
  };
}
