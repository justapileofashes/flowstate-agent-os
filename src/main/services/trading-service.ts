// App-level trading facade: owns the Alpaca client (built from settings),
// the trade journal/strategy store, the autonomous engine, and the autopilot
// ticker. Exposed as a module singleton so both the IPC handlers and the
// agent tool dispatcher act on the same guarded pipeline — there is no path
// to the broker that bypasses the risk rules.
import { app } from 'electron';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import type { SettingsService } from './settings-service';
import { AlpacaClient } from './alpaca-client';
import { MarketDataService } from './market-data';
import { analyzeSymbol, type StockAnalysis } from './stock-analysis';
import { TradingStore, type StrategyRow, type TradeRow } from './trading-store';
import { TradingEngine, type CycleReport } from './trading-engine';
import {
  sanitizeGuardrails,
  type RiskVerdict,
  type TradeIntent,
  type TradingGuardrails,
} from '@shared/trading-rules';

export const TRADING_SETTING_KEYS = {
  keyId: 'alpaca_key_id',
  secret: 'alpaca_secret_key',
  paper: 'alpaca_paper', // '1' (default) | '0'
  liveAck: 'trading_live_ack', // '1' only after explicit user confirmation
  autopilot: 'trading_autopilot', // '1' | '0'
  guardrails: 'trading_guardrails', // JSON TradingGuardrails
  watchlist: 'stocks_watchlist', // shared with the Stocks screen
} as const;

const AUTOPILOT_INTERVAL_MS = 5 * 60_000;
const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'SPY'];

export interface TradingStatus {
  configured: boolean;
  paper: boolean;
  liveAck: boolean;
  autopilot: boolean;
  guardrails: TradingGuardrails;
  lastCycle: CycleReport | null;
}

export class TradingService {
  private readonly store: TradingStore;
  private market: MarketDataService | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private lastCycle: CycleReport | null = null;
  private cycleRunning = false;

  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    /** Injectable for tests; defaults to the real Alpaca client. */
    private readonly makeBroker: (creds: { keyId: string; secret: string; paper: boolean }) => AlpacaClient =
      (creds) => new AlpacaClient(creds),
  ) {
    this.store = new TradingStore(db);
    if (this.settings.get(TRADING_SETTING_KEYS.autopilot) === '1') this.startTicker();
  }

  // ── Config ────────────────────────────────────────────────────────────────

  isConfigured(): boolean {
    return Boolean(
      this.settings.get(TRADING_SETTING_KEYS.keyId) && this.settings.get(TRADING_SETTING_KEYS.secret),
    );
  }

  isPaper(): boolean {
    return this.settings.get(TRADING_SETTING_KEYS.paper) !== '0';
  }

  private liveAck(): boolean {
    return this.settings.get(TRADING_SETTING_KEYS.liveAck) === '1';
  }

  guardrails(): TradingGuardrails {
    const raw = this.settings.get(TRADING_SETTING_KEYS.guardrails);
    try {
      return sanitizeGuardrails(raw ? (JSON.parse(raw) as Partial<TradingGuardrails>) : undefined);
    } catch {
      return sanitizeGuardrails(undefined);
    }
  }

  setGuardrails(raw: Partial<TradingGuardrails>): TradingGuardrails {
    const clean = sanitizeGuardrails(raw);
    this.settings.set(TRADING_SETTING_KEYS.guardrails, JSON.stringify(clean));
    return clean;
  }

  watchlist(): string[] {
    const raw = this.settings.get(TRADING_SETTING_KEYS.watchlist);
    if (!raw) return DEFAULT_WATCHLIST;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string') && parsed.length > 0) {
        return parsed as string[];
      }
    } catch {
      /* fall through */
    }
    return DEFAULT_WATCHLIST;
  }

  /** Save keys after verifying them against the (paper by default) API. */
  async connect(keyId: string, secret: string, paper: boolean): Promise<{ ok: boolean; error?: string; equity?: number }> {
    // Flipping to live wipes the previous acknowledgement — it must be re-confirmed.
    try {
      const broker = this.makeBroker({ keyId, secret, paper });
      const account = await broker.getAccount();
      this.settings.set(TRADING_SETTING_KEYS.keyId, keyId);
      this.settings.set(TRADING_SETTING_KEYS.secret, secret);
      this.settings.set(TRADING_SETTING_KEYS.paper, paper ? '1' : '0');
      if (paper) this.settings.set(TRADING_SETTING_KEYS.liveAck, '0');
      return { ok: true, equity: account.equity };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  disconnect(): void {
    this.setAutopilot(false);
    this.settings.set(TRADING_SETTING_KEYS.keyId, '');
    this.settings.set(TRADING_SETTING_KEYS.secret, '');
    this.settings.set(TRADING_SETTING_KEYS.liveAck, '0');
  }

  /** Explicit, separate step: acknowledge real-money trading. */
  setLiveAck(ack: boolean): void {
    this.settings.set(TRADING_SETTING_KEYS.liveAck, ack ? '1' : '0');
  }

  // ── Engine plumbing ───────────────────────────────────────────────────────

  private broker(): AlpacaClient {
    const keyId = this.settings.get(TRADING_SETTING_KEYS.keyId);
    const secret = this.settings.get(TRADING_SETTING_KEYS.secret);
    if (!keyId || !secret) throw new Error('Trading not connected — add Alpaca API keys first');
    return this.makeBroker({ keyId, secret, paper: this.isPaper() });
  }

  private getMarket(): MarketDataService {
    if (!this.market) {
      this.market = new MarketDataService({
        cacheDir: join(app.getPath('userData'), 'market-cache'),
      });
    }
    return this.market;
  }

  private engine(): TradingEngine {
    return new TradingEngine({
      broker: this.broker(),
      store: this.store,
      analyze: (symbol: string): Promise<StockAnalysis> => analyzeSymbol(this.getMarket(), symbol),
      getGuardrails: () => this.guardrails(),
      getWatchlist: () => this.watchlist(),
      getLiveAck: () => this.liveAck(),
      log: (msg) => console.log(msg), // eslint-disable-line no-console
    });
  }

  // ── Autopilot ─────────────────────────────────────────────────────────────

  setAutopilot(enabled: boolean): void {
    this.settings.set(TRADING_SETTING_KEYS.autopilot, enabled ? '1' : '0');
    if (enabled) this.startTicker();
    else this.stopTicker();
  }

  autopilotEnabled(): boolean {
    return this.settings.get(TRADING_SETTING_KEYS.autopilot) === '1';
  }

  private startTicker(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => {
      void this.runCycle().catch(() => undefined);
    }, AUTOPILOT_INTERVAL_MS);
    // First cycle shortly after enable, not a full interval later.
    setTimeout(() => void this.runCycle().catch(() => undefined), 3_000);
  }

  private stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  dispose(): void {
    this.stopTicker();
  }

  async runCycle(): Promise<CycleReport> {
    if (!this.isConfigured()) throw new Error('Trading not connected');
    if (this.cycleRunning) throw new Error('a trading cycle is already running');
    this.cycleRunning = true;
    try {
      const report = await this.engine().runCycle();
      this.lastCycle = report;
      return report;
    } finally {
      this.cycleRunning = false;
    }
  }

  // ── Queries + manual/agent actions ───────────────────────────────────────

  status(): TradingStatus {
    return {
      configured: this.isConfigured(),
      paper: this.isPaper(),
      liveAck: this.liveAck(),
      autopilot: this.autopilotEnabled(),
      guardrails: this.guardrails(),
      lastCycle: this.lastCycle,
    };
  }

  async account(): Promise<{ equity: number; cash: number; buyingPower: number; status: string; positions: Array<{ symbol: string; qty: number; avgEntryPrice: number; currentPrice: number; unrealizedPl: number; unrealizedPlPct: number }> }> {
    const broker = this.broker();
    const [account, positions] = await Promise.all([broker.getAccount(), broker.getPositions()]);
    return {
      equity: account.equity,
      cash: account.cash,
      buyingPower: account.buyingPower,
      status: account.status,
      positions: positions.map((p) => ({
        symbol: p.symbol,
        qty: p.qty,
        avgEntryPrice: p.avgEntryPrice,
        currentPrice: p.currentPrice,
        unrealizedPl: p.unrealizedPl,
        unrealizedPlPct: p.unrealizedPlPct,
      })),
    };
  }

  trades(limit = 100): TradeRow[] {
    return this.store.listTrades(limit);
  }

  strategies(): StrategyRow[] {
    return this.store.listStrategies();
  }

  recentLessons(limit = 10): string[] {
    return this.store.recentLessons(limit);
  }

  dayStats(): { realizedPnlToday: number; tradesOpenedToday: number; consecutiveLosses: number } {
    return this.store.dayStats();
  }

  createStrategy(input: { name: string; description?: string; inspiration?: string; params?: unknown }): StrategyRow {
    return this.store.createStrategy(input);
  }

  setStrategyStatus(id: string, status: 'active' | 'retired'): void {
    this.store.setStrategyStatus(id, status);
  }

  /** Manual/agent-proposed trade. Same guardrail gate as the autopilot. */
  async placeTrade(input: {
    symbol: string;
    side: 'buy' | 'sell';
    entry: number;
    stoploss: number;
    takeProfit: number;
    qty?: number;
    confidence: number;
    reason: string;
    strategyId?: string;
  }): Promise<{ verdict: RiskVerdict; trade: TradeRow | null }> {
    const broker = this.broker();
    const [account, positions] = await Promise.all([broker.getAccount(), broker.getPositions()]);
    const rules = this.guardrails();
    const riskPerShare = Math.abs(input.entry - input.stoploss);
    const defaultQty =
      riskPerShare > 0 ? Math.floor(((rules.riskPctPerTrade / 100) * account.equity) / riskPerShare) : 0;
    const intent: TradeIntent = {
      symbol: input.symbol,
      side: input.side,
      qty: input.qty && input.qty > 0 ? input.qty : defaultQty,
      entry: input.entry,
      stoploss: input.stoploss,
      confidence: input.confidence,
      ...(input.strategyId ? { strategyId: input.strategyId } : {}),
    };
    return this.engine().executeIntent({
      intent,
      takeProfit: input.takeProfit,
      rationale: {
        confidence: input.confidence,
        direction: input.side,
        factors: [],
        stopDistancePct: input.entry > 0 ? riskPerShare / input.entry : 0,
        strategy: input.strategyId ?? null,
        riskNotes: [input.reason.slice(0, 500)],
      },
      account: { equity: account.equity, cash: account.cash },
      positions,
    });
  }

  /** Close an open position at market and journal the exit immediately. */
  async closeBySymbol(symbol: string, reason: string): Promise<{ ok: boolean; detail: string }> {
    const broker = this.broker();
    const positions = await broker.getPositions();
    const pos = positions.find((p) => p.symbol.toUpperCase() === symbol.toUpperCase());
    if (!pos) return { ok: false, detail: `no open position in ${symbol}` };
    await broker.closePosition(symbol);
    const open = this.store.openTrades().find((t) => t.symbol.toUpperCase() === symbol.toUpperCase());
    if (open) {
      this.store.closeTrade(open.id, pos.currentPrice, `manually closed: ${reason.slice(0, 500)}`);
    }
    return { ok: true, detail: `closing ${pos.qty} ${symbol} at ~${pos.currentPrice}` };
  }
}

let instance: TradingService | null = null;

export function initTradingService(db: Database, settings: SettingsService): TradingService {
  instance = new TradingService(db, settings);
  return instance;
}

export function getTradingService(): TradingService | null {
  return instance;
}
