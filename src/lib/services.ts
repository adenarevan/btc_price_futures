import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { getDb } from "./firebase/admin";
import { aiKeyPresent, getConfig } from "./config";
import { AppError, safeError } from "./errors";
import { D } from "./decimal";
import { STRATEGY_VERSION } from "./domain";
import { sendSignalEmail } from "./email-alerts";
import {
  accountSummary,
  check,
  createManualPlan,
  evaluateBaseline,
  revalidatePlan,
} from "./engine";
import { marketSnapshot, fetchFunding, symbolSchema } from "./market";
import { reviewCandidate } from "./agent";
import { signalMode, decideSignal, entryApproved } from "./signal-policy";
import * as repo from "./repository";
import * as ledger from "./portfolio/ledger";
import type {
  AccountContext,
  LedgerEntry,
  MarketSnapshot,
  PaperAccount,
  Position,
  Signal,
  Side,
  SymbolName,
  TradingSettings,
} from "./domain";
export { settings as getSettings } from "./repository";
type PendingWrite = {
  collection: string;
  id: string;
  value: object;
  create?: boolean;
};
export const listSignals = (
  uid: string,
  opts: Parameters<typeof repo.page>[3] = {},
) => repo.page<Signal>(uid, "signals", "createdAt", opts);
export const listPositions = (
  uid: string,
  opts: Parameters<typeof repo.page>[3] = {},
) => repo.page<Position>(uid, "positions", "openedAt", opts);
export const listRuns = (
  uid: string,
  opts: Parameters<typeof repo.page>[3] = {},
) => repo.page<Record<string, unknown>>(uid, "runs", "startedAt", opts);
export const listEvaluations = (uid: string) =>
  repo.page<Record<string, unknown>>(uid, "evaluations", "createdAt");
export const getJournal = (
  uid: string,
  opts: Parameters<typeof repo.page>[3] = {},
) => repo.page<Record<string, unknown>>(uid, "journal", "createdAt", opts);
export async function owned<T>(uid: string, collection: string, id: string) {
  check(/^[\w-]{1,128}$/.test(id), "INPUT_INVALID");
  const result = await repo.read<T & { accountId: string }>(
    repo.path(uid, collection, id),
  );
  if (!result || result.accountId !== "paper-futures-v1")
    throw new AppError("NOT_FOUND", 404);
  return result;
}
export const getSignal = (uid: string, id: string) =>
  owned<Signal>(uid, "signals", id);
export const getEvaluation = (uid: string, id: string) =>
  owned<Record<string, unknown>>(uid, "evaluations", id);
export async function readDashboard(uid: string) {
  const [ctx, signals, cfg] = await Promise.all([
    repo.context(uid),
    listSignals(uid),
    repo.settings(uid),
  ]);
  const usage = await repo.read<Record<string, unknown>>(
    repo.path(uid, "usage", new Date().toISOString().slice(0, 10)),
  );
  return {
    ...ctx,
    summary: accountSummary(ctx.account, ctx.positions),
    signals: signals.items,
    settings: cfg,
    usage: usage ?? { reserved: 0 },
    demo: getConfig().demo,
    aiReady: cfg.aiEnabled && getConfig().AI_ENABLED === "true" && aiKeyPresent(),
    signalMode: signalMode(cfg.aiEnabled, getConfig().AI_ENABLED),
  };
}
function ledgerWrites(entries: LedgerEntry[]): PendingWrite[] {
  return entries.map((e) => ({
    collection: "ledger",
    id: e.id,
    value: e,
    create: true,
  }));
}
async function mutate<T>(
  uid: string,
  operation: string,
  key: string,
  payload: unknown,
  run: (
    ctx: AccountContext,
    deadline: number,
    writes: PendingWrite[],
  ) => Promise<T>,
): Promise<T> {
  check(/^[\w-]{8,128}$/.test(key), "INPUT_INVALID");
  const requestPath = repo.path(uid, "requests", ledger.hash(key)),
    requestHash = ledger.hash([operation, payload]);
  const previous = await repo.read<{ requestHash: string; result: T }>(
    requestPath,
  );
  if (previous) {
    if (previous.requestHash !== requestHash)
      throw new AppError("IDEMPOTENCY_CONFLICT", 409);
    return previous.result;
  }
  const lease = await repo.acquire(`${uid}:account`);
  try {
    const again = await repo.read<{ requestHash: string; result: T }>(
      requestPath,
    );
    if (again) {
      if (again.requestHash !== requestHash)
        throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return again.result;
    }
    const ctx = await repo.context(uid),
      version = ctx.account.accountVersion,
      writes: PendingWrite[] = [];
    const result = await run(ctx, Date.now() + 45000, writes);
    await getDb().runTransaction(async (tx) => {
      await repo.assertLease(tx, lease);
      const account = repo.decode<PaperAccount>(
        (
          await tx.get(getDb().doc(repo.path(uid, "accounts", ctx.account.id)))
        ).data(),
      );
      if (account.accountVersion !== version)
        throw new AppError("ACCOUNT_VERSION_CONFLICT", 409, true);
      ctx.account.accountVersion = Math.max(
        ctx.account.accountVersion,
        version + 1,
      );
      ctx.account.updatedAt = Date.now();
      repo.put(tx, repo.path(uid, "accounts", ctx.account.id), ctx.account);
      for (const p of ctx.positions)
        repo.put(tx, repo.path(uid, "positions", p.id), p);
      for (const w of writes)
        repo.put(tx, repo.path(uid, w.collection, w.id), w.value, w.create);
      repo.put(
        tx,
        requestPath,
        { requestHash, result, createdAt: Date.now(), operation },
        true,
      );
      repo.put(
        tx,
        repo.path(uid, "journal", randomUUID()),
        {
          accountId: ctx.account.id,
          operation,
          createdAt: Date.now(),
          positionId: (payload as { positionId?: string })?.positionId ?? null,
        },
        true,
      );
    });
    return result;
  } finally {
    await repo.release(lease);
  }
}
async function reconcile(
  ctx: AccountContext,
  deadline: number,
  writes: PendingWrite[],
  snapshots: Map<SymbolName, MarketSnapshot>,
  autoExit = false,
) {
  for (let i = 0; i < ctx.positions.length; i++) {
    let p = ctx.positions[i]!;
    try {
      let s = snapshots.get(p.symbol);
      if (!s) {
        s = await marketSnapshot(p.symbol, deadline);
        snapshots.set(p.symbol, s);
      }
      const cutoff = p.closedAt ?? Date.now(),
        events = await fetchFunding(
          p.symbol,
          p.fundingCursor,
          cutoff - 1,
          deadline,
        ),
        expected = p.lastDerivatives.nextFundingTime;
      for (const event of events.events) {
        const mutation = ledger.applyFunding({
          account: ctx.account,
          position: p,
          event,
          postedAt: Date.now(),
        });
        ctx.account = mutation.account;
        p = mutation.position;
        writes.push(...ledgerWrites(mutation.ledger));
        const ref = getDb().doc(`fundingEvents/${event.id}`);
        await ref
          .create(repo.encode(event) as Record<string, unknown>)
          .catch((e) => {
            if ((e as { code?: number }).code !== 6) throw e;
          });
      }
      const due = expected >= p.openedAt && expected < cutoff;
      p.fundingComplete =
        events.complete &&
        (!due ||
          events.events.some((e) => e.fundingTime === expected) ||
          p.fundingCursor > expected);
      if (events.events.length) p.fundingCursor = events.nextCursor;
      if (!p.fundingComplete)
        p.validityFlags = [...new Set([...p.validityFlags, "FUNDING_PENDING"])];
      else
        p.validityFlags = p.validityFlags.filter(
          (f) => f !== "FUNDING_PENDING",
        );
      if (p.status === "CLOSED_PENDING_FUNDING" && p.fundingComplete)
        p.status = "CLOSED";
      p = ledger.refreshPosition(p, s, Date.now());
      const quote = D(p.side === "LONG" ? s.quote.bid : s.quote.ask);
      const stopHit = p.side === "LONG" ? quote.lte(p.stop) : quote.gte(p.stop);
      const targetHit = p.side === "LONG" ? quote.gte(p.target) : quote.lte(p.target);
      if (p.status === "OPEN" && (p.marginEstimate.breach || (autoExit && (stopHit || targetHit)))) {
        const mutation = ledger.closePosition({
          account: ctx.account,
          position: p,
          snapshot: s,
          now: Date.now(),
          modelBreach: p.marginEstimate.breach,
        });
        ctx.account = mutation.account;
        p = mutation.position;
        if (autoExit && !p.marginEstimate.breach) {
          p.closeReason = stopHit ? "AUTO_EXIT_STOP" : "AUTO_EXIT_TARGET";
          p.validityFlags = [...new Set([...p.validityFlags, p.closeReason])];
        }
        writes.push(...ledgerWrites(mutation.ledger));
      }
    } catch {
      p.fundingComplete = false;
      p.validityFlags = [
        ...new Set([
          ...p.validityFlags,
          "POSITION_UNVERIFIED",
          "FUNDING_PENDING",
        ]),
      ];
    }
    ctx.positions[i] = p;
  }
}
export async function refreshPositions(uid: string, autoExit = false) {
  return mutate(
    uid,
    autoExit ? "auto-exit" : "refresh",
    randomUUID(),
    {},
    async (ctx, deadline, writes) => {
      await reconcile(ctx, deadline, writes, new Map(), autoExit);
      return {
        positions: ctx.positions,
        summary: accountSummary(ctx.account, ctx.positions),
      };
    },
  );
}
export async function openPosition(
  uid: string,
  signalId: string,
  leverage: number,
  key: string,
) {
  return mutate(
    uid,
    "open",
    key,
    { signalId, leverage },
    async (ctx, deadline, writes) => {
      const [signal, cfg] = await Promise.all([
        getSignal(uid, signalId),
        repo.settings(uid),
      ]);
      if (!entryApproved(signal, signalMode(cfg.aiEnabled, getConfig().AI_ENABLED)))
        throw new AppError("SIGNAL_NOT_APPROVED", 409);
      const snapshots = new Map<SymbolName, MarketSnapshot>();
      await reconcile(ctx, deadline, writes, snapshots);
      const s = await marketSnapshot(signal.symbol, deadline);
      const plan = revalidatePlan(signal, s, cfg, ctx, leverage),
        mutation = ledger.openPosition({
          account: ctx.account,
          positions: ctx.positions,
          signal,
          plan,
          positionId: randomUUID(),
          snapshot: s,
          now: Date.now(),
        });
      ctx.account = mutation.account;
      ctx.positions.push(mutation.position);
      writes.push(...ledgerWrites(mutation.ledger), {
        collection: "signals",
        id: signal.id,
        value: mutation.signal,
      });
      return mutation.position;
    },
  );
}
export async function openManualPosition(
  uid: string,
  input: { symbol: SymbolName; side: Side },
  key: string,
) {
  symbolSchema.parse(input.symbol);
  return mutate(
    uid,
    "manual-open",
    key,
    input,
    async (ctx, deadline, writes) => {
      const cfg = await repo.settings(uid);
      const snapshots = new Map<SymbolName, MarketSnapshot>();
      await reconcile(ctx, deadline, writes, snapshots);
      const snapshot = await marketSnapshot(input.symbol, deadline);
      const plan = createManualPlan({
        snapshot,
        side: input.side,
        settings: cfg,
        context: ctx,
      });
      const signal: Signal = {
        id: randomUUID(),
        accountId: ctx.account.id,
        instrumentKey: snapshot.instrumentKey,
        symbol: input.symbol,
        side: input.side,
        decision:
          input.side === "LONG" ? "LONG_CANDIDATE" : "SHORT_CANDIDATE",
        snapshotId: snapshot.id,
        candleEndAt: snapshot.serverTime,
        expiresAt: snapshot.serverTime + 300000,
        createdAt: Date.now(),
        plan,
        consumedPositionId: null,
        baseline: {
          decision:
            input.side === "LONG" ? "LONG_CANDIDATE" : "SHORT_CANDIDATE",
          side: input.side,
          reasons: ["MANUAL_EXPERIMENT"],
          evidence: {
            "manual.mode": {
              value: true,
              description: "Dibuat pengguna untuk latihan paper trading",
            },
          },
          plan,
          candleEndAt: snapshot.serverTime,
          expiresAt: snapshot.serverTime + 300000,
        },
        reviewStatus: "MANUAL_EXPERIMENT",
        strategyVersion: plan.strategyVersion,
        settingsVersion: cfg.version,
      };
      const mutation = ledger.openPosition({
        account: ctx.account,
        positions: ctx.positions,
        signal,
        plan: signal.plan!,
        positionId: randomUUID(),
        snapshot,
        now: Date.now(),
      });
      ctx.account = mutation.account;
      ctx.positions.push(mutation.position);
      writes.push(
        ...ledgerWrites(mutation.ledger),
        { collection: "signals", id: signal.id, value: mutation.signal, create: true },
      );
      await getDb().doc(`snapshots/${snapshot.id}`).set(
        repo.encode(snapshot) as Record<string, unknown>,
        { merge: true },
      );
      return mutation.position;
    },
  );
}
// Preview reads current account and market data without creating ledger entries.
export async function previewManualPosition(uid: string, input: { symbol: SymbolName; side: Side }) {
  const [settings, context, snapshot] = await Promise.all([
    repo.settings(uid), repo.context(uid), marketSnapshot(input.symbol, Date.now() + 45000),
  ]);
  return { plan: createManualPlan({ snapshot, side: input.side, settings, context }), checkedAt: Date.now() };
}
export async function closePosition(
  uid: string,
  positionId: string,
  key: string,
) {
  return mutate(
    uid,
    "close",
    key,
    { positionId },
    async (ctx, deadline, writes) => {
      const old = ctx.positions.find((p) => p.id === positionId);
      if (!old || old.status !== "OPEN")
        throw new AppError("POSITION_ALREADY_CLOSED", 409);
      const snapshots = new Map<SymbolName, MarketSnapshot>();
      await reconcile(ctx, deadline, writes, snapshots);
      const p = ctx.positions.find((p) => p.id === positionId)!;
      if (p.status === "LIQUIDATED_SIM") return p;
      // Closing is allowed with a fresh executable quote even when reconcile
      // could not fetch funding history. The ledger preserves the pending
      // settlement state and reconcile finalizes it later.
      const s = await marketSnapshot(p.symbol, deadline, {
          includeFunding: false,
        }),
        mutation = ledger.closePosition({
          account: ctx.account,
          position: p,
          snapshot: s,
          now: Date.now(),
        });
      ctx.account = mutation.account;
      ctx.positions[ctx.positions.findIndex((x) => x.id === positionId)] =
        mutation.position;
      writes.push(...ledgerWrites(mutation.ledger));
      return mutation.position;
    },
  );
}
export async function analyze(uid: string, symbol: SymbolName) {
  symbolSchema.parse(symbol);
  const lease = await repo.acquire(`${uid}:scan:${symbol}`),
    runId = randomUUID(),
    startedAt = Date.now();
  const runRef = getDb().doc(repo.path(uid, "runs", runId));
  await runRef.create(
    repo.encode({
      id: runId,
      accountId: "paper-futures-v1",
      symbol,
      startedAt,
      state: "IN_PROGRESS",
    }) as Record<string, unknown>,
  );
  try {
    const [ctx, cfg, s] = await Promise.all([
      repo.context(uid),
      repo.settings(uid),
      marketSnapshot(symbol, startedAt + 45000),
    ]);
    const mode = signalMode(cfg.aiEnabled, getConfig().AI_ENABLED);
    const baseline = evaluateBaseline(s, cfg, ctx),
      id = ledger.hash([
        uid,
        ctx.account.id,
        s.instrumentKey,
        baseline.side,
        baseline.candleEndAt,
        STRATEGY_VERSION,
        cfg.version,
        "confirmation-v2",
        mode,
        mode === "AI" ? [getConfig().AI_PROVIDER, getConfig().AI_PROVIDER === "oao" ? getConfig().OAO_MODEL : getConfig().OPENAI_MODEL] : null,
      ]);
    const existing = await repo.read<Signal>(repo.path(uid, "signals", id));
    if (existing) {
      await runRef.update({
        state: "COMPLETED",
        endedAt: FieldValue.serverTimestamp(),
        signalId: existing.id,
        reused: true,
      });
      await sendSignalEmail(uid, existing);
      return existing;
    }
    let review: Awaited<ReturnType<typeof reviewCandidate>> = {
      review: null,
      reviewStatus: mode === "TECHNICAL" && baseline.decision !== "WAIT" ? "TECHNICAL_CONFIRMED" : "NOT_REQUESTED",
      inputTokens: 0,
      outputTokens: 0,
    };
    if (
      mode === "AI" &&
      aiKeyPresent() &&
      baseline.decision !== "WAIT"
    ) {
      let reserved = false;
      try { await repo.reserveQuota(uid, cfg.dailyAiReviewLimit); reserved = true; }
      catch (error) {
        if (!(error instanceof AppError) || error.code !== "AI_QUOTA") throw error;
        review.reviewStatus = "QUOTA_EXHAUSTED";
      }
      if (reserved) {
      review = await reviewCandidate(baseline, s, startedAt + 45000);
      await getDb()
        .doc(repo.path(uid, "usage", new Date().toISOString().slice(0, 10)))
        .set(
          {
            inputTokens: FieldValue.increment(review.inputTokens),
            outputTokens: FieldValue.increment(review.outputTokens),
          },
          { merge: true },
        );
      }
    }
    const signal: Signal = {
      id,
      accountId: ctx.account.id,
      instrumentKey: s.instrumentKey,
      symbol,
      side: baseline.side,
      decision:
        decideSignal(baseline, mode, review.review?.verdict),
      snapshotId: s.id,
      candleEndAt: baseline.candleEndAt ?? s.serverTime,
      expiresAt: baseline.expiresAt ?? s.serverTime,
      createdAt: Date.now(),
      plan: baseline.plan,
      consumedPositionId: null,
      baseline,
      review: review.review,
      reviewStatus: review.reviewStatus,
      reviewProvider: mode === "AI" ? getConfig().AI_PROVIDER : "none",
      reviewModel: mode === "AI" ? (getConfig().AI_PROVIDER === "oao" ? getConfig().OAO_MODEL : getConfig().OPENAI_MODEL) : null,
      strategyVersion: STRATEGY_VERSION,
      settingsVersion: cfg.version,
    };
    if (Date.now() >= signal.expiresAt) signal.decision = "WAIT";
    check(Buffer.byteLength(JSON.stringify(s)) <= 400000, "DATA_INVALID");
    await getDb().runTransaction(async (tx) => {
      await repo.assertLease(tx, lease);
      const current = repo.decode<PaperAccount>(
        (
          await tx.get(getDb().doc(repo.path(uid, "accounts", ctx.account.id)))
        ).data(),
      );
      if (current.accountVersion !== ctx.account.accountVersion) {
        signal.decision = "WAIT";
        signal.reviewStatus = "ACCOUNT_CHANGED";
      }
      repo.put(tx, `snapshots/${s.id}`, s);
      repo.put(tx, repo.path(uid, "signals", id), signal, true);
      tx.update(runRef, {
        state: "COMPLETED",
        endedAt: FieldValue.serverTimestamp(),
        signalId: id,
      });
    });
    await sendSignalEmail(uid, signal);
    return signal;
  } catch (error) {
    await runRef.update({
      state: "FAILED",
      error: safeError(error).code,
      endedAt: FieldValue.serverTimestamp(),
    });
    throw error;
  } finally {
    await repo.release(lease);
  }
}
const fraction = (cap: number, positive = false) =>
  z.string().refine((v) => {
    try {
      return D(v).gte(positive ? "0.000000001" : 0) && D(v).lte(cap);
    } catch {
      return false;
    }
  });
export const settingsSchema = z
  .object({
    defaultLeverage: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(5)])
      .optional(),
    feeRate: fraction(0.02).optional(),
    slippageRate: fraction(0.01).optional(),
    riskPerPosition: fraction(0.005, true).optional(),
    maxTotalRisk: fraction(0.01, true).optional(),
    marginPerPosition: fraction(0.1, true).optional(),
    maxTotalMargin: fraction(0.2, true).optional(),
    maxGrossNotional: fraction(1, true).optional(),
    initialCapital: z
      .string()
      .refine((v) => {
        try {
          return D(v).gt(0) && D(v).lte("10000000");
        } catch {
          return false;
        }
      })
      .optional(),
    aiEnabled: z.boolean().optional(),
    dailyAiReviewLimit: z.number().int().min(1).max(12).optional(),
  })
  .strict();
export async function updateSettings(uid: string, input: unknown) {
  const changes = settingsSchema.parse(input);
  return mutate(
    uid,
    "settings",
    randomUUID(),
    changes,
    async (ctx, _deadline, writes) => {
      const clean = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
      );
      const cfg: TradingSettings = {
        ...(await repo.settings(uid)),
        ...clean,
        version: randomUUID(),
        costVersion: randomUUID(),
        riskVersion: randomUUID(),
      };
      check(
        D(cfg.maxTotalRisk).gte(cfg.riskPerPosition) &&
          D(cfg.maxTotalMargin).gte(cfg.marginPerPosition),
        "INPUT_INVALID",
      );
      if (changes.initialCapital) {
        check(ctx.account.transactionCount === 0, "RISK_REJECTED");
        ctx.account.initialCapital = changes.initialCapital;
        ctx.account.availableCollateral = changes.initialCapital;
      }
      writes.push({ collection: "settings", id: "trading", value: cfg });
      return cfg;
    },
  );
}
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r]/.test(text) && !/^[-+]?\d+(\.\d+)?$/.test(text))
    text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export async function exportJournal(uid: string, from: number, to: number) {
  check(
    Number.isFinite(from) &&
      Number.isFinite(to) &&
      to > from &&
      to - from <= 90 * 86400000,
    "INPUT_INVALID",
  );
  const docs = await getDb()
    .collection(`users/${uid}/positions`)
    .where("accountId", "==", "paper-futures-v1")
    .where("openedAt", ">=", repo.encode(from, "openedAt"))
    .where("openedAt", "<=", repo.encode(to, "openedAt"))
    .limit(2001)
    .get();
  check(docs.size <= 2000, "EXPORT_TOO_LARGE");
  const fields = [
    "id",
    "symbol",
    "side",
    "status",
    "qty",
    "entry",
    "exit",
    "initialMargin",
    "leverage",
    "entryFee",
    "exitFee",
    "fundingNet",
    "grossPnl",
    "netPnl",
    "roe",
    "fundingComplete",
    "validityFlags",
    "costVersion",
    "riskVersion",
    "strategyVersion",
  ];
  return [
    fields.join(","),
    ...docs.docs.map((d) => {
      const p = repo.decode<Record<string, unknown>>(d.data());
      return fields.map((f) => csvCell(p[f])).join(",");
    }),
  ].join("\r\n");
}
