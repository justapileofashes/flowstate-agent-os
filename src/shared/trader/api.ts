// AI Trader RPC contract — replaces the spec's REST routes (/api/trader/*)
// and WebSocket stream. One IPC channel (CHANNELS.TRADER_RPC) carries
// { method, params }; every method has a zod request schema validated in main
// and a typed response. Errors are structured { code, message, details }.
// Pushes (signals, fills, alerts, equity deltas, cycles) arrive on
// CHANNELS.TRADER_EVENT.

import { z } from 'zod';
import {
  CREDENTIAL_SLOTS,
  KILL_MODES,
  SIGNAL_STATUSES,
  strategyParamsSchema,
  symbolSchema,
  TIMEFRAMES,
  traderConfigSchema,
  type AccountKind,
  type AlertDto,
  type AuditDto,
  type BacktestDto,
  type BacktestReportDto,
  type CredentialStatusDto,
  type CycleDto,
  type DataCoverageDto,
  type DataIssueDto,
  type FillDto,
  type GoLiveDto,
  type MetricsSnapshotDto,
  type ModelDto,
  type OrderDto,
  type PortfolioDto,
  type ShadowEvalDto,
  type SignalDto,
  type StrategyDto,
  type Timeframe,
  type TradeDto,
  type TraderConfig,
  type TraderStatusDto,
} from './types';

const id = z.string().min(1).max(120);
const account = z.enum(['paper', 'live', 'shadow']);

export const traderRequestSchemas = {
  status: z.object({}),
  'autopilot.set': z.object({ enabled: z.boolean() }),
  'consent.accept': z.object({ text: z.string().max(40) }),

  'config.get': z.object({}),
  'config.update': z.object({ config: traderConfigSchema, note: z.string().max(500).optional() }),
  'config.history': z.object({ limit: z.number().int().min(1).max(200).optional() }),
  assets: z.object({}),

  portfolio: z.object({ account: account.optional(), curveDays: z.number().int().min(1).max(365).optional() }),
  'orders.list': z.object({ account: account.optional(), open: z.boolean().optional(), limit: z.number().int().min(1).max(1000).optional() }),
  'fills.list': z.object({ account: account.optional(), limit: z.number().int().min(1).max(1000).optional() }),
  'equity.csv': z.object({ account: account.optional(), days: z.number().int().min(1).max(3650).optional() }),
  'signals.list': z.object({
    since: z.enum(['today', 'week', 'all']).optional(),
    status: z.array(z.enum(SIGNAL_STATUSES)).max(10).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  }),
  'signals.execute': z.object({ signalId: id }),
  'signals.dismiss': z.object({ signalId: id }),
  'trades.list': z.object({ account: account.optional(), status: z.enum(['open', 'closed', 'canceled']).optional(), limit: z.number().int().min(1).max(1000).optional() }),
  'audit.get': z.object({ signalId: id.optional(), tradeId: id.optional() }),
  'cycles.list': z.object({ limit: z.number().int().min(1).max(500).optional(), includeSkipped: z.boolean().optional() }),
  'cycles.run': z.object({ advisory: z.boolean().optional() }),

  kill: z.object({ mode: z.enum(KILL_MODES), reason: z.string().max(300).optional() }),
  resume: z.object({}),
  'killswitch.test': z.object({}),
  'positions.close': z.object({ symbol: symbolSchema, account: account.optional() }),
  'paper.reset': z.object({ confirm: z.literal('RESET') }),
  'venue.set': z.object({ paperVenue: z.enum(['simulator', 'alpaca_paper']) }),

  paperSimulate: z.object({ days: z.number().int().min(1).max(30).optional() }),
  'backtests.run': z.object({
    kind: z.enum(['vectorized', 'event']),
    timeframe: z.enum(TIMEFRAMES),
    days: z.number().int().min(1).max(3650),
    symbols: z.array(symbolSchema).max(100).optional(),
    modelVersion: z.string().max(120).optional(),
    label: z.string().max(200).optional(),
  }),
  'backtests.list': z.object({ limit: z.number().int().min(1).max(500).optional() }),
  'report.get': z.object({ id }),

  'models.list': z.object({ timeframe: z.enum(TIMEFRAMES).optional() }),
  'models.train': z.object({ timeframe: z.enum(TIMEFRAMES), kind: z.enum(['full', 'incremental']).optional() }),
  'models.promote': z.object({ version: id, confirm: z.string().max(20) }),
  'models.retire': z.object({ version: id }),
  'models.shadowCompare': z.object({ version: id, days: z.number().int().min(1).max(365).optional() }),
  'models.shadowEvals': z.object({ version: id.optional() }),

  'data.ingest': z.object({ timeframe: z.enum(TIMEFRAMES), days: z.number().int().min(1).max(3650), symbols: z.array(symbolSchema).max(100).optional() }),
  'data.coverage': z.object({}),
  'data.issues': z.object({ limit: z.number().int().min(1).max(1000).optional() }),

  'strategies.list': z.object({}),
  'strategies.save': z.object({
    id: id.optional(),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).default(''),
    inspiration: z.string().max(2000).default(''),
    params: strategyParamsSchema,
  }),
  'strategies.setStatus': z.object({ id, status: z.enum(['active', 'retired']) }),

  'alerts.list': z.object({ open: z.boolean().optional(), limit: z.number().int().min(1).max(500).optional() }),
  'alerts.ack': z.object({ id: z.union([id, z.literal('all')]) }),
  'metrics.snapshot': z.object({ sinceHours: z.number().min(1).max(24 * 14).optional() }),
  'metrics.prometheus': z.object({}),
  'opslog.list': z.object({ limit: z.number().int().min(1).max(500).optional() }),

  'credentials.status': z.object({}),
  'credentials.save': z.object({ slot: z.enum(CREDENTIAL_SLOTS), keyId: z.string().trim().min(8).max(200), secret: z.string().trim().min(8).max(400) }),
  'credentials.test': z.object({ slot: z.enum(CREDENTIAL_SLOTS) }),
  'credentials.delete': z.object({ slot: z.enum(CREDENTIAL_SLOTS) }),

  'golive.checklist': z.object({}),
  'golive.enable': z.object({ confirm: z.string().max(40) }),
  'golive.disable': z.object({}),
} as const;

export type TraderMethod = keyof typeof traderRequestSchemas;
export type TraderRequest<M extends TraderMethod> = z.input<(typeof traderRequestSchemas)[M]>;
export type TraderParsed<M extends TraderMethod> = z.output<(typeof traderRequestSchemas)[M]>;

export interface AssetDto {
  symbol: string;
  assetClass: 'us_equity' | 'crypto';
  sector: string;
  groups: string[];
  enabled: boolean;
}

export interface ConfigVersionDto {
  version: number;
  note: string;
  editedBy: string;
  createdAt: number;
  config: TraderConfig;
}

export interface OpsLogDto {
  id: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: number;
}

export interface TrainResultDto {
  model: ModelDto | null;
  action: 'promoted' | 'shadow' | 'rejected' | null;
  error?: string;
}

export interface KillResultDto {
  active: boolean;
  mode: 'halt' | 'flatten' | null;
  canceled: number;
  flattened: string[];
  errors: string[];
  ms: number;
}

export interface TraderResponses {
  status: TraderStatusDto;
  'autopilot.set': { autopilot: boolean; error?: string };
  'consent.accept': { accepted: boolean; error?: string };
  'config.get': { config: TraderConfig; version: number; universe: string[] };
  'config.update': { config: TraderConfig; version: number };
  'config.history': { versions: ConfigVersionDto[] };
  assets: { assets: AssetDto[]; timeframes: Timeframe[]; dataSource: 'alpaca' | 'yahoo' };
  portfolio: PortfolioDto;
  'orders.list': { orders: OrderDto[] };
  'fills.list': { fills: FillDto[] };
  'equity.csv': { csv: string };
  'signals.list': { signals: SignalDto[] };
  'signals.execute': { ok: boolean; order?: OrderDto | null; reason?: string };
  'signals.dismiss': { ok: boolean };
  'trades.list': { trades: TradeDto[]; lessons: string[] };
  'audit.get': { audit: AuditDto | null; signal: SignalDto | null; trade: TradeDto | null; orders: OrderDto[] };
  'cycles.list': { cycles: CycleDto[] };
  'cycles.run': { cycle: CycleDto | null; error?: string };
  kill: KillResultDto;
  resume: { active: boolean };
  'killswitch.test': KillResultDto & { ok: boolean; error?: string };
  'positions.close': { ok: boolean; order?: OrderDto | null; error?: string };
  'paper.reset': { ok: boolean; cash: number };
  'venue.set': { paperVenue: 'simulator' | 'alpaca_paper'; error?: string };
  paperSimulate: { report: BacktestReportDto | null; error?: string };
  'backtests.run': { report: BacktestReportDto | null; error?: string };
  'backtests.list': { backtests: BacktestDto[] };
  'report.get': { report: BacktestReportDto | null };
  'models.list': { models: ModelDto[]; training: Timeframe[] };
  'models.train': TrainResultDto;
  'models.promote': { model: ModelDto | null; error?: string };
  'models.retire': { ok: boolean };
  'models.shadowCompare': { candidate: BacktestReportDto | null; production: BacktestReportDto | null; error?: string };
  'models.shadowEvals': { evals: ShadowEvalDto[] };
  'data.ingest': { stored: number; source: 'alpaca' | 'yahoo'; errors: string[]; issues: number; ms: number };
  'data.coverage': { coverage: DataCoverageDto[] };
  'data.issues': { issues: DataIssueDto[] };
  'strategies.list': { strategies: StrategyDto[] };
  'strategies.save': { strategy: StrategyDto | null };
  'strategies.setStatus': { strategy: StrategyDto | null };
  'alerts.list': { alerts: AlertDto[] };
  'alerts.ack': { acknowledged: number };
  'metrics.snapshot': MetricsSnapshotDto;
  'metrics.prometheus': { text: string; port: number | null };
  'opslog.list': { entries: OpsLogDto[] };
  'credentials.status': { credentials: CredentialStatusDto[]; paperVenue: 'simulator' | 'alpaca_paper' };
  'credentials.save': { ok: boolean; detail: string };
  'credentials.test': { ok: boolean; detail: string };
  'credentials.delete': { ok: boolean };
  'golive.checklist': GoLiveDto;
  'golive.enable': { live: boolean; error?: string; checklist: GoLiveDto };
  'golive.disable': { live: boolean };
}

export interface TraderError {
  code: 'bad_request' | 'not_found' | 'conflict' | 'forbidden' | 'unavailable' | 'internal';
  message: string;
  details?: unknown;
}

export type TraderRpcResult<M extends TraderMethod> = { ok: true; data: TraderResponses[M] } | { ok: false; error: TraderError };

export type TraderEvent =
  | { type: 'cycle'; cycle: CycleDto }
  | { type: 'signal'; signal: SignalDto }
  | { type: 'order'; order: OrderDto }
  | { type: 'trade'; trade: TradeDto; event: 'opened' | 'closed' }
  | { type: 'alert'; alert: AlertDto }
  | { type: 'equity'; account: AccountKind; ts: number; equity: number }
  | { type: 'train'; timeframe: Timeframe; message: string; done?: boolean }
  | { type: 'status' };
