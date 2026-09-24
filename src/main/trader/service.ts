// TraderService — the AI Trader's composition root and RPC surface (the
// in-process equivalent of the spec's ai-trader microservice). Wires data →
// features → models → signals → risk → execution → monitoring over one SQLite
// handle, owns the durable switches (autopilot, consent, kill switch, circuit
// breaker, paper/live mode) and implements every RPC method. No electron
// imports: the IPC handler injects notifications, broadcast and paths so the
// whole service runs under vitest.

import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { ZodError } from 'zod';
import type { LLMProvider } from '@main/agent/llm-provider';
import {
  assetClassOf,
  CREDENTIAL_SLOTS,
  TIMEFRAME_MS,
  TIMEFRAMES,
  traderConfigSchema,
  universe as universeOf,
  type AccountKind,
  type AlertDto,
  type CredentialSlot,
  type CredentialStatusDto,
  type GoLiveDto,
  type MetricSeriesDto,
  type PortfolioDto,
  type PositionDto,
  type Timeframe,
  type TraderConfig,
  type TraderStatusDto,
  type TradingMode,
} from '@shared/trader/types';
import { traderRequestSchemas, type TraderError, type TraderEvent, type TraderMethod, type TraderParsed, type TraderResponses } from '@shared/trader/api';
import { TraderDb } from './db';
import { localDate } from './db/util';
import { toModelDto } from './db/models';
import { AlpacaDataProvider, YahooProvider, type BarProvider, type FetchFn } from './data/providers';
import { BarLake } from './data/lake';
import { DataPipeline } from './data/pipeline';
import { etParts, etToUtc, isMarketOpen, nextOpen as calNextOpen, currentClose } from './data/calendar';
import { ModelRegistry } from './model/registry';
import type { Predictor } from './model/predictor';
import { RiskManager } from './risk/manager';
import { liveMarketContext } from './risk/market';
import { PaperBroker } from './execution/paper';
import { AlpacaBroker } from './execution/alpaca';
import { Oms } from './execution/oms';
import { KillSwitch } from './execution/kill-switch';
import type { BrokerAdapter } from './execution/types';
import { TraderLlm } from './orchestrator/llm';
import { TraderGraph } from './orchestrator/graph';
import { Metrics } from './monitor/metrics';
import { AlertEngine } from './monitor/alerts';
import { MetricsServer } from './monitor/http';
import { BacktestRunner } from './backtest/runner';
import { readReport } from './backtest/report';
import { TraderScheduler } from './scheduler';
import { goLiveChecklist } from './golive';
import { importLegacy } from './legacy';
import { maxDrawdownPct } from './model/metrics';
import type { PortfolioState, SignalProposal } from './types';
import { LIMITS, LIVE_TRADING_BUILD_ENABLED, TRADER_SECRET_KEYS, TRADER_VERSION, TYPED_LIVE_CONFIRMATION, TYPED_PROMOTE_CONFIRMATION } from './config';

export const CONSENT_PHRASE = 'I UNDERSTAND';

export interface TraderServiceDeps {
  raw: Database;
  settings: { get(key: string): string | null; set(key: string, value: string): void };
  provider: LLMProvider;
  /** userData/trader — lake + reports. null disables file output (tests). */
  dataDir: string | null;
  fetch?: FetchFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  broadcast?: (e: TraderEvent) => void;
  desktopNotify?: (title: string, body: string) => void;
  recordGlobalUsage?: (row: { chatId: string; agentId: string; model: string; promptTokens: number; completionTokens: number }) => void;
  /** Tests only: override the compiled-in live flag. */
  liveBuildEnabled?: boolean;
  alpacaFactory?: (account: 'paper' | 'live', creds: { keyId: string; secret: string }) => BrokerAdapter;
  providers?: { alpaca?: BarProvider; yahoo?: BarProvider };
  news?: (symbol: string) => Promise<string[]>;
  skipIngest?: boolean;
}

export class TraderRpcError extends Error {
  constructor(
    readonly code: TraderError['code'],
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'TraderRpcError';
  }
}

const MUTATING = new Set<TraderMethod>([
  'autopilot.set',
  'consent.accept',
  'config.update',
  'signals.execute',
  'signals.dismiss',
  'cycles.run',
  'kill',
  'resume',
  'killswitch.test',
  'positions.close',
  'paper.reset',
  'venue.set',
  'models.train',
  'models.promote',
  'models.retire',
  'data.ingest',
  'strategies.save',
  'strategies.setStatus',
  'alerts.ack',
  'credentials.save',
  'credentials.delete',
  'golive.enable',
  'golive.disable',
]);

interface BreakerState {
  date: string;
  reason: string;
  at: number;
}

export class TraderService {
  readonly db: TraderDb;
  readonly pipeline: DataPipeline;
  readonly registry: ModelRegistry;
  readonly risk = new RiskManager();
  readonly oms: Oms;
  readonly kill: KillSwitch;
  readonly llm: TraderLlm;
  readonly metrics = new Metrics();
  readonly alerts: AlertEngine;
  readonly graph: TraderGraph;
  readonly runner: BacktestRunner;
  readonly scheduler: TraderScheduler;
  readonly paperSim: PaperBroker;
  readonly shadowSim: PaperBroker;
  private readonly metricsServer: MetricsServer;
  private readonly now: () => number;
  private readonly fetchFn: FetchFn;
  private readonly lake: BarLake | null;
  private cachedConfig: { version: number; config: TraderConfig } | null = null;
  private defaultModel = '';
  private alpacaCache = new Map<string, BrokerAdapter>();
  private tickRunning = false;
  private lastEquityAt = new Map<AccountKind, number>();

  constructor(private readonly deps: TraderServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.fetchFn = deps.fetch ?? ((u, i) => fetch(u, i));
    this.db = new TraderDb(deps.raw);
    this.lake = deps.dataDir
      ? new BarLake(join(deps.dataDir, 'lake'), {
          get: (k) => this.db.ops.get<number | null>(k, null),
          set: (k, ts) => this.db.ops.set(k, ts, this.now()),
        })
      : null;
    this.pipeline = new DataPipeline({
      db: this.db,
      alpaca: deps.providers?.alpaca ?? new AlpacaDataProvider(() => this.creds('data'), this.fetchFn),
      yahoo: deps.providers?.yahoo ?? new YahooProvider(this.fetchFn),
      lake: this.lake,
      config: () => this.config(),
      hasDataKey: () => this.creds('data') !== null,
      now: this.now,
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
    });
    this.registry = new ModelRegistry({
      db: this.db,
      config: () => this.config(),
      now: this.now,
      ...(this.lake ? { writeManifest: (m: Parameters<BarLake['writeManifest']>[0]) => this.lake!.writeManifest(m) } : {}),
      onEvent: (e) => {
        this.db.ops.log('system', `model.${e.kind}`, { version: e.version, timeframe: e.timeframe, detail: e.detail }, this.now());
        if (e.kind === 'promoted') this.alerts.raise({ key: `model_promoted:${e.version}`, severity: 'info', title: `Model ${e.version} is now active (${e.timeframe})`, detail: e.detail }, this.now());
        this.emit({ type: 'status' });
      },
    });
    const execTf = (): Timeframe => this.smallestTf();
    this.paperSim = new PaperBroker({ account: 'paper', db: this.db, config: () => this.config(), now: this.now, execTimeframe: execTf });
    this.shadowSim = new PaperBroker({ account: 'shadow', db: this.db, config: () => this.config(), now: this.now, execTimeframe: execTf });
    this.oms = new Oms({
      db: this.db,
      broker: (a) => this.broker(a),
      config: () => this.config(),
      now: this.now,
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      onEvent: (e) => {
        if (e.type === 'order') {
          this.emit({ type: 'order', order: e.order });
          this.metrics.inc('trader_orders_total', { status: e.order.status });
          if (e.order.slippageBps !== null) this.metrics.observe('trader_slippage_bps', e.order.slippageBps, { account: e.order.account });
          if (e.order.status === 'filled' || e.order.status === 'partially_filled') this.metrics.observe('trader_fill_latency_ms', Math.max(0, e.order.updatedAt - e.order.createdAt));
        } else if (e.type === 'trade_opened') this.emit({ type: 'trade', trade: e.trade, event: 'opened' });
        else if (e.type === 'trade_closed') this.emit({ type: 'trade', trade: e.trade, event: 'closed' });
        else if (e.type === 'strategy_retired') this.alerts.raise({ key: `strategy_retired:${e.name}`, severity: 'info', title: `Strategy "${e.name}" retired`, detail: `Negative expectancy: ${e.detail}` }, this.now());
      },
    });
    this.kill = new KillSwitch({
      db: this.db,
      oms: this.oms,
      accounts: () => (this.mode() === 'live' ? ['live', 'shadow', 'paper'] : ['paper']),
      broker: (a) => this.broker(a),
      now: this.now,
    });
    this.llm = new TraderLlm({
      provider: deps.provider,
      config: () => this.config(),
      fallbackModels: () => this.fallbackModels(),
      now: this.now,
      onUsage: (u) => {
        if (u.ok) deps.recordGlobalUsage?.({ chatId: 'trader', agentId: 'trader:llm', model: u.model, promptTokens: u.inputTokens, completionTokens: u.outputTokens });
      },
    });
    this.alerts = new AlertEngine(this.db, (a) => this.deliverAlert(a));
    this.graph = new TraderGraph({
      db: this.db,
      config: () => this.config(),
      now: this.now,
      pipeline: this.pipeline,
      registry: this.registry,
      risk: this.risk,
      oms: this.oms,
      llm: this.llm,
      metrics: this.metrics,
      alerts: this.alerts,
      mode: () => this.mode(),
      account: () => this.activeAccount(),
      broker: (a) => this.broker(a),
      portfolio: (a) => this.portfolioState(a),
      guards: () => {
        const k = this.kill.state();
        const b = this.breaker();
        return {
          killActive: k.active,
          killReason: k.reason,
          consent: this.consented(),
          breakerTripped: b !== null,
          breakerReason: b?.reason ?? null,
          liveAllowed: this.liveAllowed(),
        };
      },
      tripBreaker: (reason) => this.tripBreaker(reason),
      checkBreaker: (a) => this.checkBreaker(a),
      emit: (e) => this.emit(e),
      ...(deps.news ? { news: deps.news } : {}),
      ...(deps.skipIngest ? { skipIngest: true } : {}),
    });
    this.runner = new BacktestRunner({
      db: this.db,
      config: () => this.config(),
      strategies: () => this.db.runs.strategies('active'),
      reportsDir: deps.dataDir ? join(deps.dataDir, 'reports') : null,
      now: this.now,
    });
    this.scheduler = new TraderScheduler({
      db: this.db,
      config: () => this.config(),
      now: this.now,
      autopilot: () => this.autopilot(),
      anyMarketOpen: () => this.anyMarketOpen(),
      tick: () => this.runTick('schedule'),
      reconcile: () => this.reconcileOnly(),
      retrain: (kind) => this.retrainAll(kind),
      dailyReview: (a, b, day) => this.dailyReview(a, b, day),
      housekeeping: () => this.housekeeping(),
      log: (m) => console.warn(m),
    });
    this.metricsServer = new MetricsServer(
      () => this.metrics.prometheus(),
      () => ({ mode: this.mode(), autopilot: this.autopilot(), version: TRADER_VERSION }),
    );
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    const now = this.now();
    this.db.runs.recoverInterrupted(now);
    this.db.runs.recoverBacktests(now);
    if (this.db.ops.config().version === 0) this.db.ops.saveConfig(traderConfigSchema.parse({}), 'defaults', 'system', now);
    const imported = importLegacy(this.db, now);
    if (imported.strategies || imported.trades) {
      this.db.ops.log('system', 'legacy.import', imported, now);
    }
    // Pre-2.0 users with live keys get them moved to the live slot; the paper slot keeps paper keys.
    if (this.deps.settings.get('alpaca_paper') === '0' && this.creds('paper') && !this.creds('live')) {
      const c = this.creds('paper')!;
      this.deps.settings.set(TRADER_SECRET_KEYS.live.keyId, c.keyId);
      this.deps.settings.set(TRADER_SECRET_KEYS.live.secret, c.secret);
      this.deps.settings.set(TRADER_SECRET_KEYS.paper.keyId, '');
      this.deps.settings.set(TRADER_SECRET_KEYS.paper.secret, '');
      this.deps.settings.set('alpaca_paper', '1');
      this.db.ops.log('system', 'credentials.migrated', { from: 'paper slot', to: 'live slot' }, now);
    }
    this.db.oms.simAccount('paper', this.config().execution.paperStartingCash, now);
    try {
      this.defaultModel = (await this.deps.provider.listModels())[0]?.name ?? '';
    } catch {
      this.defaultModel = '';
    }
    await this.metricsServer.ensure(this.config().monitor.metricsHttpPort).catch((err) => console.warn('[trader] metrics endpoint:', err));
  }

  start(): void {
    this.scheduler.start();
  }

  async stop(): Promise<void> {
    this.scheduler.stop();
    await this.metricsServer.stop();
  }

  // ── state ─────────────────────────────────────────────────────────────────

  config(): TraderConfig {
    const latest = this.db.ops.config();
    if (!this.cachedConfig || this.cachedConfig.version !== latest.version) this.cachedConfig = latest;
    return this.cachedConfig.config;
  }

  private smallestTf(): Timeframe {
    const tfs = this.config().models.specs.filter((s) => s.enabled).map((s) => s.timeframe);
    return [...tfs].sort((a, b) => TIMEFRAME_MS[a] - TIMEFRAME_MS[b])[0] ?? '15m';
  }

  private fallbackModels(): string[] {
    const chain = (this.deps.settings.get('model_fallback_chain') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return [...new Set([...chain, this.deps.settings.get('orchestrator_model') ?? '', this.defaultModel].filter(Boolean))];
  }

  liveBuildEnabled(): boolean {
    return this.deps.liveBuildEnabled ?? LIVE_TRADING_BUILD_ENABLED;
  }

  consented(): boolean {
    return this.db.ops.get<{ accepted: boolean } | null>('consent', null)?.accepted === true;
  }

  autopilot(): boolean {
    return this.db.ops.get<boolean>('autopilot', false);
  }

  paperVenue(): 'simulator' | 'alpaca_paper' {
    return this.db.ops.get<'simulator' | 'alpaca_paper'>('paper_venue', 'simulator');
  }

  mode(): TradingMode {
    return this.db.ops.get<TradingMode>('mode', 'paper') === 'live' && this.liveAllowed() ? 'live' : 'paper';
  }

  activeAccount(): AccountKind {
    return this.mode() === 'live' ? 'live' : 'paper';
  }

  liveAllowed(): boolean {
    return this.liveBuildEnabled() && this.goLive().ready;
  }

  breaker(): BreakerState | null {
    const b = this.db.ops.get<BreakerState | null>('breaker', null);
    return b && b.date === etParts(this.now()).date ? b : null;
  }

  private tripBreaker(reason: string): void {
    if (this.breaker()) return;
    const now = this.now();
    this.db.ops.set('breaker', { date: etParts(now).date, reason: reason.slice(0, 500), at: now }, now);
    this.db.ops.log('system', 'breaker.trip', { reason }, now);
    this.alerts.raise({ key: 'circuit_breaker', severity: 'critical', title: 'Circuit breaker tripped — new entries halted for today', detail: reason }, now);
    this.emit({ type: 'status' });
  }

  /** Trip the breaker when today's loss (realized + unrealized) reaches the limit. */
  async checkBreaker(account: AccountKind): Promise<void> {
    if (this.breaker()) return;
    try {
      const st = await this.portfolioState(account);
      const base = st.dayStartEquity > 0 ? st.dayStartEquity : st.equity;
      const loss = Math.max(0, base - st.equity);
      const limit = (this.config().risk.dailyLossLimitPct / 100) * base;
      if (base > 0 && loss >= limit) {
        this.tripBreaker(`daily loss ${loss.toFixed(2)} ≥ ${this.config().risk.dailyLossLimitPct}% of start-of-day equity (${limit.toFixed(2)})`);
      }
    } catch {
      // no broker → nothing at risk
    }
  }

  anyMarketOpen(): boolean {
    const now = this.now();
    const cfg = this.config();
    return universeOf(cfg).some((s) => isMarketOpen(assetClassOf(s), now, cfg.schedule.extendedHours));
  }

  // ── credentials + brokers ────────────────────────────────────────────────

  creds(slot: CredentialSlot): { keyId: string; secret: string } | null {
    const k = TRADER_SECRET_KEYS[slot];
    const keyId = this.deps.settings.get(k.keyId) ?? '';
    const secret = this.deps.settings.get(k.secret) ?? '';
    return keyId && secret ? { keyId, secret } : null;
  }

  private alpaca(account: 'paper' | 'live'): BrokerAdapter | null {
    const c = this.creds(account);
    if (!c) return null;
    const key = `${account}:${c.keyId}`;
    let b = this.alpacaCache.get(key);
    if (!b) {
      b = this.deps.alpacaFactory ? this.deps.alpacaFactory(account, c) : new AlpacaBroker(account, c, this.fetchFn);
      this.alpacaCache.set(key, b);
    }
    return b;
  }

  broker(account: AccountKind): BrokerAdapter | null {
    if (account === 'shadow') return this.shadowSim;
    if (account === 'paper') return this.paperVenue() === 'alpaca_paper' ? this.alpaca('paper') ?? this.paperSim : this.paperSim;
    // Live adapters exist only when every gate is green.
    return this.liveAllowed() ? this.alpaca('live') : null;
  }

  // ── portfolio ────────────────────────────────────────────────────────────

  async portfolioState(account: AccountKind): Promise<PortfolioState> {
    const broker = this.broker(account);
    if (!broker) throw new TraderRpcError('unavailable', `no broker for the ${account} account`);
    const [acct, positions] = await Promise.all([broker.getAccount(), broker.getPositions()]);
    const now = this.now();
    const day = this.db.ledger.dayStats(account, now);
    const p = etParts(now);
    const dayStartTs = etToUtc(p.y, p.m, p.d, 0, 0);
    const unrealized = positions.reduce((a, x) => a + (x.lastPrice - x.avgPrice) * x.qty, 0);
    return {
      equity: acct.equity,
      cash: acct.cash,
      peakEquity: Math.max(this.db.ops.peakEquity(account), acct.equity),
      dayStartEquity: this.db.ops.equityAt(account, dayStartTs) ?? acct.equity - unrealized - day.realizedToday,
      realizedToday: day.realizedToday,
      unrealized,
      openedToday: day.openedToday,
      lossStreak: day.lossStreak,
      positions: positions.map((x) => ({ symbol: x.symbol, qty: x.qty, avgPrice: x.avgPrice, lastPrice: x.lastPrice })),
      pendingEntries: this.db.oms
        .openOrders(account)
        .filter((o) => o.role === 'entry')
        .map((o) => ({ symbol: o.symbol, side: o.side === 'buy' ? 'long' : 'short', qty: o.qty - o.filledQty, price: o.assumedPrice ?? o.limitPrice ?? 0 })),
    };
  }

  async portfolio(account: AccountKind, curveDays = 30): Promise<PortfolioDto> {
    const now = this.now();
    const mode = this.mode();
    try {
      const st = await this.portfolioState(account);
      this.recordEquity(account, st.equity, st.cash, true);
      const trades = this.db.ledger.openTrades(account);
      const positions: PositionDto[] = st.positions.map((x) => {
        const t = trades.find((tr) => tr.symbol === x.symbol);
        const mv = x.qty * x.lastPrice;
        return {
          account,
          symbol: x.symbol,
          qty: x.qty,
          avgPrice: x.avgPrice,
          lastPrice: x.lastPrice,
          marketValue: mv,
          unrealizedPnl: (x.lastPrice - x.avgPrice) * x.qty,
          unrealizedPnlPct: x.avgPrice > 0 ? ((x.lastPrice - x.avgPrice) / x.avgPrice) * 100 * Math.sign(x.qty) : 0,
          stop: t?.stop ?? null,
          takeProfit: t?.takeProfit ?? null,
          openedAt: t?.openedAt ?? null,
          tradeId: t?.id ?? null,
        };
      });
      const gross = positions.reduce((a, x) => a + Math.abs(x.marketValue), 0);
      const net = positions.reduce((a, x) => a + x.marketValue, 0);
      return {
        account,
        mode,
        equity: st.equity,
        cash: st.cash,
        buyingPower: st.cash,
        grossExposure: gross,
        grossExposurePct: st.equity > 0 ? (gross / st.equity) * 100 : 0,
        netExposure: net,
        dailyPnl: st.equity - st.dayStartEquity,
        realizedToday: st.realizedToday,
        unrealized: st.unrealized,
        peakEquity: st.peakEquity,
        drawdownPct: st.peakEquity > 0 ? ((st.peakEquity - st.equity) / st.peakEquity) * 100 : 0,
        positions,
        equityCurve: this.db.ops.equityCurve(account, now - curveDays * 86_400_000),
        asOf: now,
      };
    } catch (err) {
      return {
        account,
        mode,
        equity: 0,
        cash: 0,
        buyingPower: 0,
        grossExposure: 0,
        grossExposurePct: 0,
        netExposure: 0,
        dailyPnl: 0,
        realizedToday: 0,
        unrealized: 0,
        peakEquity: 0,
        drawdownPct: 0,
        positions: [],
        equityCurve: this.db.ops.equityCurve(account, now - curveDays * 86_400_000),
        asOf: now,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private recordEquity(account: AccountKind, equity: number, cash: number, throttle: boolean): void {
    const now = this.now();
    const last = this.lastEquityAt.get(account) ?? 0;
    if (throttle && now - last < 60_000) return;
    this.lastEquityAt.set(account, now);
    this.db.ops.recordEquity(account, now, equity, cash);
    this.emit({ type: 'equity', account, ts: now, equity });
  }

  private async updateGauges(): Promise<void> {
    const account = this.activeAccount();
    try {
      const st = await this.portfolioState(account);
      this.recordEquity(account, st.equity, st.cash, false);
      if (this.mode() === 'live') {
        const sh = await this.portfolioState('shadow').catch(() => null);
        if (sh) this.recordEquity('shadow', sh.equity, sh.cash, false);
      }
      const gross = st.positions.reduce((a, x) => a + Math.abs(x.qty * x.lastPrice), 0);
      this.metrics.set('trader_equity', st.equity, { account });
      this.metrics.set('trader_daily_pnl', st.equity - st.dayStartEquity, { account });
      this.metrics.set('trader_gross_exposure_pct', st.equity > 0 ? (gross / st.equity) * 100 : 0, { account });
      this.metrics.set('trader_open_positions', st.positions.length, { account });
      const fs = this.db.oms.fillStats(this.now() - 86_400_000);
      const denom = fs.filled + fs.failed;
      if (denom > 0) this.metrics.set('trader_order_success_ratio', fs.filled / denom);
      this.db.ops.recordSamples(this.metrics.samples(), this.now());
    } catch {
      // no broker yet — nothing to gauge
    }
  }

  // ── ticks ────────────────────────────────────────────────────────────────

  async runTick(trigger: 'schedule' | 'manual' | 'agent', advisoryOverride?: boolean): Promise<import('@shared/trader/types').CycleDto | null> {
    if (this.tickRunning) throw new TraderRpcError('conflict', 'a trading cycle is already running');
    this.tickRunning = true;
    try {
      const advisory = advisoryOverride === true || !this.autopilot();
      const cycle = await this.graph.runTick({ trigger, advisory });
      await this.updateGauges();
      return cycle;
    } finally {
      this.tickRunning = false;
    }
  }

  private async reconcileOnly(): Promise<void> {
    const accounts: AccountKind[] = this.mode() === 'live' ? ['live', 'shadow'] : ['paper'];
    const errors: string[] = [];
    for (const a of accounts) {
      const r = await this.oms.reconcile(a);
      errors.push(...r.errors);
    }
    if (errors.length) this.alerts.raise({ key: 'broker_errors', severity: 'warning', title: 'Broker reconciliation errors', detail: errors.slice(0, 5).join(' | ') }, this.now());
    await this.updateGauges();
  }

  private async retrainAll(kind: 'full' | 'incremental'): Promise<void> {
    const cfg = this.config();
    for (const spec of cfg.models.specs.filter((s) => s.enabled)) {
      const k = kind === 'incremental' && !this.db.models.active(spec.timeframe) ? 'full' : kind;
      try {
        await this.pipeline.ingest({ symbols: universeOf(cfg), timeframe: spec.timeframe });
        await this.registry.train(spec, universeOf(cfg), k, (m) => this.emit({ type: 'train', timeframe: spec.timeframe, message: m }));
      } catch (err) {
        this.db.ops.log('system', 'model.train_failed', { timeframe: spec.timeframe, kind: k, error: err instanceof Error ? err.message : String(err) }, this.now());
      }
    }
  }

  private async dailyReview(dayStart: number, dayEnd: number, day: string): Promise<void> {
    const evals = this.registry.evaluateShadowDay(dayStart, dayEnd, day);
    const actions = this.registry.applyPolicy();
    this.db.ops.log('system', 'models.daily_review', { day, evals: evals.length, actions }, this.now());
  }

  private async housekeeping(): Promise<void> {
    const now = this.now();
    this.pipeline.prune(now);
    this.db.ops.pruneMetrics(now - LIMITS.metricsRetentionMs);
    this.db.runs.pruneCycles(now - LIMITS.cyclesRetentionMs);
    this.db.models.pruneShadowScores(now - 45 * 86_400_000);
    this.paperSim.prune(now - 30 * 86_400_000);
    this.shadowSim.prune(now - 30 * 86_400_000);
  }

  // ── alerts / events ──────────────────────────────────────────────────────

  private emit(e: TraderEvent): void {
    try {
      this.deps.broadcast?.(e);
    } catch {
      // renderer gone — ignore
    }
  }

  private deliverAlert(a: AlertDto): void {
    this.emit({ type: 'alert', alert: a });
    if (a.severity !== 'info') this.deps.desktopNotify?.(`AI Trader: ${a.title}`, a.detail.slice(0, 200));
    const url = this.config().monitor.webhookUrl;
    if (url) {
      void this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'flowstate-ai-trader', key: a.key, severity: a.severity, title: a.title, detail: a.detail, at: new Date(a.createdAt).toISOString() }),
      }).catch(() => undefined);
    }
  }

  // ── go-live ──────────────────────────────────────────────────────────────

  goLive(): GoLiveDto {
    const now = this.now();
    const cfg = this.config();
    const paperCurve = this.db.ops.equityCurve('paper', 0, 5000);
    const paperClosed = this.db.ledger.closedStats('paper');
    const first = [this.db.ops.firstEquityTs('paper'), paperClosed.firstOpenedAt].filter((x): x is number => x !== null);
    return goLiveChecklist({
      buildFlag: this.liveBuildEnabled(),
      consent: this.consented(),
      paper: {
        firstActivityTs: first.length ? Math.min(...first) : null,
        closedTrades: paperClosed.closed,
        maxDrawdownPct: maxDrawdownPct(paperCurve.map((p) => p.equity)),
      },
      risk: cfg.risk,
      killTestedAt: this.db.ops.get<number | null>('kill_tested_at', null),
      keys: {
        dataKeyId: this.creds('data')?.keyId ?? null,
        liveKeyId: this.creds('live')?.keyId ?? null,
        liveVerifiedAt: this.db.ops.get<number | null>('cred_verified:live', null),
      },
      live: this.db.ops.get<TradingMode>('mode', 'paper') === 'live',
      now,
    });
  }

  // ── status ───────────────────────────────────────────────────────────────

  async status(): Promise<TraderStatusDto> {
    const now = this.now();
    const k = this.kill.state();
    const b = this.breaker();
    const mode = this.mode();
    let market: TraderStatusDto['market'] = { open: isMarketOpen('us_equity', now), nextOpen: calNextOpen(now), nextClose: currentClose(now), source: 'calendar' };
    const broker = this.broker(this.activeAccount());
    if (broker && broker.name.startsWith('alpaca')) {
      const clock = await broker.getClock().catch(() => null);
      if (clock) market = { open: clock.isOpen, nextOpen: clock.nextOpen, nextClose: clock.nextClose, source: 'broker' };
    }
    const active: TraderStatusDto['activeModels'] = [];
    for (const tf of TIMEFRAMES) {
      const m = this.db.models.active(tf);
      if (m) active.push({ timeframe: tf, version: m.version });
    }
    return {
      mode,
      autopilot: this.autopilot(),
      consentAccepted: this.consented(),
      liveBuildEnabled: this.liveBuildEnabled(),
      kill: { active: k.active, mode: k.mode, at: k.at, reason: k.reason },
      breaker: { tripped: b !== null, at: b?.at ?? null, reason: b?.reason ?? null },
      brokerConnected: broker !== null,
      dataSource: this.pipeline.source(),
      market,
      lastCycle: this.db.runs.lastCycle(),
      nextTickAt: this.autopilot() ? this.scheduler.nextTickAt(now) : null,
      running: this.tickRunning,
      activeModels: active,
      openAlerts: this.db.ops.openAlertCount(),
      configVersion: this.db.ops.config().version,
      version: TRADER_VERSION,
    };
  }

  // ── RPC ──────────────────────────────────────────────────────────────────

  async handle<M extends TraderMethod>(method: M, rawParams: unknown, actor: 'user' | 'agent' = 'user'): Promise<TraderResponses[M]> {
    const schema = traderRequestSchemas[method];
    if (!schema) throw new TraderRpcError('bad_request', `unknown method ${String(method)}`);
    let params: TraderParsed<M>;
    try {
      params = schema.parse(rawParams ?? {}) as TraderParsed<M>;
    } catch (err) {
      if (err instanceof ZodError) {
        throw new TraderRpcError('bad_request', err.errors.map((e) => `${e.path.join('.') || 'params'}: ${e.message}`).join('; '), err.errors);
      }
      throw err;
    }
    const result = (await this.dispatch(method, params as never)) as TraderResponses[M];
    if (MUTATING.has(method)) {
      const { secret: _s, keyId: _k, ...rest } = params as Record<string, unknown>;
      this.db.ops.log(actor, method, method === 'config.update' ? { note: (rest as { note?: string }).note ?? '' } : rest, this.now());
      if (method !== 'alerts.ack') this.emit({ type: 'status' });
    }
    return result;
  }


  private async dispatch(method: TraderMethod, p: Record<string, any>): Promise<unknown> {
    const db = this.db;
    const now = this.now();
    switch (method) {
      case 'status':
        return this.status();

      case 'autopilot.set': {
        if (p.enabled) {
          if (!this.consented()) return { autopilot: false, error: 'Accept the risk disclosure first.' };
          if (this.kill.state().active) return { autopilot: false, error: 'The kill switch is engaged — resume first.' };
        }
        db.ops.set('autopilot', Boolean(p.enabled), now);
        return { autopilot: this.autopilot() };
      }

      case 'consent.accept': {
        if (String(p.text).trim().toUpperCase() !== CONSENT_PHRASE) return { accepted: false, error: `Type "${CONSENT_PHRASE}" to accept.` };
        db.ops.set('consent', { accepted: true, at: now }, now);
        return { accepted: true };
      }

      case 'config.get': {
        const c = db.ops.config();
        return { config: c.config, version: c.version, universe: universeOf(c.config) };
      }
      case 'config.update': {
        const config = traderConfigSchema.parse(p.config);
        const version = db.ops.saveConfig(config, p.note ?? '', 'user', now);
        this.cachedConfig = null;
        await this.metricsServer.ensure(config.monitor.metricsHttpPort).catch((err) => {
          throw new TraderRpcError('unavailable', `saved, but the metrics endpoint could not start: ${err instanceof Error ? err.message : String(err)}`);
        });
        return { config, version };
      }
      case 'config.history':
        return { versions: db.ops.configHistory(p.limit ?? 50) };
      case 'assets': {
        const cfg = this.config();
        const map = new Map<string, { groups: string[]; enabled: boolean }>();
        for (const g of cfg.symbolGroups) {
          for (const s of g.symbols) {
            const v = map.get(s) ?? { groups: [], enabled: false };
            v.groups.push(g.name);
            v.enabled = v.enabled || g.enabled;
            map.set(s, v);
          }
        }
        return {
          assets: [...map.entries()].map(([symbol, v]) => ({ symbol, assetClass: assetClassOf(symbol), sector: cfg.sectors[symbol] ?? 'unknown', groups: v.groups, enabled: v.enabled })),
          timeframes: [...TIMEFRAMES],
          dataSource: this.pipeline.source(),
        };
      }

      case 'portfolio':
        return this.portfolio(p.account ?? this.activeAccount(), p.curveDays ?? 30);
      case 'orders.list':
        return {
          orders: db.oms.listOrders({
            ...(p.account ? { account: p.account } : {}),
            ...(p.open ? { status: ['new', 'submitted', 'partially_filled'] } : {}),
            limit: p.limit ?? 200,
          }),
        };
      case 'equity.csv': {
        const curve = db.ops.equityCurve(p.account ?? this.activeAccount(), now - (p.days ?? 30) * 86_400_000, 100_000);
        return { csv: ['ts,iso,equity', ...curve.map((e) => `${e.ts},${new Date(e.ts).toISOString()},${e.equity.toFixed(2)}`)].join('\n') + '\n' };
      }
      case 'fills.list':
        return { fills: db.oms.listFills({ ...(p.account ? { account: p.account } : {}), limit: p.limit ?? 200 }) };
      case 'signals.list': {
        const since = p.since === 'all' ? undefined : p.since === 'week' ? now - 7 * 86_400_000 : etToUtc(etParts(now).y, etParts(now).m, etParts(now).d, 0, 0);
        return { signals: db.signals.list({ ...(since !== undefined ? { since } : {}), ...(p.status ? { status: p.status } : {}), limit: p.limit ?? 300 }) };
      }
      case 'signals.execute':
        return this.executeSignal(p.signalId as string);
      case 'signals.dismiss':
        return { ok: db.signals.transition(p.signalId, ['proposed'], 'expired', now, 'dismissed by the user') };
      case 'trades.list':
        return {
          trades: db.ledger.list({ ...(p.account ? { account: p.account } : {}), ...(p.status ? { status: p.status } : {}), limit: p.limit ?? 200 }),
          lessons: db.ledger.recentLessons(10),
        };
      case 'audit.get': {
        const signal = p.signalId ? db.signals.get(p.signalId) : null;
        const trade = p.tradeId ? db.ledger.get(p.tradeId) : signal ? db.ledger.bySignal(signal.id) : null;
        const a = db.ledger.auditFor(p.signalId ? { signalId: p.signalId } : trade?.signalId ? { signalId: trade.signalId } : { tradeId: p.tradeId ?? '' });
        const sigId = signal?.id ?? trade?.signalId ?? a?.signalId ?? null;
        const orders = sigId ? db.oms.ordersForSignal(sigId) : [];
        const exitOrders = trade ? db.oms.listOrders({ account: trade.account, limit: 500 }).filter((o) => o.tradeId === trade.id && o.role !== 'entry') : [];
        const allOrders = [...orders, ...exitOrders.filter((o) => !orders.some((x) => x.id === o.id))];
        return {
          audit: a ? { ...a, orderIds: a.rawOrderIds, fills: db.oms.fillsFor(allOrders.map((o) => o.id)) } : null,
          signal: signal ?? (sigId ? db.signals.get(sigId) : null),
          trade,
          orders: allOrders,
        };
      }
      case 'cycles.list':
        return { cycles: db.runs.cycles(p.limit ?? 50, { excludeSkipped: !p.includeSkipped }) };
      case 'cycles.run': {
        try {
          return { cycle: await this.runTick('manual', p.advisory === true) };
        } catch (err) {
          return { cycle: null, error: err instanceof Error ? err.message : String(err) };
        }
      }

      case 'kill': {
        const r = await this.kill.engage(p.mode, p.reason ?? 'manual kill switch', 'user');
        db.ops.set('autopilot', false, now);
        if (this.mode() === 'paper') db.ops.set('kill_tested_at', now, now);
        this.alerts.raise({ key: 'kill_switch', severity: 'critical', title: `Kill switch engaged (${p.mode})`, detail: `${r.canceled} order(s) canceled, ${r.flattened.length} position(s) flattened${r.errors.length ? `; errors: ${r.errors.join(' | ')}` : ''}` }, now, 0);
        await this.updateGauges();
        return { active: true, mode: p.mode, canceled: r.canceled, flattened: r.flattened, errors: r.errors, ms: r.ms };
      }
      case 'resume':
        return { active: this.kill.resume('user').active };
      case 'killswitch.test': {
        if (this.mode() !== 'paper') return { ok: false, error: 'Test the kill switch in paper mode.', active: false, mode: null, canceled: 0, flattened: [], errors: [], ms: 0 };
        const r = await this.kill.engage('halt', 'kill switch test', 'user');
        const open = db.oms.openOrders('paper').length;
        const halted = this.kill.state().active;
        this.kill.resume('system');
        const ok = halted && open === 0 && r.errors.length === 0;
        if (ok) db.ops.set('kill_tested_at', now, now);
        return { ok, ...(ok ? {} : { error: `halted=${halted}, open orders after cancel=${open}, errors=${r.errors.join('; ')}` }), active: false, mode: 'halt', canceled: r.canceled, flattened: [], errors: r.errors, ms: r.ms };
      }
      case 'positions.close': {
        try {
          const order = await this.oms.closePosition(p.account ?? this.activeAccount(), p.symbol, 'closed manually by the user');
          return order ? { ok: true, order } : { ok: false, error: `no open position in ${p.symbol}` };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      case 'paper.reset': {
        if (this.paperVenue() !== 'simulator') throw new TraderRpcError('forbidden', 'only the simulator account can be reset');
        await this.paperSim.cancelAll();
        for (const t of db.ledger.openTrades('paper')) db.ledger.cancelTrade(t.id, 'paper account reset', now);
        const cash = this.config().execution.paperStartingCash;
        db.oms.resetSimAccount('paper', cash, now);
        db.ops.resetEquity('paper');
        return { ok: true, cash };
      }
      case 'venue.set': {
        if (p.paperVenue === 'alpaca_paper' && !this.creds('paper')) return { paperVenue: this.paperVenue(), error: 'Add Alpaca paper keys first.' };
        db.ops.set('paper_venue', p.paperVenue, now);
        return { paperVenue: this.paperVenue() };
      }

      case 'paperSimulate': {
        const active = this.registry.active();
        const tf = this.baseTimeframe(active);
        if (!tf) return { report: null, error: 'No active model — train one first.' };
        const days = p.days ?? 1;
        const from = this.sessionStartDaysAgo(days);
        try {
          const { report } = this.runner.run({ kind: 'simulation', label: `Simulation · last ${days} session(s)`, timeframe: tf, symbols: universeOf(this.config()), from, to: now, predictors: active });
          return { report };
        } catch (err) {
          return { report: null, error: err instanceof Error ? err.message : String(err) };
        }
      }
      case 'backtests.run': {
        const predictors = this.registry.active();
        if (p.modelVersion) {
          const m = db.models.get(p.modelVersion);
          if (!m) return { report: null, error: `unknown model ${p.modelVersion}` };
          predictors.set(m.timeframe, this.registry.predictor(m));
        }
        if (!predictors.has(p.timeframe)) return { report: null, error: `No model for ${p.timeframe} — train one or pick a model version.` };
        try {
          const { report } = this.runner.run({
            kind: p.kind,
            ...(p.label ? { label: p.label } : {}),
            timeframe: p.timeframe,
            symbols: p.symbols?.length ? p.symbols : universeOf(this.config()),
            from: now - p.days * 86_400_000,
            to: now,
            predictors,
          });
          return { report };
        } catch (err) {
          return { report: null, error: err instanceof Error ? err.message : String(err) };
        }
      }
      case 'backtests.list':
        return { backtests: db.runs.backtests(p.limit ?? 50) };
      case 'report.get': {
        const bt = db.runs.backtest(p.id);
        if (!bt) return { report: null };
        const body = readReport(bt.reportPath);
        return { report: { ...bt, config: body?.config ?? bt.config, trades: body?.trades ?? [], equity: body?.equity ?? [], rejected: body?.rejected ?? [] } };
      }

      case 'models.list':
        return {
          models: db.models.list({ ...(p.timeframe ? { timeframe: p.timeframe } : {}), limit: 100 }).map(toModelDto),
          training: TIMEFRAMES.filter((tf) => this.registry.isTraining(tf)),
        };
      case 'models.train': {
        const spec = this.config().models.specs.find((s) => s.timeframe === p.timeframe) ?? { timeframe: p.timeframe as Timeframe, horizonBars: 4, enabled: true };
        try {
          const { model, action } = await this.registry.train(spec, universeOf(this.config()), p.kind ?? 'full', (m) => this.emit({ type: 'train', timeframe: spec.timeframe, message: m }));
          this.emit({ type: 'train', timeframe: spec.timeframe, message: `${action}: ${model.version}`, done: true });
          return { model: toModelDto(model), action };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.emit({ type: 'train', timeframe: spec.timeframe, message: msg, done: true });
          return { model: null, action: null, error: msg };
        }
      }
      case 'models.promote': {
        if (String(p.confirm).trim().toUpperCase() !== TYPED_PROMOTE_CONFIRMATION) return { model: null, error: `Type ${TYPED_PROMOTE_CONFIRMATION} to promote manually.` };
        if (this.mode() === 'live') return { model: null, error: 'Manual promotion is only allowed in paper mode; in live mode models must pass the shadow gate.' };
        const m = db.models.get(p.version);
        if (!m) return { model: null, error: 'unknown model' };
        const promoted = this.registry.promote(p.version, 'user', m.metrics.passed ? 'manual promotion' : `manual promotion despite: ${m.metrics.reasons.join('; ')}`);
        return { model: promoted ? toModelDto(promoted) : null };
      }
      case 'models.retire':
        db.models.setStatus(p.version, 'retired', now, 'retired by the user');
        return { ok: true };
      case 'models.shadowCompare':
        return this.shadowCompare(p.version, p.days);
      case 'models.shadowEvals':
        return { evals: db.models.shadowEvals(p.version, 60) };

      case 'data.ingest': {
        const r = await this.pipeline.ingest({ symbols: p.symbols?.length ? p.symbols : universeOf(this.config()), timeframe: p.timeframe, days: p.days });
        if (r.issues.length) this.alerts.raise({ key: 'data_validation', severity: 'info', title: `${r.issues.length} data validation issue(s)`, detail: r.issues.slice(0, 8).map((i) => `${i.symbol} ${i.kind}: ${i.detail}`).join(' | ') }, now);
        return { stored: r.stored, source: r.source, errors: r.errors, issues: r.issues.length, ms: r.ms };
      }
      case 'data.coverage': {
        // Same session-aware staleness the risk engine uses (time past the due bar close).
        const gap = this.config().monitor.dataGapMs;
        return {
          coverage: db.market.coverage(now, (tf) => TIMEFRAME_MS[tf] + gap).map((c) => {
            const st = this.pipeline.staleness(c.symbol, c.timeframe, now);
            return { ...c, staleMs: st, stale: st !== null && st > gap };
          }),
        };
      }
      case 'data.issues':
        return { issues: db.market.issues(p.limit ?? 200) };

      case 'strategies.list':
        return { strategies: db.runs.strategies() };
      case 'strategies.save': {
        if (p.id) return { strategy: db.runs.updateStrategy(p.id, { name: p.name, description: p.description, inspiration: p.inspiration, params: p.params }, now) };
        return { strategy: db.runs.createStrategy({ name: p.name, description: p.description, inspiration: p.inspiration, params: p.params }, now) };
      }
      case 'strategies.setStatus':
        return { strategy: db.runs.updateStrategy(p.id, { status: p.status }, now) };

      case 'alerts.list':
        return { alerts: db.ops.alerts({ ...(p.open ? { open: true } : {}), limit: p.limit ?? 100 }) };
      case 'alerts.ack':
        return { acknowledged: db.ops.ackAlert(p.id, now) };
      case 'metrics.snapshot':
        return { ...this.metrics.snapshot(), series: this.metricSeries(now - (p.sinceHours ?? 48) * 3_600_000) };
      case 'metrics.prometheus':
        return { text: this.metrics.prometheus(), port: this.metricsServer.listening };
      case 'opslog.list':
        return { entries: db.ops.opsLog(p.limit ?? 100) };

      case 'credentials.status':
        return { credentials: CREDENTIAL_SLOTS.map((s) => this.credentialStatus(s)), paperVenue: this.paperVenue() };
      case 'credentials.save': {
        const slot = p.slot as CredentialSlot;
        const test = await this.testCredentials(slot, { keyId: p.keyId, secret: p.secret });
        if (!test.ok) return test;
        const k = TRADER_SECRET_KEYS[slot];
        this.deps.settings.set(k.keyId, p.keyId);
        this.deps.settings.set(k.secret, p.secret);
        db.ops.set(`cred_verified:${slot}`, now, now);
        this.alpacaCache.clear();
        return test;
      }
      case 'credentials.test': {
        const c = this.creds(p.slot);
        if (!c) return { ok: false, detail: 'not configured' };
        const r = await this.testCredentials(p.slot, c);
        db.ops.set(`cred_verified:${p.slot}`, r.ok ? now : null, now);
        return r;
      }
      case 'credentials.delete': {
        const k = TRADER_SECRET_KEYS[p.slot as CredentialSlot];
        this.deps.settings.set(k.keyId, '');
        this.deps.settings.set(k.secret, '');
        db.ops.set(`cred_verified:${p.slot}`, null, now);
        this.alpacaCache.clear();
        if (p.slot === 'paper' && this.paperVenue() === 'alpaca_paper') db.ops.set('paper_venue', 'simulator', now);
        if (p.slot === 'live') db.ops.set('mode', 'paper', now);
        return { ok: true };
      }

      case 'golive.checklist':
        return this.goLive();
      case 'golive.enable': {
        const checklist = this.goLive();
        if (String(p.confirm).trim() !== TYPED_LIVE_CONFIRMATION) return { live: false, error: `Type ${TYPED_LIVE_CONFIRMATION} to confirm.`, checklist };
        if (!checklist.ready) return { live: false, error: 'Every go-live checklist item must pass first.', checklist };
        db.ops.set('mode', 'live', now);
        db.ops.set('autopilot', false, now); // re-arm deliberately in live mode
        this.db.oms.resetSimAccount('shadow', this.config().execution.paperStartingCash, now);
        this.alerts.raise({ key: 'live_enabled', severity: 'critical', title: 'LIVE trading enabled', detail: 'Real money. The autopilot is off until you turn it on. The kill switch is on the Overview tab.' }, now, 0);
        return { live: true, checklist: this.goLive() };
      }
      case 'golive.disable':
        db.ops.set('mode', 'paper', now);
        db.ops.set('autopilot', false, now);
        return { live: false };
    }
    throw new TraderRpcError('bad_request', `unhandled method ${method}`);
  }

  private baseTimeframe(active: Map<Timeframe, Predictor>): Timeframe | null {
    return [...active.keys()].sort((a, b) => TIMEFRAME_MS[a] - TIMEFRAME_MS[b])[0] ?? null;
  }

  private sessionStartDaysAgo(days: number): number {
    const now = this.now();
    let found = 0;
    for (let i = 0; i < 20; i++) {
      const t = now - i * 86_400_000;
      const p = etParts(t);
      const open = etToUtc(p.y, p.m, p.d, 9, 30);
      if (p.weekday >= 1 && p.weekday <= 5 && open <= now) {
        found += 1;
        if (found >= days) return open;
      }
    }
    return now - days * 86_400_000;
  }

  private credentialStatus(slot: CredentialSlot): CredentialStatusDto {
    const c = this.creds(slot);
    return {
      slot,
      configured: c !== null,
      keyIdHint: c ? `${c.keyId.slice(0, 4)}…${c.keyId.slice(-2)}` : '',
      verifiedAt: c ? this.db.ops.get<number | null>(`cred_verified:${slot}`, null) : null,
    };
  }

  private async testCredentials(slot: CredentialSlot, c: { keyId: string; secret: string }): Promise<{ ok: boolean; detail: string }> {
    try {
      if (slot === 'data') {
        const provider = new AlpacaDataProvider(() => c, this.fetchFn);
        const now = this.now();
        const bars = await provider.fetchBars(['SPY'], '1d', now - 10 * 86_400_000, now);
        return { ok: true, detail: `market data OK (${bars.get('SPY')?.length ?? 0} SPY daily bars)` };
      }
      const broker = this.deps.alpacaFactory ? this.deps.alpacaFactory(slot, c) : new AlpacaBroker(slot, c, this.fetchFn);
      const a = await broker.getAccount();
      return { ok: true, detail: `${slot} account ${a.status}, equity $${a.equity.toFixed(2)}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async executeSignal(signalId: string): Promise<{ ok: boolean; order?: import('@shared/trader/types').OrderDto | null; reason?: string }> {
    const now = this.now();
    const sig = this.db.signals.get(signalId);
    if (!sig) return { ok: false, reason: 'unknown signal' };
    if (sig.status !== 'proposed') return { ok: false, reason: `signal is ${sig.status}` };
    if (!this.consented()) return { ok: false, reason: 'Accept the risk disclosure first.' };
    if (this.kill.state().active) return { ok: false, reason: 'The kill switch is engaged.' };
    if (this.breaker()) return { ok: false, reason: 'The circuit breaker tripped today — no new entries.' };
    const baseTf = (sig.features['base_timeframe'] as Timeframe | undefined) ?? (sig.timeframe === 'fused' ? '15m' : sig.timeframe);
    const cfg = this.config();
    if (now - sig.createdAt > cfg.signals.expiryBars * TIMEFRAME_MS[baseTf] + 5 * 60_000) {
      this.db.signals.transition(signalId, ['proposed'], 'expired', now, 'too old to execute');
      return { ok: false, reason: 'Signal is too old — its entry price is stale.' };
    }
    const account = this.activeAccount();
    const proposal: SignalProposal = {
      symbol: sig.symbol,
      side: sig.side,
      timeframe: sig.timeframe,
      baseTimeframe: baseTf,
      entry: sig.entry,
      stop: sig.stop,
      takeProfit: sig.takeProfit,
      confidence: sig.confidence,
      edgePct: sig.edgePct,
      horizonBars: 0,
      horizonMin: sig.horizonMin,
      maxHoldBars: typeof sig.features['max_hold_bars'] === 'number' ? (sig.features['max_hold_bars'] as number) : 0,
      atr: typeof sig.features['atr'] === 'number' ? (sig.features['atr'] as number) : sig.entry * 0.01,
      regime: String(sig.features['regime'] ?? 'unknown'),
      barTs: sig.barTs ?? sig.createdAt,
      modelVersion: sig.modelVersion,
      modelHash: typeof sig.features['model_hash'] === 'string' ? (sig.features['model_hash'] as string) : null,
      strategyId: sig.strategyId,
      strategyName: sig.strategyName,
      perTimeframe: sig.perTimeframe,
      features: sig.features,
      source: sig.source,
      ...(sig.source !== 'model' && sig.size > 0 ? { requestedSize: sig.size } : {}),
      drivers: '',
    };
    const stale = new Set<string>();
    const st = this.pipeline.staleness(sig.symbol, baseTf, now);
    if (st !== null && st > cfg.monitor.dataGapMs) stale.add(sig.symbol);
    const portfolio = await this.portfolioState(account);
    const decision = this.risk.evaluate(proposal, {
      config: cfg.risk,
      minConfidence: cfg.signals.perSymbolThreshold[sig.symbol] ?? cfg.signals.confidenceThreshold,
      maxTradesPerDay: cfg.risk.maxTradesPerDay,
      portfolio,
      market: liveMarketContext({ db: this.db, config: cfg, timeframe: baseTf, now, stale }),
    });
    if (decision.tripBreaker) this.tripBreaker(decision.reason);
    const auditId = this.db.ledger.insertAudit({
      signalId,
      cycleId: sig.cycleId,
      features: sig.features,
      modelVersion: sig.modelVersion,
      modelHash: proposal.modelHash,
      research: null,
      quant: { node: 'quant', ok: true, ms: 0, summary: `manual execution of a ${sig.source} signal`, data: { signal: { ...sig, features: undefined } } },
      risk: { allowed: decision.allowed, reason: decision.reason, suggestedSize: decision.suggestedSize, suggestedStop: decision.suggestedStop, suggestedTakeProfit: decision.suggestedTakeProfit, results: decision.results },
      approvalTs: decision.allowed ? now : null,
      now,
    });
    if (!decision.allowed) {
      this.db.signals.update(signalId, { status: 'rejected', reason: decision.reason.slice(0, 1000) }, now);
      return { ok: false, reason: decision.reason };
    }
    if (!this.db.signals.transition(signalId, ['proposed'], 'submitted', now)) return { ok: false, reason: 'signal changed state' };
    this.db.signals.update(signalId, { size: decision.suggestedSize, stop: decision.suggestedStop, takeProfit: decision.suggestedTakeProfit }, now);
    const res = await this.oms.submitEntry(
      {
        signalId,
        symbol: sig.symbol,
        side: sig.side,
        qty: decision.suggestedSize,
        entry: sig.entry,
        stop: decision.suggestedStop,
        takeProfit: decision.suggestedTakeProfit,
        timeframe: baseTf,
        maxHoldBars: proposal.maxHoldBars,
        expiresAt: now + cfg.signals.expiryBars * TIMEFRAME_MS[baseTf] + 60_000,
        modelVersion: sig.modelVersion,
        strategyId: sig.strategyId,
      },
      account,
    );
    this.db.ledger.updateAudit(auditId, {
      orderIds: res.order ? [res.order.id] : [],
      trader: { node: 'trader', ok: !res.error, ms: 0, summary: res.error ? `order failed: ${res.error}` : `order ${res.order?.id} submitted manually on ${account}` },
    });
    if (res.error) {
      this.db.signals.update(signalId, { status: 'failed', reason: res.error.slice(0, 1000) }, this.now());
      return { ok: false, order: res.order, reason: res.error };
    }
    return { ok: true, order: res.order };
  }

  /** Agent tool path: a proposal enters the same pipeline (schema → risk → trader) — never a direct order. */
  async proposeFromAgent(input: {
    symbol: string;
    side: 'long' | 'short';
    entry: number;
    stop: number;
    takeProfit: number;
    confidence: number;
    reason: string;
    qty?: number;
    strategyId?: string;
  }): Promise<{ signalId: string; status: string; reason: string | null }> {
    const now = this.now();
    const tf = this.smallestTf();
    const sig = this.db.signals.insert({
      cycleId: null,
      symbol: input.symbol,
      side: input.side,
      timeframe: tf,
      entry: input.entry,
      stop: input.stop,
      takeProfit: input.takeProfit,
      size: input.qty ?? 0,
      confidence: input.confidence,
      edgePct: 0,
      horizonMin: 0,
      modelVersion: null,
      strategyId: input.strategyId ?? null,
      source: 'agent',
      status: 'proposed',
      rationale: `Agent proposal: ${input.reason.slice(0, 1500)}`,
      perTimeframe: [],
      features: { base_timeframe: tf, max_hold_bars: 0, atr: Math.abs(input.entry - input.stop) / Math.max(0.3, this.config().risk.stopAtrMult) },
      barTs: null,
      now,
    });
    this.emit({ type: 'signal', signal: sig });
    this.db.ops.log('agent', 'signals.propose', { signalId: sig.id, symbol: input.symbol, side: input.side, confidence: input.confidence }, now);
    if (!this.autopilot()) return { signalId: sig.id, status: 'proposed', reason: 'autopilot is off — the proposal waits in Signals for the user to execute or dismiss' };
    const r = await this.executeSignal(sig.id);
    const after = this.db.signals.get(sig.id);
    return { signalId: sig.id, status: after?.status ?? 'unknown', reason: r.ok ? null : r.reason ?? null };
  }

  private async shadowCompare(version: string, days?: number): Promise<TraderResponses['models.shadowCompare']> {
    const cand = this.db.models.get(version);
    if (!cand) return { candidate: null, production: null, error: 'unknown model' };
    const active = this.db.models.active(cand.timeframe);
    const now = this.now();
    const from = days ? now - days * 86_400_000 : cand.metrics.testFrom ?? now - 30 * 86_400_000;
    const to = days ? now : cand.metrics.testTo ?? now;
    const symbols = universeOf(this.config());
    try {
      const candPreds = new Map<Timeframe, Predictor>([[cand.timeframe, this.registry.predictor(cand)]]);
      const candidate = this.runner.run({ kind: 'event', label: `shadow: candidate ${cand.version}`, timeframe: cand.timeframe, symbols, from, to, predictors: candPreds }).report;
      let production = null;
      if (active && active.version !== cand.version) {
        const prodPreds = new Map<Timeframe, Predictor>([[cand.timeframe, this.registry.predictor(active)]]);
        production = this.runner.run({ kind: 'event', label: `shadow: production ${active.version}`, timeframe: cand.timeframe, symbols, from, to, predictors: prodPreds }).report;
      }
      return { candidate, production };
    } catch (err) {
      return { candidate: null, production: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private metricSeries(since: number): MetricSeriesDto[] {
    const names = ['trader_equity', 'trader_daily_pnl', 'trader_gross_exposure_pct', 'trader_open_positions', 'trader_data_max_staleness_ms', 'trader_order_success_ratio', 'trader_stale_symbols'];
    const out: MetricSeriesDto[] = [];
    for (const name of names) {
      const byLabel = new Map<string, Array<{ ts: number; value: number }>>();
      for (const s of this.db.ops.series(name, since)) {
        const list = byLabel.get(s.labels) ?? [];
        list.push({ ts: s.ts, value: s.value });
        byLabel.set(s.labels, list);
      }
      for (const [labels, points] of byLabel) {
        const step = Math.max(1, Math.floor(points.length / 300));
        out.push({
          name,
          labels: Object.fromEntries(labels.split(',').filter(Boolean).map((kv) => kv.split('=') as [string, string])),
          points: points.filter((_, i) => i % step === 0 || i === points.length - 1),
        });
      }
    }
    return out;
  }

  /** Summary for agents / other screens. */
  async summary(): Promise<Record<string, unknown>> {
    const status = await this.status();
    const pf = await this.portfolio(this.activeAccount(), 7);
    return {
      mode: status.mode,
      autopilot: status.autopilot,
      killSwitch: status.kill,
      circuitBreaker: status.breaker,
      activeModels: status.activeModels,
      equity: pf.equity,
      cash: pf.cash,
      dailyPnl: pf.dailyPnl,
      drawdownPct: pf.drawdownPct,
      positions: pf.positions.map((p) => ({ symbol: p.symbol, qty: p.qty, avgPrice: p.avgPrice, lastPrice: p.lastPrice, unrealizedPnl: p.unrealizedPnl, stop: p.stop, takeProfit: p.takeProfit })),
      risk: this.config().risk,
      today: localDate(this.now()),
    };
  }

}


let instance: TraderService | null = null;

export function setTraderService(s: TraderService | null): void {
  instance = s;
}

export function getTraderService(): TraderService | null {
  return instance;
}
