export type DecimalString = string;
export type SymbolName =
  | "BTCUSDT"
  | "ETHUSDT"
  | "SOLUSDT"
  | "BNBUSDT"
  | "XRPUSDT"
  | "DOGEUSDT"
  | "SUIUSDT"
  | "LINKUSDT";
export const SUPPORTED_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "SUIUSDT", "LINKUSDT"] as const;
export type Side = "LONG" | "SHORT";
export type Leverage = 1 | 2 | 3 | 5;
export const PROVIDER = "binance-usdm-public" as const;
export const MARKET_TYPE = "USDT_LINEAR_PERPETUAL" as const;
export const STRATEGY_VERSION = "perp-breakout-active-v2";
export const MARGIN_MODEL = "isolated-linear-estimate-v1";
export interface Candle {
  instrumentKey: string;
  provider: string;
  symbol: SymbolName;
  marketType: typeof MARKET_TYPE;
  timeframe: "15m" | "1h";
  openAt: number;
  endAt: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}
export interface Quote {
  bid: string;
  ask: string;
  providerAt: number;
  fetchedAt: number;
}
export interface DerivativesSnapshot {
  markPrice: string;
  indexPrice: string;
  indicativeFundingRate: string;
  nextFundingTime: number;
  providerAt: number;
  fetchedAt: number;
  rawLastFundingRate?: string;
}
export interface InstrumentMetadata {
  symbol: SymbolName;
  status: "TRADING";
  contractType: "PERPETUAL";
  quoteAsset: "USDT";
  marginAsset: "USDT";
  tickSize: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  minNotional: string;
  fetchedAt: number;
  unsupportedFilters?: string[];
}
export interface FundingState {
  complete: boolean;
  checkedThrough: number;
  lastExpectedFundingTime: number | null;
  lastConfirmedFundingTime: number | null;
}
export interface MarketSnapshot {
  id: string;
  provider: typeof PROVIDER;
  symbol: SymbolName;
  marketType: typeof MARKET_TYPE;
  instrumentKey: string;
  serverTime: number;
  fetchedAt: number;
  candles15m: Candle[];
  candles1h: Candle[];
  quote: Quote;
  derivatives: DerivativesSnapshot;
  metadata: InstrumentMetadata;
  fundingState: FundingState;
  dataHash?: string;
  demo?: boolean;
}
export interface TradingSettings {
  accountId: string;
  watchlist: SymbolName[];
  initialCapital: string;
  defaultLeverage: Leverage;
  feeRate: string;
  slippageRate: string;
  riskPerPosition: string;
  maxTotalRisk: string;
  marginPerPosition: string;
  maxTotalMargin: string;
  maxGrossNotional: string;
  maintenanceRate: string;
  fundingReserveRate: string;
  aiEnabled: boolean;
  automationEnabled: boolean;
  dailyAiReviewLimit: number;
  version: string;
  costVersion: string;
  riskVersion: string;
  marginModel: typeof MARGIN_MODEL;
}
export const DEFAULT_SETTINGS: TradingSettings = {
  accountId: "paper-futures-v1",
  watchlist: [...SUPPORTED_SYMBOLS],
  initialCapital: "1000",
  defaultLeverage: 3,
  feeRate: "0.0006",
  slippageRate: "0.0005",
  riskPerPosition: "0.005",
  maxTotalRisk: "0.01",
  marginPerPosition: "0.10",
  maxTotalMargin: "0.20",
  maxGrossNotional: "1",
  maintenanceRate: "0.01",
  fundingReserveRate: "0.001",
  aiEnabled: true,
  automationEnabled: false,
  dailyAiReviewLimit: 12,
  version: "settings-v1",
  costVersion: "cost-v1",
  riskVersion: "risk-v1",
  marginModel: MARGIN_MODEL,
};
export interface PaperAccount {
  id: string;
  schemaVersion: 2;
  initialCapital: string;
  availableCollateral: string;
  modelDeficit: string;
  accountVersion: number;
  status: "ACTIVE" | "REVIEW_REQUIRED";
  symbolPositionMap: Partial<Record<SymbolName, string>>;
  consumedSignalIds: string[];
  transactionCount: number;
  createdAt: number;
  updatedAt: number;
}
export interface MarginEstimate {
  model: typeof MARGIN_MODEL;
  maintenanceRate: string;
  status: "AVAILABLE" | "NO_POSITIVE_THRESHOLD_IN_MODEL" | "UNAVAILABLE";
  liqApprox: string | null;
  marginBalance: string;
  maintenance: string;
  closeFeeReserve: string;
  ratio: string | null;
  breach: boolean;
  warning: boolean;
}
export interface TradePlan {
  side: Side;
  entry: string;
  stop: string;
  target: string;
  qty: string;
  leverage: Leverage;
  notional: string;
  initialMargin: string;
  entryFee: string;
  riskPerUnit: string;
  rewardPerUnit: string;
  netRR: string;
  plannedRisk: string;
  fundingReserve: string;
  atr: string;
  triggerClose: string;
  marginEstimate: MarginEstimate;
  feeRate: string;
  slippageRate: string;
  maintenanceRate: string;
  costVersion: string;
  riskVersion: string;
  strategyVersion: string;
}
export interface EvidenceFact {
  value: string | number | boolean | null;
  description: string;
}
export interface BaselineResult {
  decision: "LONG_CANDIDATE" | "SHORT_CANDIDATE" | "WAIT";
  side: Side | null;
  reasons: string[];
  evidence: Record<string, EvidenceFact>;
  plan: TradePlan | null;
  candleEndAt: number | null;
  expiresAt: number | null;
}
export interface Signal {
  id: string;
  accountId: string;
  instrumentKey: string;
  symbol: SymbolName;
  side: Side | null;
  decision: "LONG_CANDIDATE" | "SHORT_CANDIDATE" | "WAIT";
  snapshotId: string;
  candleEndAt: number;
  expiresAt: number;
  createdAt: number;
  plan: TradePlan | null;
  consumedPositionId: string | null;
  baseline?: BaselineResult;
  review?: unknown;
  reviewStatus?: string;
  reviewProvider?: "openai" | "oao" | "none";
  reviewModel?: string | null;
  strategyVersion: string;
  settingsVersion: string;
}
export type PositionStatus =
  | "OPEN"
  | "CLOSED"
  | "CLOSED_PENDING_FUNDING"
  | "LIQUIDATED_SIM";
export interface Position {
  id: string;
  accountId: string;
  sourceSignalId: string;
  instrumentKey: string;
  provider: typeof PROVIDER;
  marketType: typeof MARKET_TYPE;
  symbol: SymbolName;
  side: Side;
  status: PositionStatus;
  qty: string;
  entry: string;
  stop: string;
  target: string;
  leverage: Leverage;
  initialMargin: string;
  collateral: string;
  fundingNet: string;
  entryFee: string;
  exitFee: string;
  plannedRisk: string;
  currentPlannedRisk: string;
  feeRate: string;
  slippageRate: string;
  maintenanceRate: string;
  atr: string;
  marginModel: typeof MARGIN_MODEL;
  marginEstimate: MarginEstimate;
  costVersion: string;
  riskVersion: string;
  strategyVersion: string;
  openedAt: number;
  closedAt: number | null;
  updatedAt: number;
  exit: string | null;
  grossPnl: string;
  netPnl: string;
  roe: string;
  fundingComplete: boolean;
  fundingCursor: number;
  appliedFundingEventIds: string[];
  lastMark: string;
  lastQuote: Quote;
  lastDerivatives: DerivativesSnapshot;
  lastRiskCheckAt: number;
  validityFlags: string[];
  closeReason: string | null;
}
export interface AccountContext {
  account: PaperAccount;
  positions: Position[];
}
export interface FundingEvent {
  id: string;
  provider: typeof PROVIDER;
  instrumentKey: string;
  symbol: SymbolName;
  fundingTime: number;
  fundingRate: string;
  markPrice: string;
  rateType: "SETTLED";
}
export type LedgerEventType =
  | "MARGIN_LOCK"
  | "ENTRY_FEE"
  | "FUNDING"
  | "CLOSE"
  | "EXIT_FEE"
  | "MARGIN_RELEASE"
  | "MODEL_DEFICIT";
export interface LedgerEntry {
  id: string;
  accountId: string;
  positionId: string;
  eventType: LedgerEventType;
  signedAmount: string;
  sourceEventId: string;
  eventAt: number;
  postedAt: number;
  bucket: "AVAILABLE" | "POSITION_COLLATERAL" | "PNL" | "DEFICIT";
}
export interface PositionMutation {
  account: PaperAccount;
  position: Position;
  ledger: LedgerEntry[];
}
export interface MutationResult extends PositionMutation {
  signal: Signal;
}
export interface AccountSummary {
  availableCollateral: string;
  openCollateral: string;
  initialMarginLocked: string;
  walletBalance: string;
  paperEquity: string;
  markGrossPnl: string;
  grossExposure: string;
  modelDeficit: string;
  netExitEquityEstimate: string;
  openPlannedRisk: string;
  positionsCount: number;
}
export class EngineError extends Error {
  constructor(
    public readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = "EngineError";
  }
}
