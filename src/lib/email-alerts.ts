import { createHash } from "node:crypto";
import { z } from "zod";
import type { Signal } from "./domain";
import { getConfig } from "./config";
import { getDb } from "./firebase/admin";
import { entryApproved } from "./signal-policy";

export function emailContent(signal: Signal, origin: string, now = Date.now()) {
  if (signal.strategyVersion.startsWith("manual-") || signal.consumedPositionId ||
      signal.expiresAt <= now || !signal.plan || !signal.side ||
      !(entryApproved(signal, "TECHNICAL") || entryApproved(signal, "AI"))) return null;
  return {
    subject: `[SinyalLab Paper] ${signal.side} ${signal.symbol}`,
    text: [
      `Sinyal ${signal.side} ${signal.symbol} (simulasi paper)`,
      `Entry: ${signal.plan.entry} USDT`,
      `Stop-loss: ${signal.plan.stop} USDT`,
      `Target: ${signal.plan.target} USDT`,
      `Berlaku sampai: ${new Date(signal.expiresAt).toISOString()}`,
      `${origin}/signals/${encodeURIComponent(signal.id)}`,
      "Periksa harga terbaru sebelum entry. Sinyal bukan konfirmasi transaksi.",
    ].join("\n"),
  };
}

// Awaited by the analysis request; delivery failure must never undo a signal.
export async function sendSignalEmail(uid: string, signal: Signal) {
  if (process.env.EMAIL_ALERTS_ENABLED !== "true") return;
  try {
    const config = getConfig();
    if (uid !== config.OWNER_UID || config.demo) return;
    const content = emailContent(signal, config.APP_ORIGIN);
    if (!content) return;
    const to = z.email().parse(process.env.SIGNAL_EMAIL_TO?.trim());
    const from = z.email().parse(process.env.SIGNAL_EMAIL_FROM?.trim());
    const token = process.env.RESEND_API_KEY?.trim();
    if (!token) throw new Error("EMAIL_CONFIG");
    const key = createHash("sha256").update(`${uid}:${signal.id}:${to}`).digest("hex");
    const ref = getDb().doc(`users/${uid}/emailAlerts/${key}`);
    if ((await ref.get()).data()?.status === "ACCEPTED") return;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ from, to: [to], ...content }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      await ref.set({ status: "FAILED", httpStatus: response.status, attemptedAt: Date.now(), signalId: signal.id });
      return;
    }
    const data = await response.json() as { id?: string };
    if (!data.id) throw new Error("EMAIL_RESPONSE");
    await ref.set({ status: "ACCEPTED", providerId: data.id, attemptedAt: Date.now(), signalId: signal.id });
  } catch {
    // Never log provider payloads, credentials, or recipient addresses.
    console.warn("SIGNAL_EMAIL_UNAVAILABLE");
  }
}
