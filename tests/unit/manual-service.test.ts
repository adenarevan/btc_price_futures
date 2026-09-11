import { beforeEach, describe, expect, it, vi } from "vitest";
import { snapshot } from "../../fixtures/market";
import { DEFAULT_SETTINGS, newAccount } from "../../src/lib/engine";
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
import { openManualPosition, closePosition, previewManualPosition } from "../../src/lib/services";

beforeEach(() => {
  state.docs.clear();
  state.docs.set(accountPath, newAccount());
  state.market.mockReset();
  state.market.mockImplementation(async () => snapshot());
});
describe("manual service lifecycle with isolated persistence", () => {
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
