import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snapshot, accountingSignal } from "../../fixtures/market";
import { DEFAULT_SETTINGS, newAccount, evaluateBaseline } from "../../src/lib/engine";
import { D } from "../../src/lib/decimal";
import type { PaperAccount, Position } from "../../src/lib/domain";

const state = vi.hoisted(() => ({ docs: new Map<string, unknown>(), market: vi.fn() }));
const accountPath = "users/test-owner/accounts/paper-futures-v1";
vi.mock("../../src/lib/repository", () => ({
  path: (uid: string, collection: string, id: string) => `users/${uid}/${collection}/${id}`,
  read: async (path: string) => structuredClone(state.docs.get(path) ?? null),
  encode: (value: unknown) => value,
  decode: (value: unknown) => value,
  context: async () => ({
    account: structuredClone(state.docs.get("users/test-owner/accounts/paper-futures-v1")),
    positions: [...state.docs.entries()].filter(([path, value]) => path.includes("/positions/") && (value as Position).status === "OPEN").map(([, value]) => structuredClone(value)),
  }),
  settings: async () => ({ ...DEFAULT_SETTINGS }),
  acquire: async () => ({}),
  release: async () => {},
  assertLease: async () => {},
  put: (tx: { stage: Map<string, unknown> }, path: string, value: unknown) => tx.stage.set(path, structuredClone(value)),
}));
vi.mock("../../src/lib/firebase/admin", () => ({
  getDb: () => ({
    doc: (path: string) => ({ path, set: async (value: unknown) => { state.docs.set(path, structuredClone(value)); } }),
    runTransaction: async (work: (tx: unknown) => Promise<void>) => {
      const stage = new Map<string, unknown>();
      await work({ stage, get: async (ref: { path: string }) => ({ data: () => structuredClone(state.docs.get(ref.path)) }) });
      stage.forEach((value, path) => state.docs.set(path, value));
    },
  }),
}));
vi.mock("../../src/lib/market", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/lib/market")>(),
  marketSnapshot: state.market,
  fetchFunding: async () => ({ events: [], complete: true, nextCursor: Date.now() }),
}));
import { openManualPosition, closePosition, previewManualPosition, refreshPositions, openPosition as openStrategyPosition } from "../../src/lib/services";
afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  state.docs.clear();
  state.docs.set(accountPath, newAccount());
  state.market.mockReset();
  state.market.mockImplementation(async () => snapshot());
});
describe("manual service lifecycle with isolated persistence", () => {
  it.each(["LONG", "SHORT"] as const)("auto closes %s only at fresh executable stop/target, once", async side => {
    for (const level of ["stop", "target"] as const) {
      const p = await openManualPosition("test-owner", { symbol: "BTCUSDT", side }, `exit-open-${side}-${level}`);
      await refreshPositions("test-owner", true);
      expect((state.docs.get(`users/test-owner/positions/${p.id}`) as Position).status).toBe("OPEN");
      state.market.mockImplementation(async () => {
        const s = snapshot();
        s.quote.bid = p[level]; s.quote.ask = p[level]; s.derivatives.markPrice = p[level];
        return s;
      });
      await refreshPositions("test-owner");
      expect((state.docs.get(`users/test-owner/positions/${p.id}`) as Position).status).toBe("OPEN");
      await refreshPositions("test-owner", true);
      const closed = state.docs.get(`users/test-owner/positions/${p.id}`) as Position;
      expect(closed.status).toBe("CLOSED");
      expect(closed.validityFlags).toContain(level === "stop" ? "AUTO_EXIT_STOP" : "AUTO_EXIT_TARGET");
      const balance = (state.docs.get(accountPath) as PaperAccount).availableCollateral;
      await refreshPositions("test-owner", true);
      expect((state.docs.get(accountPath) as PaperAccount).availableCollateral).toBe(balance);
      state.market.mockImplementation(async () => snapshot());
    }
  });
  it("does not auto close using stale data", async () => {
    const p = await openManualPosition("test-owner", { symbol: "BTCUSDT", side: "LONG" }, "stale-exit-open");
    state.market.mockImplementation(async () => { const s = snapshot(); s.quote.bid = p.stop; s.quote.ask = p.stop; s.quote.fetchedAt -= 60000; return s; });
    await refreshPositions("test-owner", true);
    const stored = state.docs.get(`users/test-owner/positions/${p.id}`) as Position;
    expect(stored.status).toBe("OPEN");
    expect(stored.validityFlags).toContain("POSITION_UNVERIFIED");
  });
  it("opens a qualified technical signal with AI disabled, retaining risk revalidation", async () => {
    vi.stubEnv("AI_ENABLED", "false");
    const baseline = evaluateBaseline(snapshot(), DEFAULT_SETTINGS, { account: newAccount(), positions: [] });
    const signal = { ...accountingSignal(), id: "technical-confirmed", baseline, plan: baseline.plan, reviewStatus: "TECHNICAL_CONFIRMED" };
    state.docs.set(`users/test-owner/signals/${signal.id}`, signal);
    const opened = await openStrategyPosition("test-owner", signal.id, baseline.plan!.leverage, "technical-open-test");
    expect(opened.status).toBe("OPEN");
    expect(D(opened.plannedRisk).lte(5)).toBe(true);
    expect(D(opened.initialMargin).lte(100)).toBe(true);
    expect(opened.sourceSignalId).toBe(signal.id);
  });
  it("previews read-only, commits once per key, closes and reconciles collateral", async () => {
    const input = { symbol: "BTCUSDT", side: "LONG" } as const;
    await previewManualPosition("test-owner", input);
    expect(state.docs.size).toBe(1);
    const opened = await openManualPosition("test-owner", input, "manual-open-test");
    expect(opened.status).toBe("OPEN");
    expect(opened.strategyVersion).toBe("manual-experiment-v2");
    const afterOpen = structuredClone(state.docs);
    expect(await openManualPosition("test-owner", input, "manual-open-test")).toEqual(opened);
    expect(state.docs).toEqual(afterOpen);
    await expect(openManualPosition("test-owner", { ...input, side: "SHORT" }, "manual-open-test")).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(openManualPosition("test-owner", input, "manual-open-again")).rejects.toThrow("SYMBOL_POSITION_EXISTS");
    const closed = await closePosition("test-owner", opened.id, "manual-close-test");
    expect(closed.status).toBe("CLOSED");
    const account = state.docs.get(accountPath) as PaperAccount;
    expect(account.symbolPositionMap).toEqual({});
    expect(D(account.availableCollateral).toFixed()).toBe(D(1000).add(closed.netPnl).toFixed());
    const beforeRetry = structuredClone(state.docs);
    expect(await closePosition("test-owner", opened.id, "manual-close-test")).toEqual(closed);
    expect(state.docs).toEqual(beforeRetry);
    expect([...state.docs.keys()].filter(path => path.includes("/journal/"))).toHaveLength(2);
  });
});
