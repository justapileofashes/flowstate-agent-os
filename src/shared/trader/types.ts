// AI Trader shared contract: the versioned TraderConfig (config-as-code —
// every risk limit, symbol list and threshold lives here, never hardcoded in
// the engine), plus the DTOs the renderer reads. Pure: zod + types only.

import { z } from 'zod';

// ── enums ───────────────────────────────────────────────────────────────────

export const TIMEFRAMES = ['5m', '15m', '1h', '1d'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

export const ASSET_CLASSES = ['us_equity', 'crypto'] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const DATA_SOURCES = ['auto', 'alpaca', 'yahoo'] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export type Side = 'long' | 'short';
export type OrderSide = 'buy' | 'sell';
export type TradingMode = 'paper' | 'live';
/** Paper = the simulated account; shadow = paper mirror of live orders. */
export type AccountKind = 'paper' | 'live' | 'shadow';

export const MODEL_STATUSES = ['candidate', 'shadow', 'active', 'retired', 'rejected'] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];

export const SIGNAL_STATUSES = [
  'proposed', // passed gating, waiting for risk / execution (or manual execute when autopilot is off)
  'rejected', // risk engine said no (reason verbatim)
  'vetoed', // LLM risk review vetoed
  'approved', // risk passed, handed to the trader node
  'submitted',
  'filled',
  'closed',
  'expired',
  'failed',
] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

export const ORDER_STATUSES = [
  'new',
  'submitted',
  'partially_filled',
  'filled',
  'canceled',
  'rejected',
  'expired',
  'failed',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const KILL_MODES = ['halt', 'flatten'] as const;
export type KillMode = (typeof KILL_MODES)[number];

export const CREDENTIAL_SLOTS = ['data', 'paper', 'live'] as const;
export type CredentialSlot = (typeof CREDENTIAL_SLOTS)[number];

/** Canonical symbols: equities `AAPL`, `BRK.B`; crypto `BTC/USD`. */
export const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9.]{0,9}(\/[A-Z]{3,5})?$/, 'symbol like AAPL, BRK.B or BTC/USD');

export function assetClassOf(symbol: string): AssetClass {
  return symbol.includes('/') ? 'crypto' : 'us_equity';
}

// ── config ──────────────────────────────────────────────────────────────────

export const DEFAULT_SECTORS: Record<string, string> = {
  AAPL: 'tech', MSFT: 'tech', NVDA: 'tech', AVGO: 'tech', GOOGL: 'communication', META: 'communication',
  AMZN: 'consumer', TSLA: 'consumer', HD: 'consumer', COST: 'staples', WMT: 'staples', PG: 'staples', KO: 'staples',
  JPM: 'financials', V: 'financials', MA: 'financials', UNH: 'health', JNJ: 'health', LLY: 'health', XOM: 'energy',
  SPY: 'index', QQQ: 'index', IWM: 'index', DIA: 'index', 'BTC/USD': 'crypto', 'ETH/USD': 'crypto',
};

const symbolGroupSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  enabled: z.boolean(),
  symbols: z.array(symbolSchema).max(100),
});
export type SymbolGroup = z.output<typeof symbolGroupSchema>;

const riskConfigSchema = z.object({
  /** Fixed-fractional f: % of equity lost if the stop is hit. */
  riskPerTradePct: z.number().min(0.05).max(5).default(0.5),
  maxPositionPct: z.number().min(0.5).max(100).default(10),
  maxGrossExposurePct: z.number().min(1).max(200).default(60),
  maxPositions: z.number().int().min(1).max(50).default(5),
  maxTradesPerDay: z.number().int().min(1).max(100).default(10),
  /** Realized + unrealized loss today that trips the circuit breaker. */
  dailyLossLimitPct: z.number().min(0.1).max(20).default(2),
  /** Equity drawdown from its peak beyond which new entries are blocked. */
  maxOpenDrawdownPct: z.number().min(0.5).max(60).default(8),
  maxSectorPct: z.number().min(1).max(100).default(30),
  correlationThreshold: z.number().min(0.3).max(1).default(0.85),
  maxCorrelatedPositions: z.number().int().min(1).max(20).default(2),
  /** Position size ≤ this % of the symbol's average daily volume. */
  maxAdvPct: z.number().min(0.01).max(100).default(1),
  stopAtrMult: z.number().min(0.3).max(10).default(1.5),
  takeProfitAtrMult: z.number().min(0.3).max(20).default(3),
  minStopPct: z.number().min(0.05).max(10).default(0.3),
  maxStopPct: z.number().min(0.5).max(50).default(10),
  cashReservePct: z.number().min(0).max(90).default(10),
  lossStreakPause: z.number().int().min(1).max(20).default(3),
  netExposure: z
    .object({
      us_equity: z.object({ min: z.number().min(-200).max(200), max: z.number().min(-200).max(200) }),
      crypto: z.object({ min: z.number().min(-200).max(200), max: z.number().min(-200).max(200) }),
    })
    .default({ us_equity: { min: 0, max: 100 }, crypto: { min: 0, max: 20 } }),
  earningsBlackout: z
    .array(z.object({ symbol: symbolSchema, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .max(500)
    .default([]),
  earningsBlackoutDays: z.number().int().min(0).max(10).default(1),
  allowShort: z.boolean().default(false),
});

const signalConfigSchema = z.object({
  confidenceThreshold: z.number().min(0.5).max(0.99).default(0.62),
  perSymbolThreshold: z.record(z.string(), z.number().min(0.5).max(0.99)).default({}),
  /** Expected edge p·up − (1−p)·down, in % of price. */
  minEdgePct: z.number().min(0).max(10).default(0.05),
  requireAgreement: z.boolean().default(true),
  timeframeWeights: z
    .record(z.enum(TIMEFRAMES), z.number().min(0).max(10))
    .default({ '5m': 1, '15m': 1, '1h': 1.5, '1d': 1 }),
  maxSignalsPerTick: z.number().int().min(1).max(50).default(5),
  /** Entries that have not filled within this many bars are canceled. */
  expiryBars: z.number().int().min(1).max(20).default(2),
});

const modelSpecSchema = z.object({
  timeframe: z.enum(TIMEFRAMES),
  horizonBars: z.number().int().min(1).max(120),
  enabled: z.boolean(),
});
export type ModelSpec = z.output<typeof modelSpecSchema>;

const gbdtParamsSchema = z.object({
  trees: z.number().int().min(10).max(1000).default(150),
  depth: z.number().int().min(1).max(6).default(3),
  learningRate: z.number().min(0.005).max(1).default(0.08),
  minLeaf: z.number().int().min(5).max(2000).default(40),
  bins: z.number().int().min(8).max(128).default(32),
  subsample: z.number().min(0.3).max(1).default(0.8),
  l2: z.number().min(0).max(100).default(1),
});
export type GbdtParams = z.output<typeof gbdtParamsSchema>;

const modelsConfigSchema = z.object({
  specs: z
    .array(modelSpecSchema)
    .max(8)
    .default([
      { timeframe: '15m', horizonBars: 4, enabled: true },
      { timeframe: '1h', horizonBars: 4, enabled: true },
      { timeframe: '5m', horizonBars: 6, enabled: false },
      { timeframe: '1d', horizonBars: 5, enabled: false },
    ]),
  lookbackDays: z.number().int().min(30).max(3650).default(180),
  gbdt: gbdtParamsSchema.default({}),
  minAuc: z.number().min(0.5).max(0.9).default(0.52),
  shadowDays: z.number().int().min(1).max(30).default(3),
  autoPromote: z.boolean().default(true),
  nightlyRetrainCron: z.string().max(60).default('30 2 * * 1-5'),
  weeklyRetrainCron: z.string().max(60).default('0 4 * * 6'),
});

const dataConfigSchema = z.object({
  source: z.enum(DATA_SOURCES).default('auto'),
  backfillDays: z.number().int().min(5).max(3650).default(180),
  retentionDays: z
    .record(z.enum(TIMEFRAMES), z.number().int().min(7).max(10_000))
    .default({ '5m': 90, '15m': 180, '1h': 800, '1d': 3650 }),
  writeLake: z.boolean().default(true),
});

const executionConfigSchema = z.object({
  orderType: z.enum(['market', 'limit']).default('market'),
  limitOffsetBps: z.number().min(0).max(500).default(5),
  slippageBps: z.number().min(0).max(500).default(5),
  commissionPerShare: z.number().min(0).max(1).default(0),
  commissionMin: z.number().min(0).max(50).default(0),
  borrowBpsPerDay: z.number().min(0).max(100).default(1),
  cryptoFundingBpsPerDay: z.number().min(0).max(100).default(0),
  /** Max share of a bar's volume one order may take (partial fills beyond). */
  participationPct: z.number().min(0.1).max(100).default(10),
  latencyBars: z.number().int().min(0).max(5).default(0),
  maxRetries: z.number().int().min(0).max(6).default(3),
  paperStartingCash: z.number().min(1_000).max(100_000_000).default(100_000),
  /** Close positions after this many bars of their signal timeframe (0 = never). */
  maxHoldBarsMult: z.number().min(0).max(50).default(3),
});

const llmConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** '' → the app's default chat model. */
  model: z.string().max(200).default(''),
  maxCallsPerTick: z.number().int().min(0).max(10).default(2),
  rationale: z.boolean().default(true),
  /** Opt-in: an LLM risk officer that can only veto. Parse failure aborts the tick. */
  riskReview: z.boolean().default(false),
  news: z.boolean().default(false),
  timeoutMs: z.number().int().min(2_000).max(120_000).default(20_000),
});

const scheduleConfigSchema = z.object({
  /** Seconds after a bar closes before the tick runs (lets data arrive). */
  tickDelaySec: z.number().int().min(0).max(300).default(20),
  extendedHours: z.boolean().default(false),
});

const monitorConfigSchema = z.object({
  webhookUrl: z.union([z.literal(''), z.string().url().max(500)]).default(''),
  fillFailureStreak: z.number().int().min(1).max(50).default(3),
  driftThresholdPct: z.number().min(1).max(100).default(15),
  dataGapMs: z.number().int().min(30_000).max(3_600_000).default(120_000),
  /** 0 = off. Otherwise serves Prometheus text on 127.0.0.1:<port>/metrics. */
  metricsHttpPort: z.number().int().min(0).max(65_535).default(0),
});

export const traderConfigSchema = z.object({
  symbolGroups: z
    .array(symbolGroupSchema)
    .max(20)
    .default([
      {
        id: 'large-caps',
        name: 'US large caps',
        enabled: true,
        symbols: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'JPM', 'V', 'UNH', 'XOM', 'JNJ', 'WMT', 'PG', 'MA', 'HD', 'COST', 'AVGO', 'LLY', 'KO'],
      },
      { id: 'etfs', name: 'Index ETFs', enabled: true, symbols: ['SPY', 'QQQ', 'IWM', 'DIA'] },
      { id: 'crypto', name: 'Crypto', enabled: false, symbols: ['BTC/USD', 'ETH/USD'] },
    ]),
  sectors: z.record(z.string(), z.string().max(40)).default(DEFAULT_SECTORS),
  risk: riskConfigSchema.default({}),
  signals: signalConfigSchema.default({}),
  models: modelsConfigSchema.default({}),
  data: dataConfigSchema.default({}),
  execution: executionConfigSchema.default({}),
  llm: llmConfigSchema.default({}),
  schedule: scheduleConfigSchema.default({}),
  monitor: monitorConfigSchema.default({}),
});

export type TraderConfig = z.output<typeof traderConfigSchema>;
export type TraderConfigInput = z.input<typeof traderConfigSchema>;
export type RiskConfig = TraderConfig['risk'];
export type ExecutionConfig = TraderConfig['execution'];

export function defaultTraderConfig(): TraderConfig {
  return traderConfigSchema.parse({});
}

/** Enabled, de-duplicated universe. */
export function universe(config: TraderConfig): string[] {
  const out = new Set<string>();
  for (const g of config.symbolGroups) if (g.enabled) for (const s of g.symbols) out.add(s);
  return [...out];
}

// ── DTOs ────────────────────────────────────────────────────────────────────

export interface EquityPointDto {
  ts: number;
  equity: number;
}

export interface PositionDto {
  account: AccountKind;
  symbol: string;
  qty: number; // signed: < 0 = short
  avgPrice: number;
  lastPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  stop: number | null;
  takeProfit: number | null;
  openedAt: number | null;
  tradeId: string | null;
}

export interface PortfolioDto {
  account: AccountKind;
  mode: TradingMode;
  equity: number;
  cash: number;
  buyingPower: number;
  grossExposure: number;
  grossExposurePct: number;
  netExposure: number;
  dailyPnl: number;
  realizedToday: number;
  unrealized: number;
  peakEquity: number;
  drawdownPct: number;
  positions: PositionDto[];
  equityCurve: EquityPointDto[];
  asOf: number;
  error?: string;
}

export interface OrderDto {
  id: string;
  clientOrderId: string;
  account: AccountKind;
  signalId: string | null;
  tradeId: string | null;
  symbol: string;
  side: OrderSide;
  role: 'entry' | 'exit' | 'flatten';
  type: 'market' | 'limit' | 'stop';
  qty: number;
  limitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  filledQty: number;
  avgFillPrice: number | null;
  assumedPrice: number | null;
  slippageBps: number | null;
  brokerOrderId: string | null;
  status: OrderStatus;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface FillDto {
  id: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  price: number;
  commission: number;
  ts: number;
}

export interface SignalDto {
  id: string;
  cycleId: string | null;
  symbol: string;
  side: Side;
  timeframe: Timeframe | 'fused';
  entry: number;
  stop: number;
  takeProfit: number;
  size: number;
  confidence: number;
  edgePct: number;
  horizonMin: number;
  modelVersion: string | null;
  strategyId: string | null;
  strategyName: string | null;
  source: 'model' | 'agent' | 'manual';
  status: SignalStatus;
  reason: string | null;
  rationale: string;
  perTimeframe: Array<{ timeframe: Timeframe; probUp: number; modelVersion: string }>;
  createdAt: number;
}

export interface TradeDto {
  id: string;
  signalId: string | null;
  account: AccountKind;
  symbol: string;
  side: Side;
  qty: number;
  entryPrice: number;
  exitPrice: number | null;
  stop: number | null;
  takeProfit: number | null;
  pnl: number | null;
  fees: number;
  status: 'open' | 'closed' | 'canceled';
  outcome: 'win' | 'loss' | 'flat' | null;
  exitReason: string | null;
  modelVersion: string | null;
  strategyId: string | null;
  review: string | null;
  legacy: boolean;
  openedAt: number;
  closedAt: number | null;
}

export interface NodeMessageDto {
  node: 'data' | 'researcher' | 'quant' | 'risk' | 'trader' | 'logger' | 'reconcile' | 'guard';
  ok: boolean;
  ms: number;
  summary: string;
  data?: unknown;
  llm?: { model: string; prompt: string; reply: string; ms: number } | null;
}

export interface AuditDto {
  id: string;
  signalId: string | null;
  tradeId: string | null;
  cycleId: string | null;
  features: Record<string, number | string | null>;
  modelVersion: string | null;
  modelHash: string | null;
  research: NodeMessageDto | null;
  quant: NodeMessageDto | null;
  risk: RiskDecisionDto | null;
  trader: NodeMessageDto | null;
  orderIds: string[];
  fills: FillDto[];
  approvalTs: number | null;
  createdAt: number;
}

export interface RiskRuleResultDto {
  rule: string;
  passed: boolean;
  reason: string;
  adjust?: { size?: number; stop?: number; takeProfit?: number };
}

export interface RiskDecisionDto {
  allowed: boolean;
  reason: string;
  suggestedSize: number;
  suggestedStop: number;
  suggestedTakeProfit: number;
  results: RiskRuleResultDto[];
}

export interface CycleDto {
  id: string;
  trigger: 'schedule' | 'manual' | 'agent';
  status: 'running' | 'done' | 'aborted' | 'skipped';
  mode: TradingMode;
  startedAt: number;
  endedAt: number | null;
  abortReason: string | null;
  skipReason: string | null;
  nodes: NodeMessageDto[];
  llmCalls: number;
  signals: number;
  orders: number;
}

export interface ModelMetricsDto {
  auc: number;
  logLoss: number;
  hitRateTopDecile: number;
  baseRate: number;
  sharpe: number;
  maxDrawdownPct: number;
  totalReturnPct: number;
  trades: number;
  winRate: number;
  baselines: Array<{ name: string; sharpe: number; totalReturnPct: number }>;
  walkForward: Array<{ fold: number; from: number; to: number; auc: number; sharpe: number }>;
  rows: { train: number; validation: number; test: number };
  importances: Array<{ feature: string; gain: number }>;
  upMovePct: number;
  downMovePct: number;
  /** The active model scored on the same test window (null when none). */
  incumbent: { version: string; auc: number; sharpe: number } | null;
  /** Passed the promotion bar at training time (AUC, baselines, incumbent). */
  passed: boolean;
  reasons: string[];
  testFrom: number | null;
  testTo: number | null;
}

export interface ModelDto {
  id: string;
  version: string;
  timeframe: Timeframe;
  horizonBars: number;
  kind: 'full' | 'incremental';
  parentVersion: string | null;
  status: ModelStatus;
  trainedAt: number;
  datasetId: string;
  featureSet: string;
  hash: string;
  auc: number;
  sharpe: number;
  maxDrawdownPct: number;
  metrics: ModelMetricsDto;
  shadowPassDays: number;
  promotedAt: number | null;
  notes: string;
}

export interface ShadowEvalDto {
  modelVersion: string;
  activeVersion: string | null;
  day: string;
  candidateScore: number;
  activeScore: number;
  samples: number;
  passed: boolean;
}

export interface BacktestMetricsDto {
  startEquity: number;
  endEquity: number;
  totalReturnPct: number;
  sharpe: number;
  maxDrawdownPct: number;
  winRate: number;
  avgR: number;
  trades: number;
  exposurePct: number;
  fees: number;
  bars: number;
}

export interface BacktestTradeDto {
  symbol: string;
  side: Side;
  qty: number;
  entryTs: number;
  entryPrice: number;
  exitTs: number;
  exitPrice: number;
  pnl: number;
  r: number;
  exitReason: string;
  fees: number;
}

export interface BacktestDto {
  id: string;
  kind: 'vectorized' | 'event' | 'simulation';
  label: string;
  status: 'running' | 'done' | 'failed';
  metrics: BacktestMetricsDto | null;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
  reportPath: string | null;
  equityPath: string | null;
}

export interface BacktestReportDto extends BacktestDto {
  config: Record<string, unknown>;
  trades: BacktestTradeDto[];
  equity: EquityPointDto[];
  rejected: Array<{ ts: number; symbol: string; reason: string }>;
}

export interface StrategyDto {
  id: string;
  name: string;
  description: string;
  inspiration: string;
  status: 'active' | 'retired';
  params: StrategyParams;
  wins: number;
  losses: number;
  totalPnl: number;
  lessons: string[];
  legacy: boolean;
  createdAt: number;
  updatedAt: number;
}

export const FEATURE_FILTER_OPS = ['>', '>=', '<', '<='] as const;

export const strategyParamsSchema = z.object({
  timeframes: z.array(z.enum(TIMEFRAMES)).max(4).default([]), // [] = any
  minConfidence: z.number().min(0.5).max(0.99).default(0.62),
  sides: z.array(z.enum(['long', 'short'])).min(1).max(2).default(['long']),
  regimes: z.array(z.string().max(30)).max(10).default([]), // [] = any; e.g. 'trend_up'
  featureFilters: z
    .array(z.object({ feature: z.string().max(40), op: z.enum(FEATURE_FILTER_OPS), value: z.number() }))
    .max(10)
    .default([]),
  stopAtrMult: z.number().min(0.3).max(10).nullable().default(null), // null = risk config
  takeProfitAtrMult: z.number().min(0.3).max(20).nullable().default(null),
  maxHoldBars: z.number().int().min(0).max(1000).nullable().default(null),
});
export type StrategyParams = z.output<typeof strategyParamsSchema>;

export interface AlertDto {
  id: string;
  key: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  createdAt: number;
  acknowledgedAt: number | null;
}

export interface DataCoverageDto {
  symbol: string;
  timeframe: Timeframe;
  bars: number;
  firstTs: number | null;
  lastTs: number | null;
  stale: boolean;
  staleMs: number | null;
  issues: number;
}

export interface DataIssueDto {
  symbol: string;
  timeframe: Timeframe;
  ts: number | null;
  kind: string;
  detail: string;
  createdAt: number;
}

export interface MetricSeriesDto {
  name: string;
  labels: Record<string, string>;
  points: Array<{ ts: number; value: number }>;
}

export interface MetricsSnapshotDto {
  counters: Array<{ name: string; labels: Record<string, string>; value: number }>;
  gauges: Array<{ name: string; labels: Record<string, string>; value: number }>;
  histograms: Array<{ name: string; labels: Record<string, string>; count: number; sum: number; p50: number; p95: number }>;
  series: MetricSeriesDto[];
}

export interface GoLiveItemDto {
  key: 'build_flag' | 'consent' | 'paper_history' | 'risk_limits' | 'kill_switch_tested' | 'separate_keys' | 'live_keys';
  label: string;
  ok: boolean;
  detail: string;
}

export interface GoLiveDto {
  items: GoLiveItemDto[];
  ready: boolean;
  live: boolean;
}

export interface CredentialStatusDto {
  slot: CredentialSlot;
  configured: boolean;
  keyIdHint: string;
  verifiedAt: number | null;
}

export interface TraderStatusDto {
  mode: TradingMode;
  autopilot: boolean;
  consentAccepted: boolean;
  liveBuildEnabled: boolean;
  kill: { active: boolean; mode: KillMode | null; at: number | null; reason: string | null };
  breaker: { tripped: boolean; at: number | null; reason: string | null };
  brokerConnected: boolean;
  dataSource: 'alpaca' | 'yahoo';
  market: { open: boolean; nextOpen: number | null; nextClose: number | null; source: 'broker' | 'calendar' };
  lastCycle: CycleDto | null;
  nextTickAt: number | null;
  running: boolean;
  activeModels: Array<{ timeframe: Timeframe; version: string }>;
  openAlerts: number;
  configVersion: number;
  version: string;
}
