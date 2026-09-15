import { D, positive, min, max, sum, floorToStep, ceilToStep } from "./decimal";
import {
  DEFAULT_SETTINGS,
  EngineError,
  MARGIN_MODEL,
  STRATEGY_VERSION,
  type AccountContext,
  type AccountSummary,
  type BaselineResult,
  type Candle,
  type MarginEstimate,
  type MarketSnapshot,
  type PaperAccount,
  type Position,
  type Side,
  type Signal,
  type TradePlan,
  type TradingSettings,
} from "./domain";

export function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new EngineError(code);
}
export const multiplier = (side: Side) => (side === "LONG" ? 1 : -1);
export function newAccount(now = Date.now()): PaperAccount {
  return {
    id: "paper-futures-v1",
    schemaVersion: 2,
    initialCapital: "1000",
    availableCollateral: "1000",
    modelDeficit: "0",
    accountVersion: 0,
    status: "ACTIVE",
    symbolPositionMap: {},
    consumedSignalIds: [],
    transactionCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}
export function ema(values: string[], period: number): string {
  check(period > 0 && values.length >= period, "DATA_INVALID");
  let result = sum(values.slice(0, period)).div(period);
  const alpha = D(2).div(period + 1);
  for (const value of values.slice(period))
    result = D(value)
      .mul(alpha)
      .add(result.mul(D(1).sub(alpha)));
  return result.toFixed();
}
export function atr(candles: Candle[], period = 14): string {
  check(candles.length >= period, "DATA_INVALID");
  const ranges = candles.map((c, i) =>
    max(
      D(c.high).sub(c.low),
      i
        ? D(c.high)
            .sub(candles[i - 1]!.close)
            .abs()
        : 0,
      i
        ? D(c.low)
            .sub(candles[i - 1]!.close)
            .abs()
        : 0,
    ),
  );
  let result = sum(ranges.slice(0, period)).div(period);
  for (const range of ranges.slice(period))
    result = result
      .mul(period - 1)
      .add(range)
      .div(period);
  return positive(result).toFixed();
}
export function validateCandles(
  candles: Candle[],
  count: number,
  interval: number,
  cutoff: number,
) {
  check(candles.length >= count, "DATA_INVALID");
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    check(
      c.endAt <= cutoff &&
        c.endAt - c.openAt === interval &&
        c.openAt % interval === 0,
      "DATA_INVALID",
    );
    check(!i || candles[i - 1]!.endAt === c.openAt, "DATA_INVALID");
    check(
      positive(c.high).gte(max(c.open, c.close, c.low)) &&
        positive(c.low).lte(min(c.open, c.close, c.high)) &&
        D(c.volume).gte(0),
      "DATA_INVALID",
    );
  }
}
export function validatePrices(snapshot: MarketSnapshot, now = Date.now()) {
  const { quote: q, derivatives: m, metadata } = snapshot;
  check(
    Math.abs(snapshot.serverTime - snapshot.fetchedAt) <= 5000,
    "DATA_STALE",
  );
  for (const item of [q, m])
    check(
      Number.isFinite(item.providerAt) &&
        Number.isFinite(item.fetchedAt) &&
        now - item.fetchedAt <= 10000 &&
        item.fetchedAt <= now + 5000 &&
        Math.abs(snapshot.serverTime - item.providerAt) <= 15000,
      "DATA_STALE",
    );
  check(positive(q.ask).gte(positive(q.bid)), "DATA_INVALID");
  positive(m.markPrice);
  positive(m.indexPrice);
  check(
    metadata.status === "TRADING" &&
      metadata.contractType === "PERPETUAL" &&
      metadata.quoteAsset === "USDT" &&
      metadata.marginAsset === "USDT",
    "UNSUPPORTED_CONTRACT",
  );
  check(!metadata.unsupportedFilters?.length, "UNSUPPORTED_FILTER");
  check(now - metadata.fetchedAt <= 3600000, "DATA_STALE");
  positive(metadata.tickSize);
  positive(metadata.stepSize);
  positive(metadata.maxQty);
}
export function marginEstimate(
  side: Side,
  qty: string,
  entry: string,
  collateral: string,
  mark: string,
  maintenance = "0.01",
  fee = "0.0006",
): MarginEstimate {
  const q = positive(qty),
    e = positive(entry),
    p = positive(mark),
    b = D(collateral),
    d = multiplier(side),
    rate = D(maintenance).add(fee);
  check(
    D(maintenance).gte(0) && D(fee).gte(0) && rate.lt(1),
    "MARGIN_BUFFER_REJECTED",
  );
  const balance = b.add(q.mul(p.sub(e)).mul(d));
  const liq =
    side === "LONG"
      ? q
          .mul(e)
          .sub(b)
          .div(q.mul(D(1).sub(rate)))
      : q
          .mul(e)
          .add(b)
          .div(q.mul(D(1).add(rate)));
  const reserve = q.mul(p).mul(rate),
    ratio = balance.gt(0) ? reserve.div(balance) : null;
  return {
    model: MARGIN_MODEL,
    maintenanceRate: maintenance,
    status:
      side === "LONG" && liq.lte(0)
        ? "NO_POSITIVE_THRESHOLD_IN_MODEL"
        : liq.gt(0)
          ? "AVAILABLE"
          : "UNAVAILABLE",
    liqApprox: liq.gt(0) ? liq.toFixed() : null,
    marginBalance: balance.toFixed(),
    maintenance: q.mul(p).mul(maintenance).toFixed(),
    closeFeeReserve: q.mul(p).mul(fee).toFixed(),
    ratio: ratio?.toFixed() ?? null,
    breach: balance.lte(reserve),
    warning: !ratio || ratio.gte("0.8"),
  };
}
export function accountSummary(
  account: PaperAccount,
  positions: Position[],
): AccountSummary {
  const open = positions.filter((p) => p.status === "OPEN");
  const collateral = sum(open.map((p) => p.collateral));
  const pnl = sum(
    open.map((p) =>
      D(p.lastMark).sub(p.entry).mul(p.qty).mul(multiplier(p.side)),
    ),
  );
  const wallet = D(account.availableCollateral).add(collateral),
    equity = wallet.add(pnl).sub(account.modelDeficit);
  const exitCosts = sum(
    open.map((p) =>
      D(p.qty).mul(p.lastMark).mul(D(p.feeRate).add(p.slippageRate)),
    ),
  );
  return {
    availableCollateral: account.availableCollateral,
    openCollateral: collateral.toFixed(),
    initialMarginLocked: sum(open.map((p) => p.initialMargin)).toFixed(),
    walletBalance: wallet.toFixed(),
    paperEquity: equity.toFixed(),
    markGrossPnl: pnl.toFixed(),
    grossExposure: sum(open.map((p) => D(p.qty).mul(p.lastMark))).toFixed(),
    modelDeficit: account.modelDeficit,
    netExitEquityEstimate: equity.sub(exitCosts).toFixed(),
    openPlannedRisk: sum(
      open.map((p) => max(p.plannedRisk, p.currentPlannedRisk)),
    ).toFixed(),
    positionsCount: open.length,
  };
}
export function createPlan(input: {
  snapshot: MarketSnapshot;
  side: Side;
  atr: string;
  triggerClose: string;
  settings: TradingSettings;
  context: AccountContext;
  stop?: string;
  target?: string;
  // Manual practice can target 2R after costs; baseline keeps its PRD price target.
  targetNetRR?: 2;
}): TradePlan {
  const { snapshot: s, side, settings: cfg, context } = input;
  validatePrices(s);
  check([1, 2, 3, 5].includes(cfg.defaultLeverage), "INVALID_LEVERAGE");
  const summary = accountSummary(context.account, context.positions),
    equity = positive(summary.paperEquity),
    a = positive(input.atr),
    c = positive(input.triggerClose),
    d = multiplier(side);
  check(
    context.account.status === "ACTIVE" &&
      D(context.account.modelDeficit).isZero(),
    "ACCOUNT_REVIEW_REQUIRED",
  );
  check(summary.positionsCount < 2, "POSITION_LIMIT_REACHED");
  check(!context.positions.some((p) => p.status === "OPEN" && p.symbol === s.symbol), "SYMBOL_POSITION_EXISTS");
  check(
    context.positions.every((p) => p.fundingComplete),
    "FUNDING_PENDING",
  );
  check(context.positions.every((p) => p.status !== "OPEN" || Date.now() - p.lastRiskCheckAt <= 10000), "POSITION_DATA_STALE");
  check(s.fundingState.complete, "FUNDING_PENDING");
  check(
    s.derivatives.nextFundingTime - s.serverTime > 300000,
    "FUNDING_COST_RISK",
  );
  if (s.fundingState.lastExpectedFundingTime !== null)
    check(
      s.fundingState.lastConfirmedFundingTime !== null &&
        s.fundingState.lastConfirmedFundingTime >=
          s.fundingState.lastExpectedFundingTime &&
        s.serverTime - s.fundingState.lastExpectedFundingTime >= 60000,
      "FUNDING_PENDING",
    );
  const fee = D(cfg.feeRate),
    slip = D(cfg.slippageRate),
    entry = D(side === "LONG" ? s.quote.ask : s.quote.bid).mul(
      D(1).add(slip.mul(d)),
    );
  const round = side === "LONG" ? floorToStep : ceilToStep;
  const stop = input.stop
    ? D(input.stop)
    : round(c.sub(a.mul("1.5").mul(d)), s.metadata.tickSize);
  check(stop.gt(0) && (side === "LONG" ? stop.lt(entry) : stop.gt(entry)), "INVALID_TRADE_LEVELS");
  const h = entry.mul(cfg.fundingReserveRate),
    xs = stop.mul(D(1).sub(slip.mul(d)));
  check(
    D(s.derivatives.indicativeFundingRate).mul(d).mul(entry).lte(h),
    "FUNDING_COST_RISK",
  );
  const r = entry
      .sub(xs)
      .mul(d)
      .add(fee.mul(entry.add(xs)))
      .add(h);
  const target = input.target
    ? D(input.target)
    : input.targetNetRR === 2
      ? (side === "LONG" ? ceilToStep : floorToStep)(
          r.mul(2).add(entry.mul(D(d).add(fee))).add(h)
            .div(D(d).sub(fee).mul(D(1).sub(slip.mul(d)))),
          s.metadata.tickSize,
        )
      : round(entry.add(entry.sub(stop).mul(2)), s.metadata.tickSize);
  check(target.gt(0) && (side === "LONG" ? target.gt(entry) : target.lt(entry)), "INVALID_TRADE_LEVELS");
  const xt = target.mul(D(1).sub(slip.mul(d))),
    g = xt
      .sub(entry)
      .mul(d)
      .sub(fee.mul(entry.add(xt)))
      .sub(h);
  check(r.gt(0) && g.gt(0) && g.div(r).gte("1.5"), "NET_RR_TOO_LOW");
  const remainingRisk = max(
      0,
      equity.mul(cfg.maxTotalRisk).sub(summary.openPlannedRisk),
    ),
    remainingMargin = max(
      0,
      equity.mul(cfg.maxTotalMargin).sub(summary.initialMarginLocked),
    ),
    remainingNotional = max(
      0,
      equity.mul(cfg.maxGrossNotional).sub(summary.grossExposure),
    );
  const qty = floorToStep(
    min(
      min(equity.mul(cfg.riskPerPosition), remainingRisk).div(r),
      min(equity.mul(cfg.marginPerPosition), remainingMargin)
        .mul(cfg.defaultLeverage)
        .div(entry),
      remainingNotional.div(entry),
      D(context.account.availableCollateral).div(
        entry.div(cfg.defaultLeverage).add(entry.mul(fee)).add(h),
      ),
    ),
    s.metadata.stepSize,
  );
  check(
    qty.gt(0) &&
      qty.gte(s.metadata.minQty) &&
      qty.lte(s.metadata.maxQty) &&
      qty.mul(entry).gte(s.metadata.minNotional),
    "POSITION_SIZE_REJECTED",
  );
  const notional = qty.mul(entry),
    margin = notional.div(cfg.defaultLeverage),
    estimate = marginEstimate(
      side,
      qty.toFixed(),
      entry.toFixed(),
      margin.toFixed(),
      s.derivatives.markPrice,
      cfg.maintenanceRate,
      cfg.feeRate,
    );
  check(
    !estimate.breach && estimate.status !== "UNAVAILABLE",
    "MARGIN_BUFFER_REJECTED",
  );
  if (estimate.liqApprox) {
    const liq = D(estimate.liqApprox),
      distance = entry.sub(liq).mul(d),
      stopDistance = entry.sub(stop).mul(d);
    check(
      distance.gt(0) &&
        distance.gte(stopDistance.mul(2)) &&
        stop.sub(liq).mul(d).gte(a.mul("0.5")),
      "MARGIN_BUFFER_REJECTED",
    );
  } else
    check(
      !marginEstimate(
        side,
        qty.toFixed(),
        entry.toFixed(),
        margin.toFixed(),
        stop.toFixed(),
        cfg.maintenanceRate,
        cfg.feeRate,
      ).breach,
      "MARGIN_BUFFER_REJECTED",
    );
  return {
    side,
    entry: entry.toFixed(),
    stop: stop.toFixed(),
    target: target.toFixed(),
    qty: qty.toFixed(),
    leverage: cfg.defaultLeverage,
    notional: notional.toFixed(),
    initialMargin: margin.toFixed(),
    entryFee: notional.mul(fee).toFixed(),
    riskPerUnit: r.toFixed(),
    rewardPerUnit: g.toFixed(),
    netRR: g.div(r).toFixed(),
    plannedRisk: qty.mul(r).toFixed(),
    fundingReserve: qty.mul(h).toFixed(),
    atr: a.toFixed(),
    triggerClose: c.toFixed(),
    marginEstimate: estimate,
    feeRate: cfg.feeRate,
    slippageRate: cfg.slippageRate,
    maintenanceRate: cfg.maintenanceRate,
    costVersion: cfg.costVersion,
    riskVersion: cfg.riskVersion,
    strategyVersion: STRATEGY_VERSION,
  };
}
export function createManualPlan(input: {
  snapshot: MarketSnapshot;
  side: Side;
  settings: TradingSettings;
  context: AccountContext;
}): TradePlan {
  return {
    ...createPlan({ ...input, atr: atr(input.snapshot.candles15m), triggerClose: input.snapshot.derivatives.markPrice, targetNetRR: 2 }),
    strategyVersion: "manual-experiment-v2",
  };
}
export function evaluateBaseline(
  s: MarketSnapshot,
  settings: TradingSettings,
  context: AccountContext,
): BaselineResult {
  const result: BaselineResult = {
    decision: "WAIT",
    side: null,
    reasons: [],
    evidence: {},
    plan: null,
    candleEndAt: null,
    expiresAt: null,
  };
  try {
    validatePrices(s);
    validateCandles(s.candles15m, 100, 900000, s.serverTime - 5000);
    const trigger = s.candles15m.at(-1)!;
    validateCandles(
      s.candles1h,
      500,
      3600000,
      Math.min(trigger.endAt, s.serverTime - 5000),
    );
    result.candleEndAt = trigger.endAt;
    result.expiresAt = trigger.endAt + 900000;
    check(s.serverTime < result.expiresAt, "DATA_STALE");
    const previous = s.candles15m.slice(-21, -1),
      avg = sum(previous.map((c) => c.volume)).div(20),
      high = max(...previous.slice(-8).map((c) => c.high)),
      low = min(...previous.slice(-8).map((c) => c.low));
    const ema50 = D(
        ema(
          s.candles1h.slice(-500).map((c) => c.close),
          50,
        ),
      ),
      ema200 = D(
        ema(
          s.candles1h.slice(-500).map((c) => c.close),
          200,
        ),
      ),
      a = atr(s.candles15m.slice(-100));
    const mid = D(s.quote.ask).add(s.quote.bid).div(2),
      spread = D(s.quote.ask).sub(s.quote.bid).div(mid).mul(10000);
    result.evidence = {
      "trend.ema50": {
        value: ema50.toFixed(),
        description: "EMA50 candle 1h tertutup",
      },
      "trend.ema200": {
        value: ema200.toFixed(),
        description: "EMA200 candle 1h tertutup",
      },
      "volume.ratio": {
        value: avg.gt(0) ? D(trigger.volume).div(avg).toFixed() : null,
        description: "Volume pemicu / rata-rata 20 candle sebelumnya",
      },
      "price.spreadBps": {
        value: spread.toFixed(),
        description: "Spread bid/ask bps",
      },
      "price.atr": { value: a, description: "ATR14 Wilder 15m" },
      "volume.required": { value: "1", description: "Ambang rasio volume" },
      "breakout.upper": { value: high.toFixed(), description: "LONG memerlukan penutupan di atas high 8 candle sebelumnya" },
      "breakout.lower": { value: low.toFixed(), description: "SHORT memerlukan penutupan di bawah low 8 candle sebelumnya" },
      "trigger.close": { value: trigger.close, description: "Penutupan candle pemicu" },
      "gate.trendLong": { value: ema50.gt(ema200), description: "Tren 1h mendukung LONG (EMA50 > EMA200)" },
      "gate.trendShort": { value: ema50.lt(ema200), description: "Tren 1h mendukung SHORT (EMA50 < EMA200)" },
      "gate.volume": { value: avg.gt(0) && D(trigger.volume).gte(avg), description: "Filter volume terpenuhi" },
      "data.closed": {
        value: true,
        description: "Candle tertutup dan berurutan",
      },
    };
    check(avg.gt(0) && D(trigger.volume).gte(avg), "VOLUME_FILTER");
    check(spread.lte(20), "SPREAD_RISK");
    check(mid.sub(trigger.close).abs().lte(D(a).mul("0.5")), "EXTENDED_PRICE");
    const long = ema50.gt(ema200) && D(trigger.close).gt(high),
      short = ema50.lt(ema200) && D(trigger.close).lt(low);
    check(long !== short, "TREND_BREAKOUT_FILTER");
    result.side = long ? "LONG" : "SHORT";
    result.evidence["trend.side"] = {
      value: result.side,
      description: "Arah tren dan pemicu yang dihitung engine",
    };
    result.plan = createPlan({
      snapshot: s,
      side: result.side,
      atr: a,
      triggerClose: trigger.close,
      settings,
      context,
    });
    result.decision = long ? "LONG_CANDIDATE" : "SHORT_CANDIDATE";
  } catch (error) {
    if (!(error instanceof EngineError)) throw error;
    result.reasons.push(error.code);
  }
  return result;
}
export function revalidatePlan(
  signal: Signal,
  snapshot: MarketSnapshot,
  settings: TradingSettings,
  context: AccountContext,
  leverage: number,
) {
  check(
    signal.plan &&
      signal.side &&
      signal.decision !== "WAIT" &&
      !signal.consumedPositionId,
    "RISK_REJECTED",
  );
  check(Date.now() < signal.expiresAt, "SIGNAL_EXPIRED");
  check(leverage === signal.plan.leverage, "INVALID_LEVERAGE");
  const plan = createPlan({
    snapshot,
    side: signal.side,
    atr: signal.plan.atr,
    triggerClose: signal.plan.triggerClose,
    settings,
    context,
    stop: signal.plan.stop,
    target: signal.plan.target,
  });
  check(
    D(plan.entry)
      .sub(signal.plan.entry)
      .abs()
      .div(signal.plan.entry)
      .lte("0.003"),
    "PRICE_MOVED",
  );
  return plan;
}
export { DEFAULT_SETTINGS };
