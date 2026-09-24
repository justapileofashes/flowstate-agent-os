// AI Trader test fixtures: temp SQLite with all migrations, deterministic
// session-aligned synthetic bars (AR(1) returns → a learnable edge), fake bar
// providers, and a TraderService wired to a fake clock / LLM / HTTP.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '@main/db/database';
import { TraderDb } from '@main/trader/db';
import { TraderService } from '@main/trader/service';
import type { Candle } from '@main/trader/data/types';
import type { BarProvider } from '@main/trader/data/providers';
import { etParts, etToUtc, isTradingDay } from '@main/trader/data/calendar';
import { traderConfigSchema, TIMEFRAME_MS, type Timeframe, type TraderConfig, type TraderConfigInput } from '@shared/trader/types';
import type { TraderEvent } from '@shared/trader/api';
import { ScriptedLLM, type FakeHandler } from '../business/fake-llm';
import { FakeClock, FakeFetch, memorySettings } from '../business/helpers';

export { FakeClock, FakeFetch, memorySettings, ScriptedLLM };
export { json } from '../business/helpers';
export type { FetchCall } from '../business/helpers';

export interface DbEnv {
  dir: string;
  raw: Database;
  db: TraderDb;
  cleanup: () => void;
}

export function makeDb(): DbEnv {
  const dir = mkdtempSync(join(tmpdir(), 'flowstate-trader-'));
  const raw = openDatabase(join(dir, 'test.sqlite'));
  return {
    dir,
    raw,
    db: new TraderDb(raw),
    cleanup: () => {
      raw.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  const u = Math.max(1e-12, r());
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Regular-session bar opens for [fromDay, toDay) (ET dates as epoch noon). */
export function sessionOpens(from: number, days: number, tf: Timeframe): number[] {
  const out: number[] = [];
  const step = TIMEFRAME_MS[tf];
  for (let d = 0; d <= days; d++) {
    const p = etParts(from + d * 86_400_000);
    if (!isTradingDay(p.date, p.weekday)) continue;
    if (tf === '1d') {
      out.push(Date.UTC(p.y, p.m - 1, p.d));
      continue;
    }
    const open = etToUtc(p.y, p.m, p.d, 9, 30);
    const close = etToUtc(p.y, p.m, p.d, 16, 0);
    for (let t = open; t < close; t += step) out.push(t);
  }
  return out;
}

/**
 * AR(1) log returns r_t = φ·r_{t−1} + σ·ε: momentum the model can learn from
 * the last-bar return / short ROC features. Deterministic per seed.
 */
export function syntheticBars(opts: { opens: number[]; seed: number; phi?: number; sigma?: number; start?: number; drift?: number }): Candle[] {
  const r = rng(opts.seed);
  const phi = opts.phi ?? 0.45;
  const sigma = opts.sigma ?? 0.006;
  let price = opts.start ?? 100;
  let prev = 0;
  const out: Candle[] = [];
  for (const ts of opts.opens) {
    const ret = phi * prev + sigma * gauss(r) + (opts.drift ?? 0);
    prev = ret;
    const open = price * Math.exp(sigma * 0.1 * gauss(r));
    const close = price * Math.exp(ret);
    const hi = Math.max(open, close) * (1 + Math.abs(gauss(r)) * sigma * 0.3);
    const lo = Math.min(open, close) * (1 - Math.abs(gauss(r)) * sigma * 0.3);
    out.push({ ts, open, high: hi, low: lo, close, volume: Math.round(1_000_000 * (1 + 0.3 * Math.abs(gauss(r)))) });
    price = close;
  }
  return out;
}

export class FakeBarProvider implements BarProvider {
  readonly calls: Array<{ symbols: string[]; timeframe: Timeframe; from: number; to: number }> = [];
  fail: Error | null = null;

  constructor(
    readonly name: 'alpaca' | 'yahoo',
    public data: Map<string, Map<Timeframe, Candle[]>>,
  ) {}

  async fetchBars(symbols: string[], timeframe: Timeframe, from: number, to: number): Promise<Map<string, Candle[]>> {
    this.calls.push({ symbols, timeframe, from, to });
    if (this.fail) throw this.fail;
    const out = new Map<string, Candle[]>();
    for (const s of symbols) {
      const c = this.data.get(s)?.get(timeframe);
      if (c) out.set(s, c.filter((k) => k.ts >= from && k.ts <= to));
    }
    return out;
  }
}

export const TEST_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'JPM', 'XOM'];

/** ~9 months of 1h session bars per symbol ending before `end`. */
export function marketData(end: number, symbols = TEST_SYMBOLS, tf: Timeframe = '1h', days = 270): Map<string, Map<Timeframe, Candle[]>> {
  const opens = sessionOpens(end - days * 86_400_000, days, tf).filter((t) => t + TIMEFRAME_MS[tf] <= end);
  const data = new Map<string, Map<Timeframe, Candle[]>>();
  symbols.forEach((s, i) => data.set(s, new Map([[tf, syntheticBars({ opens, seed: 1000 + i * 17, start: 50 + i * 30 })]])));
  return data;
}

export function testConfig(over: TraderConfigInput = {}): TraderConfig {
  return traderConfigSchema.parse({
    symbolGroups: [{ id: 'test', name: 'Test', enabled: true, symbols: TEST_SYMBOLS }],
    models: {
      specs: [
        { timeframe: '1h', horizonBars: 2, enabled: true },
        { timeframe: '15m', horizonBars: 4, enabled: false },
      ],
      lookbackDays: 400,
      gbdt: { trees: 60, depth: 3, learningRate: 0.1, minLeaf: 30, bins: 32, subsample: 0.8, l2: 1 },
    },
    signals: { confidenceThreshold: 0.6, minEdgePct: 0.01 },
    llm: { enabled: false },
    schedule: { tickDelaySec: 0 },
    ...over,
  });
}

export interface TraderEnv extends DbEnv {
  service: TraderService;
  clock: FakeClock;
  llm: ScriptedLLM;
  http: FakeFetch;
  settings: ReturnType<typeof memorySettings>;
  events: TraderEvent[];
  notifications: Array<{ title: string; body: string }>;
  yahoo: FakeBarProvider;
  alpacaData: FakeBarProvider;
}

export async function makeTrader(opts: {
  now?: number;
  data?: Map<string, Map<Timeframe, Candle[]>>;
  config?: TraderConfig;
  handler?: FakeHandler;
  liveBuildEnabled?: boolean;
  settings?: Record<string, string>;
  alpacaFactory?: ConstructorParameters<typeof TraderService>[0]['alpacaFactory'];
  withDataDir?: boolean;
} = {}): Promise<TraderEnv> {
  const base = makeDb();
  const clock = new FakeClock(opts.now ?? etToUtc(2026, 9, 23, 11, 0) + 30_000);
  const llm = new ScriptedLLM(opts.handler ?? (() => ({ text: 'The model sees short-term momentum; the risk is a reversal below the stop.' })));
  const http = new FakeFetch();
  const settings = memorySettings(opts.settings ?? {});
  const events: TraderEvent[] = [];
  const notifications: Array<{ title: string; body: string }> = [];
  const data = opts.data ?? marketData(clock.now());
  const yahoo = new FakeBarProvider('yahoo', data);
  const alpacaData = new FakeBarProvider('alpaca', data);
  const service = new TraderService({
    raw: base.raw,
    settings,
    provider: llm,
    dataDir: opts.withDataDir ? join(base.dir, 'trader') : null,
    fetch: http.fn,
    now: clock.now,
    sleep: async () => undefined,
    broadcast: (e) => events.push(e),
    desktopNotify: (title, body) => notifications.push({ title, body }),
    providers: { yahoo, alpaca: alpacaData },
    ...(opts.liveBuildEnabled !== undefined ? { liveBuildEnabled: opts.liveBuildEnabled } : {}),
    ...(opts.alpacaFactory ? { alpacaFactory: opts.alpacaFactory } : {}),
  });
  await service.init();
  await service.handle('config.update', { config: opts.config ?? testConfig(), note: 'test config' });
  return { ...base, service, clock, llm, http, settings, events, notifications, yahoo, alpacaData };
}

/** Load all fake-provider bars into the store (backfill). */
export async function backfill(env: TraderEnv, tf: Timeframe = '1h', days = 400): Promise<void> {
  await env.service.handle('data.ingest', { timeframe: tf, days });
}
