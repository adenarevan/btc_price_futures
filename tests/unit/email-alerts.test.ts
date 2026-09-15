import { afterEach, expect, it, vi } from "vitest";
import { accountingSignal, snapshot } from "../../fixtures/market";
import { DEFAULT_SETTINGS, evaluateBaseline, newAccount } from "../../src/lib/engine";
import { emailContent, sendSignalEmail } from "../../src/lib/email-alerts";
vi.mock("../../src/lib/config", () => ({ getConfig: () => ({ OWNER_UID: "owner", APP_ORIGIN: "https://example.com", demo: false }) }));
const db = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("../../src/lib/firebase/admin", () => ({ getDb: () => ({ doc: () => db }) }));
function signal() {
  const s = accountingSignal();
  s.baseline = evaluateBaseline(snapshot(), DEFAULT_SETTINGS, { account: newAccount(), positions: [] });
  s.reviewStatus = "TECHNICAL_CONFIRMED";
  return s;
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("includes the complete paper plan", () => {
  const content = emailContent(signal(), "https://example.com")!;
  expect(content.subject).toContain("LONG BTCUSDT");
  expect(content.text).toContain("Stop-loss: 90");
  expect(content.text).toContain("Target: 120");
});
it("excludes WAIT, expired, and consumed signals", () => {
  const s = signal();
  expect(emailContent({ ...s, decision: "WAIT" }, "https://example.com")).toBeNull();
  expect(emailContent({ ...s, expiresAt: 0 }, "https://example.com")).toBeNull();
  expect(emailContent({ ...s, consumedPositionId: "opened" }, "https://example.com")).toBeNull();
});
it("uses provider idempotency and skips accepted messages", async () => {
  vi.stubEnv("EMAIL_ALERTS_ENABLED", "true");
  vi.stubEnv("SIGNAL_EMAIL_TO", "recipient@example.com");
  vi.stubEnv("SIGNAL_EMAIL_FROM", "sender@example.com");
  vi.stubEnv("RESEND_API_KEY", "test-key");
  db.get.mockResolvedValueOnce({ data: () => undefined }).mockResolvedValueOnce({ data: () => ({ status: "ACCEPTED" }) });
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "mail-id" })));
  vi.stubGlobal("fetch", fetcher);
  const s = signal();
  await sendSignalEmail("owner", s);
  await sendSignalEmail("owner", s);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![1].headers["Idempotency-Key"]).toHaveLength(64);
  expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: "ACCEPTED" }));
});
it("disabled alerts never contact the provider", async () => {
  vi.stubEnv("EMAIL_ALERTS_ENABLED", "false");
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await sendSignalEmail("owner", signal());
  expect(fetcher).not.toHaveBeenCalled();
});
