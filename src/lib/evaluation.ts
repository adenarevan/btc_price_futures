import { z } from "zod";
import { SUPPORTED_SYMBOLS } from "./domain";
import { D, sum, max } from "./decimal";
const decimal = z.string().refine((v) => {
  try {
    return D(v).isFinite();
  } catch {
    return false;
  }
});
const versions = z
  .object({
    strategy: z.string().min(1),
    risk: z.string().min(1),
    prompt: z.string().min(1),
    model: z.string().min(1),
    cost: z.string().min(1),
    execution: z.string().min(1),
  })
  .strict();
const trade = z
  .object({
    id: z.string().min(1),
    symbol: z.enum(SUPPORTED_SYMBOLS),
    side: z.enum(["LONG", "SHORT"]),
    qty: decimal,
    entry: decimal,
    exit: decimal,
    entryFee: decimal,
    exitFee: decimal,
    funding: decimal,
    openedAt: z.number().int(),
    closedAt: z.number().int(),
    fundingFinal: z.boolean(),
    validityFlags: z.array(z.string()),
    versionHash: z.string().min(1),
  })
  .strict();
const cost = z
  .object({
    kind: z.enum(["AI", "CLOUD", "DATA"]),
    amount: decimal.nullable(),
    currency: z.string().min(1),
    rateToUsdt: decimal.nullable(),
    rateSource: z.string(),
    rateAt: z.number().nullable(),
    allocationMethod: z.string().min(1),
    basis: z.enum(["ACTUAL", "ESTIMATE"]),
  })
  .strict();
export const armSchema = z
  .object({
    kind: z.enum(["BASELINE_HOLDOUT", "BASELINE_FORWARD", "AGENT_FORWARD"]),
    from: z.number().int(),
    to: z.number().int(),
    cutoff: z.number().int(),
    frozenAt: z.number().int(),
    versions,
    versionHash: z.string().min(1),
    datasetHash: z.string().regex(/^[a-f0-9]{64}$/),
    recordedAt: z.number().int(),
    demo: z.boolean(),
    materialGaps: z.boolean(),
    ledgerReconciled: z.boolean(),
    openPositions: z.number().int().nonnegative(),
    trades: z.array(trade),
    costs: z.array(cost),
    equity: z.array(
      z.object({ at: z.number().int(), value: decimal }).strict(),
    ),
    adverseSlippage2xNetPnl: decimal.nullable(),
    sensitivityEvidenceHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict();
export const evaluationSchema = z
  .object({
    id: z.string().regex(/^[\w-]{1,128}$/),
    arms: z.array(armSchema).max(3),
  })
  .strict();
export type EvaluationArm = z.infer<typeof armSchema>;
export function metrics(arm: EvaluationArm) {
  const pnl = arm.trades.map((t) =>
    D(t.qty)
      .mul(D(t.exit).sub(t.entry))
      .mul(t.side === "LONG" ? 1 : -1)
      .sub(t.entryFee)
      .sub(t.exitFee)
      .add(t.funding),
  );
  const net = sum(pnl),
    wins = sum(pnl.filter((v) => v.gt(0))),
    losses = sum(pnl.filter((v) => v.lt(0))).abs();
  let high = D(0),
    drawdown = D(0);
  for (const e of arm.equity) {
    high = max(high, e.value);
    if (high.gt(0)) drawdown = max(drawdown, high.sub(e.value).div(high));
  }
  const costsKnown =
    ["AI", "CLOUD", "DATA"].every((k) => arm.costs.some((c) => c.kind === k)) &&
    arm.costs.every(
      (c) =>
        c.amount !== null &&
        D(c.amount).gte(0) &&
        (c.currency === "USDT" ||
          (c.rateToUsdt !== null &&
            D(c.rateToUsdt).gt(0) &&
            c.rateSource.length > 0 &&
            c.rateAt !== null)),
    );
  const appCost = costsKnown
    ? sum(
        arm.costs.map((c) =>
          D(c.amount!).mul(c.currency === "USDT" ? 1 : c.rateToUsdt!),
        ),
      )
    : null;
  return {
    netTradingPnl: net.toFixed(),
    applicationCostUsdt: appCost?.toFixed() ?? null,
    netEconomicPnl: appCost ? net.sub(appCost).toFixed() : null,
    profitFactor: losses.gt(0) ? wins.div(losses).toFixed() : null,
    maxDrawdown: drawdown.toFixed(),
    closedPositions: pnl.length,
    durationDays: (arm.to - arm.from) / 86400000,
  };
}
export function evaluateReport(input: unknown) {
  const report = evaluationSchema.parse(input),
    results = report.arms.map((arm) => ({ kind: arm.kind, ...metrics(arm) }));
  if (report.arms.length === 0)
    return {
      ...report,
      metrics: results,
      status: "NOT_TESTED",
      reasons: ["NO_EXPERIMENT"],
      agentValue: "INCONCLUSIVE",
    };
  const reasons: string[] = [];
  for (const kind of ["BASELINE_HOLDOUT", "BASELINE_FORWARD", "AGENT_FORWARD"])
    if (report.arms.filter((a) => a.kind === kind).length !== 1)
      reasons.push(`MISSING_OR_DUPLICATE_${kind}`);
  for (const arm of report.arms) {
    const m = metrics(arm),
      holdout = arm.kind === "BASELINE_HOLDOUT";
    if (
      arm.demo ||
      arm.materialGaps ||
      !arm.ledgerReconciled ||
      arm.openPositions ||
      arm.trades.some((t) => !t.fundingFinal)
    )
      reasons.push(`${arm.kind}:INCOMPLETE_DATA`);
    if (
      m.durationDays < (holdout ? 180 : 60) ||
      m.closedPositions < (holdout ? 100 : 30) ||
      m.profitFactor === null ||
      m.netEconomicPnl === null ||
      arm.adverseSlippage2xNetPnl === null ||
      !arm.sensitivityEvidenceHash
    )
      reasons.push(`${arm.kind}:INSUFFICIENT_SAMPLE_OR_COST`);
    if (
      arm.frozenAt > arm.from ||
      arm.cutoff !== arm.to ||
      arm.to <= arm.from ||
      arm.recordedAt < arm.to ||
      arm.trades.some(
        (t) =>
          t.versionHash !== arm.versionHash ||
          t.openedAt < arm.from ||
          t.closedAt > arm.to ||
          t.closedAt < t.openedAt ||
          D(t.qty).lte(0) ||
          D(t.entry).lte(0) ||
          D(t.exit).lte(0) ||
          D(t.entryFee).lt(0) ||
          D(t.exitFee).lt(0),
      )
    )
      reasons.push(`${arm.kind}:INVALID_PROVENANCE`);
    if (
      new Set(arm.trades.map((t) => t.id)).size !== arm.trades.length ||
      arm.equity.length < 2 ||
      arm.equity[0]?.at !== arm.from ||
      arm.equity.at(-1)?.at !== arm.to ||
      arm.equity.some((e, i) => i > 0 && e.at <= arm.equity[i - 1]!.at)
    )
      reasons.push(`${arm.kind}:INVALID_SERIES`);
  }
  const baseline = report.arms.find((a) => a.kind === "BASELINE_FORWARD"),
    agent = report.arms.find((a) => a.kind === "AGENT_FORWARD");
  if (
    baseline &&
    agent &&
    (baseline.from !== agent.from ||
      baseline.to !== agent.to ||
      JSON.stringify(baseline.versions) !== JSON.stringify(agent.versions))
  )
    reasons.push("FORWARD_ARMS_NOT_COMPARABLE");
  if (reasons.length)
    return {
      ...report,
      metrics: results,
      status: "INSUFFICIENT_DATA",
      reasons,
      agentValue: "INCONCLUSIVE",
    };
  for (const arm of report.arms.filter((a) => a.kind !== "BASELINE_FORWARD")) {
    const m = metrics(arm);
    if (
      D(m.netTradingPnl).lte(0) ||
      D(m.netEconomicPnl!).lte(0) ||
      D(m.profitFactor!).lt("1.2") ||
      D(m.maxDrawdown).gt(".1") ||
      D(arm.adverseSlippage2xNetPnl!).lte(0)
    )
      reasons.push(`${arm.kind}:ECONOMIC_GATE_FAILED`);
  }
  const b = baseline ? metrics(baseline) : null,
    a = agent ? metrics(agent) : null;
  const agentValue =
    a && b && a.netEconomicPnl !== null && b.netEconomicPnl !== null
      ? D(a.netEconomicPnl).gt(b.netEconomicPnl) &&
        D(a.maxDrawdown).lte(b.maxDrawdown)
        ? "SUPPORTED"
        : "NOT_SUPPORTED"
      : "INCONCLUSIVE";
  return {
    ...report,
    metrics: results,
    status: reasons.length ? "FAILED" : "PASSED_RESEARCH_GATE",
    reasons,
    agentValue,
  };
}
