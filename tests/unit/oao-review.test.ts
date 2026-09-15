import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { reviewCandidate } from "../../src/lib/agent";
import { aiKeyPresent } from "../../src/lib/config";
import { evaluateBaseline, DEFAULT_SETTINGS, newAccount } from "../../src/lib/engine";
import { snapshot } from "../../fixtures/market";

const market = snapshot();
const baseline = () => evaluateBaseline(snapshot(), DEFAULT_SETTINGS, { account: newAccount(), positions: [] });
const valid = () => ({ verdict: "CONFIRM", summary: "Fakta mendukung kandidat", supporting: [{ factId: "trend.ema50", observation: "Tren mendukung" }], opposing: [], missingEvidence: [], riskFlags: [], nextCheck: "NEXT_CLOSED_CANDLE" });
const response = (content: unknown, finish = "stop") => Response.json({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } });
beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "oao"); vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("OAO_API_KEY", "test-oao-key"); vi.stubEnv("OPENAI_API_KEY", "must-not-forward");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("uses the exact chat endpoint and isolated key; validates review and usage", async () => {
  const fetcher = vi.fn().mockResolvedValue(response(valid())); vi.stubGlobal("fetch", fetcher);
  const result = await reviewCandidate(baseline(), market, Date.now() + 30000);
  expect(result).toMatchObject({ reviewStatus: "AVAILABLE", inputTokens: 100, outputTokens: 80, review: { verdict: "CONFIRM" } });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url).toBe("https://oao.clipora.buzz/v1/chat/completions");
  expect(options.redirect).toBe("error");
  expect(options.headers.Authorization).toBe("Bearer test-oao-key");
  expect(options.body).not.toContain("must-not-forward");
  expect(JSON.parse(options.body)).toMatchObject({ model: "auto-oao-1", max_tokens: 2000, stream: false });
});
it.each(["malformed", "truncated", "invented", "contradictory", "http", "timeout"])("fails closed without retries for %s", async kind => {
  const r = valid();
  if (kind === "invented") r.supporting[0]!.factId = "fake-news";
  const fetcher = kind === "timeout" ? vi.fn().mockRejectedValue(new Error("provider secret error")) : vi.fn().mockResolvedValue(
    kind === "http" ? new Response("provider secret error", { status: 401 }) : response(kind === "malformed" ? { side: "LONG" } : kind === "contradictory" ? { ...r, riskFlags: ["STALE_DATA"] } : r, kind === "truncated" ? "length" : "stop"));
  vi.stubGlobal("fetch", fetcher);
  const result = await reviewCandidate(baseline(), market, Date.now() + 30000);
  expect(result.review).toBeNull(); expect(result.reviewStatus).toBe("INVALID");
  expect(JSON.stringify(result)).not.toContain("secret"); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not call a provider for WAIT, disabled AI or missing OAO key; no OpenAI fallback", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await reviewCandidate({ ...baseline(), decision: "WAIT" }, market, Date.now() + 30000);
  vi.stubEnv("AI_ENABLED", "false"); await reviewCandidate(baseline(), market, Date.now() + 30000);
  vi.stubEnv("AI_ENABLED", "true"); vi.stubEnv("OAO_API_KEY", "");
  expect(aiKeyPresent()).toBe(false);
  await reviewCandidate(baseline(), market, Date.now() + 30000);
  expect(fetcher).not.toHaveBeenCalled();
});
