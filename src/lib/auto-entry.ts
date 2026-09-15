import type { Signal } from "./domain";
import { entryApproved } from "./signal-policy";
import type { SignalMode } from "./signal-policy";

// Only approved signals for the active mode. Server revalidates all risk gates.
export function autoEntryRequest(signal: Signal, now: number, mode: SignalMode = "TECHNICAL") {
  if (!entryApproved(signal, mode) || signal.consumedPositionId || !Number.isFinite(signal.expiresAt) || signal.expiresAt <= now) return null;
  return {
    body: { signalId: signal.id, leverage: signal.plan!.leverage },
    // Stable across tabs/reloads and retries; never generate a new key on timeout.
    key: `auto-paper-${signal.id}`,
  };
}
