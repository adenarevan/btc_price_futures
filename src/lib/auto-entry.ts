import type { Signal } from "./domain";
import { entryApproved } from "./signal-policy";

// Only confirmed technical paper signals. Server revalidates all risk gates.
export function autoEntryRequest(signal: Signal, now: number) {
  if (!entryApproved(signal, "TECHNICAL") || signal.consumedPositionId || !Number.isFinite(signal.expiresAt) || signal.expiresAt <= now) return null;
  return {
    body: { signalId: signal.id, leverage: signal.plan!.leverage },
    // Stable across tabs/reloads and retries; never generate a new key on timeout.
    key: `auto-paper-${signal.id}`,
  };
}
