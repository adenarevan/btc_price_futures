import { createHash } from "node:crypto";
import { D, max, min } from "../decimal";
import { check, marginEstimate, multiplier, validatePrices } from "../engine";
import {
  MARKET_TYPE,
  PROVIDER,
  MARGIN_MODEL,
  type FundingEvent,
  type LedgerEntry,
  type MarketSnapshot,
  type MutationResult,
  type PaperAccount,
  type Position,
  type PositionMutation,
  type Signal,
  type TradePlan,
} from "../domain";
export const hash = (data: unknown) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
function posting(
  p: Position,
  type: LedgerEntry["eventType"],
  amount: string,
  bucket: LedgerEntry["bucket"],
  source: string,
  eventAt: number,
  postedAt: number,
): LedgerEntry {
  return {
    id: hash([p.accountId, p.id, type, bucket, source]),
    accountId: p.accountId,
    positionId: p.id,
    eventType: type,
    signedAmount: amount,
    bucket,
    sourceEventId: source,
    eventAt,
    postedAt,
  };
}
function updated(account: PaperAccount, now: number): PaperAccount {
  return {
    ...structuredClone(account),
    accountVersion: account.accountVersion + 1,
    transactionCount: account.transactionCount + 1,
    updatedAt: now,
  };
}
export function openPosition(input: {
  account: PaperAccount;
  positions: Position[];
  signal: Signal;
  plan: TradePlan;
  positionId: string;
  snapshot: MarketSnapshot;
  now: number;
}): MutationResult {
  const { signal, plan, snapshot, now } = input,
    account = updated(input.account, now);
  check(
    account.status === "ACTIVE" && D(account.modelDeficit).isZero(),
    "ACCOUNT_REVIEW_REQUIRED",
  );
  check(
    !signal.consumedPositionId &&
      !account.consumedSignalIds.includes(signal.id) &&
      now < signal.expiresAt,
    "SIGNAL_EXPIRED",
  );
  check(
    !account.symbolPositionMap[signal.symbol] &&
      Object.keys(account.symbolPositionMap).length < 2,
    "RISK_REJECTED",
  );
  const debit = D(plan.initialMargin).add(plan.entryFee);
  check(D(account.availableCollateral).gte(debit), "INSUFFICIENT_COLLATERAL");
  account.availableCollateral = D(account.availableCollateral)
    .sub(debit)
    .toFixed();
  account.symbolPositionMap[signal.symbol] = input.positionId;
  // Historical consumption also persists on the signal; avoid a growing account document.
  const p: Position = {
    id: input.positionId,
    accountId: account.id,
    sourceSignalId: signal.id,
    instrumentKey: signal.instrumentKey,
    provider: PROVIDER,
    marketType: MARKET_TYPE,
    symbol: signal.symbol,
    side: plan.side,
    status: "OPEN",
    qty: plan.qty,
    entry: plan.entry,
    stop: plan.stop,
    target: plan.target,
    leverage: plan.leverage,
    initialMargin: plan.initialMargin,
    collateral: plan.initialMargin,
    fundingNet: "0",
    entryFee: plan.entryFee,
    exitFee: "0",
    plannedRisk: plan.plannedRisk,
    currentPlannedRisk: plan.plannedRisk,
    feeRate: plan.feeRate,
    slippageRate: plan.slippageRate,
    maintenanceRate: plan.maintenanceRate,
    atr: plan.atr,
    marginModel: MARGIN_MODEL,
    marginEstimate: plan.marginEstimate,
    costVersion: plan.costVersion,
    riskVersion: plan.riskVersion,
    strategyVersion: plan.strategyVersion,
    openedAt: now,
    closedAt: null,
    updatedAt: now,
    exit: null,
    grossPnl: "0",
    netPnl: D(plan.entryFee).neg().toFixed(),
    roe: "0",
    fundingComplete: true,
    fundingCursor: now,
    appliedFundingEventIds: [],
    lastMark: snapshot.derivatives.markPrice,
    lastQuote: snapshot.quote,
    lastDerivatives: snapshot.derivatives,
    lastRiskCheckAt: now,
    validityFlags: [],
    closeReason: null,
  };
  return {
    account,
    position: p,
    signal: { ...signal, consumedPositionId: p.id },
    ledger: [
      posting(
        p,
        "ENTRY_FEE",
        D(plan.entryFee).neg().toFixed(),
        "AVAILABLE",
        signal.id,
        now,
        now,
      ),
      posting(
        p,
        "MARGIN_LOCK",
        D(plan.initialMargin).neg().toFixed(),
        "AVAILABLE",
        signal.id,
        now,
        now,
      ),
      posting(
        p,
        "MARGIN_LOCK",
        plan.initialMargin,
        "POSITION_COLLATERAL",
        signal.id,
        now,
        now,
      ),
    ],
  };
}
export function applyFunding(input: {
  account: PaperAccount;
  position: Position;
  event: FundingEvent;
  postedAt: number;
}): PositionMutation {
  const { event, postedAt } = input,
    p = structuredClone(input.position);
  check(
    event.instrumentKey === p.instrumentKey && event.rateType === "SETTLED",
    "DATA_INVALID",
  );
  if (
    event.fundingTime < p.openedAt ||
    (p.closedAt !== null && event.fundingTime >= p.closedAt) ||
    p.appliedFundingEventIds.includes(event.id)
  )
    return { account: input.account, position: p, ledger: [] };
  const account = updated(input.account, postedAt),
    flow = D(p.qty)
      .mul(event.markPrice)
      .mul(event.fundingRate)
      .mul(-multiplier(p.side));
  p.fundingNet = D(p.fundingNet).add(flow).toFixed();
  p.netPnl = D(p.netPnl).add(flow).toFixed();
  p.appliedFundingEventIds.push(event.id);
  p.updatedAt = postedAt;
  const ledger: LedgerEntry[] = [];
  if (p.status === "OPEN") {
    p.collateral = D(p.collateral).add(flow).toFixed();
    ledger.push(
      posting(
        p,
        "FUNDING",
        flow.toFixed(),
        "POSITION_COLLATERAL",
        event.id,
        event.fundingTime,
        postedAt,
      ),
    );
  } else {
    let delta = flow;
    if (delta.gt(0) && D(account.modelDeficit).gt(0)) {
      const reduction = min(delta, account.modelDeficit);
      account.modelDeficit = D(account.modelDeficit).sub(reduction).toFixed();
      delta = delta.sub(reduction);
      ledger.push(
        posting(
          p,
          "MODEL_DEFICIT",
          reduction.neg().toFixed(),
          "DEFICIT",
          event.id,
          event.fundingTime,
          postedAt,
        ),
      );
    }
    const result = D(account.availableCollateral).add(delta);
    if (result.lt(0)) {
      const deficit = result.neg();
      account.modelDeficit = D(account.modelDeficit).add(deficit).toFixed();
      ledger.push(
        posting(
          p,
          "MODEL_DEFICIT",
          deficit.toFixed(),
          "DEFICIT",
          event.id,
          event.fundingTime,
          postedAt,
        ),
      );
      delta = D(account.availableCollateral).neg();
      account.status = "REVIEW_REQUIRED";
    }
    account.availableCollateral = max(0, result).toFixed();
    ledger.push(
      posting(
        p,
        "FUNDING",
        delta.toFixed(),
        "AVAILABLE",
        event.id,
        event.fundingTime,
        postedAt,
      ),
    );
    p.roe = D(p.netPnl).div(p.initialMargin).mul(100).toFixed();
    p.validityFlags = [
      ...new Set([...p.validityFlags, "LATE_FUNDING", "NEEDS_REVIEW"]),
    ];
  }
  return { account, position: p, ledger };
}
export function refreshPosition(
  p: Position,
  s: MarketSnapshot,
  now: number,
): Position {
  validatePrices(s, now);
  const next = structuredClone(p);
  if (p.status !== "OPEN") return next;
  if (now - p.lastRiskCheckAt > 180000)
    next.validityFlags = [
      ...new Set([...next.validityFlags, "MONITORING_GAP"]),
    ];
  next.lastMark = s.derivatives.markPrice;
  next.lastQuote = s.quote;
  next.lastDerivatives = s.derivatives;
  next.lastRiskCheckAt = now;
  next.marginEstimate = marginEstimate(
    p.side,
    p.qty,
    p.entry,
    p.collateral,
    s.derivatives.markPrice,
    p.maintenanceRate,
    p.feeRate,
  );
  return next;
}
export function closePosition(input: {
  account: PaperAccount;
  position: Position;
  snapshot: MarketSnapshot;
  now: number;
  modelBreach?: boolean;
}): PositionMutation {
  const { snapshot: s, now } = input;
  check(input.position.status === "OPEN", "POSITION_ALREADY_CLOSED");
  validatePrices(s, now);
  const p = refreshPosition(input.position, s, now),
    account = updated(input.account, now),
    d = multiplier(p.side),
    breach = input.modelBreach === true;
  if (breach) check(p.marginEstimate.breach, "MARGIN_BUFFER_REJECTED");
  const exit = breach
    ? D(s.derivatives.markPrice)
    : D(p.side === "LONG" ? s.quote.bid : s.quote.ask).mul(
        D(1).sub(D(p.slippageRate).mul(d)),
      );
  const gross = D(p.qty).mul(exit.sub(p.entry)).mul(d),
    fee = exit.mul(p.qty).mul(p.feeRate),
    returned = D(p.collateral).add(gross).sub(fee),
    deficit = max(0, returned.neg());
  const ledger = [
    posting(p, "CLOSE", gross.toFixed(), "PNL", p.id, now, now),
    posting(p, "EXIT_FEE", fee.neg().toFixed(), "PNL", p.id, now, now),
    posting(
      p,
      "MARGIN_RELEASE",
      D(p.collateral).neg().toFixed(),
      "POSITION_COLLATERAL",
      p.id,
      now,
      now,
    ),
    posting(
      p,
      "MARGIN_RELEASE",
      max(0, returned).toFixed(),
      "AVAILABLE",
      p.id,
      now,
      now,
    ),
  ];
  account.availableCollateral = D(account.availableCollateral)
    .add(max(0, returned))
    .toFixed();
  if (deficit.gt(0)) {
    account.modelDeficit = D(account.modelDeficit).add(deficit).toFixed();
    account.status = "REVIEW_REQUIRED";
    ledger.push(
      posting(p, "MODEL_DEFICIT", deficit.toFixed(), "DEFICIT", p.id, now, now),
    );
  }
  delete account.symbolPositionMap[p.symbol];
  p.status = breach
    ? "LIQUIDATED_SIM"
    : p.fundingComplete
      ? "CLOSED"
      : "CLOSED_PENDING_FUNDING";
  p.closedAt = now;
  p.updatedAt = now;
  p.exit = exit.toFixed();
  p.collateral = "0";
  p.grossPnl = gross.toFixed();
  p.exitFee = fee.toFixed();
  p.netPnl = gross.sub(p.entryFee).sub(fee).add(p.fundingNet).toFixed();
  p.roe = D(p.netPnl).div(p.initialMargin).mul(100).toFixed();
  p.closeReason = breach ? "PAPER_MARGIN_BREACH" : "USER_CONFIRMED";
  return { account, position: p, ledger };
}
